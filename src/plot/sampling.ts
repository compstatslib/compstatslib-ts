/**
 * The three-panel sampling demonstration: a population, the samples drawn
 * from it, and how their statistic scatters.
 *
 * This is the drawing half of `plot_sampling()` in
 * `../compstatslib/R/sampling_plot.R`. The panels, top to bottom:
 *
 * 1. the population's density, dotted;
 * 2. this draw's samples — each sample's own density in translucent gray,
 *    with the density of all of them pooled drawn over the top;
 * 3. a histogram of every statistic drawn so far, this call and all before it.
 *
 * All three share one horizontal window, frozen on the first call at the range
 * of the population. Later calls keep it however wide the population passed to
 * them happens to be, which is what lets the picture stay still while the
 * statistics pile up. A bar or a curve outside that window is clipped.
 *
 * **The state is the caller's.** R returns a `vars` list and its gadget hands
 * it back on the next call, which is how the window stays frozen and the
 * statistics accumulate. Nothing is kept here between calls: `plotSampling`
 * takes the state it was given, returns the state it made, and the caller —
 * `interactiveSampling`, or a demo page — holds it in between. That is the
 * port plan's rule against hidden accumulation.
 *
 * **`replot_population` is not ported.** R declares and documents it, and
 * `interactive_sampling()` passes `FALSE` for it, but `plot_sampling()`'s body
 * never reads it: the population panel is always redrawn. Porting a parameter
 * that does nothing would carry the defect forward as if it were a feature.
 */

import { extent, mean } from "../core/arith";
import { histogram } from "../core/histogram";
import type { Histogram } from "../core/histogram";
import { kernelDensity } from "../core/kde";
import type { KernelDensityEstimate } from "../core/kde";
import { seededRng } from "../core/rng";
import type { Rng } from "../core/rng";
import { drawSamples } from "../core/sampling";
import { createScale, drawAxes } from "./axes";
import type { Extent, Scale } from "./axes";
import { DOTTED, clearSurface, clipToArea } from "./draw";
import { resolveTarget } from "./target";
import type { Context2D, PlotTarget } from "./target";

/** Which of the three stacked panels a scale belongs to. */
export type SamplingPanel = "population" | "samples" | "statistic";

/**
 * What one draw hands to the next.
 *
 * This is R's `vars` list, less the entries that are arguments anyway: R keeps
 * the population, the sample size and the statistic in there as well, and this
 * port takes all three afresh on every call, so holding them twice would let
 * the two copies disagree.
 */
export interface SamplingState {
  /** The left edge of the frozen window. R's `xmin`. */
  readonly xMin: number;
  /** The right edge of the frozen window. R's `xmax`. */
  readonly xMax: number;
  /** Every statistic drawn so far, oldest first. R's `sample_theta`. */
  readonly sampleTheta: readonly number[];
}

/** What to draw. The interactive layer forwards these untouched. */
export interface PlotSamplingOptions {
  /**
   * How many values in each sample. R's `sample_size`.
   *
   * R's `plot_sampling()` has no default here and fails without one; its
   * gadget defaults to 10. This port takes the gadget's default so that
   * `plotSampling(target, population)` draws something, which is the
   * no-argument-works property the port plan asks bundled demos to keep.
   */
  readonly sampleSize?: number;
  /** How many samples this draw takes. R's `reps`, 1 by default. */
  readonly reps?: number;
  /** The statistic to take from each sample. R's `theta`, the mean. */
  readonly theta?: (sample: readonly number[]) => number;
  /**
   * Where the randomness comes from.
   *
   * R reads one global stream, so its repeated draws carry on where the last
   * left off. A caller who draws more than once must pass one generator and
   * keep passing it — the default builds a new one per call, and two calls
   * that each build their own would each start from the beginning.
   *
   * The default is seeded from `Math.random()`, so a demo that says nothing
   * about seeds still gets a different draw each time, as an R session does.
   * Only the seed comes from there: pass `seededRng(42)` and every draw down
   * that stream repeats exactly.
   */
  readonly rng?: Rng;
  /**
   * What the last call returned, or nothing on the first call.
   *
   * R's `vars` argument, which its gadget caches. This is what freezes the
   * window and accumulates the statistics.
   */
  readonly state?: SamplingState | null;
}

/** Everything this draw produced, for the caller to hold and to read. */
export interface PlotSamplingResult {
  /** The state to hand back on the next call. */
  readonly state: SamplingState;
  /** The samples this call drew, in draw order. */
  readonly samples: readonly (readonly number[])[];
  /** The statistic of each of those samples. */
  readonly thetas: readonly number[];
  /**
   * The histogram the third panel drew, or null when there was nothing to
   * count. Handed back so a caller need not bin the statistics again.
   */
  readonly histogram: Histogram | null;
}

/** R: `sample_size = 10` in `interactive_sampling()`. */
const DEFAULT_SAMPLE_SIZE = 10;
/** R: `reps = 1`. */
const DEFAULT_REPS = 1;
/** How many panels are stacked, and in which order. */
const PANELS: readonly SamplingPanel[] = ["population", "samples", "statistic"];

/**
 * Margins inside each panel.
 *
 * R uses `mar = c(2, 2, 1, 1)` under `cex = 0.5`, which is about twelve pixels
 * below and beside each panel. The bottom here is wider because that is where
 * the axis, its ticks and their labels go, and the sides are wide enough to
 * hold the first and last tick label without running off the surface.
 */
const PANEL_MARGINS = { top: 8, right: 24, bottom: 28, left: 24 };

const CURVE_COLOR = "#000000";
const TEXT_COLOR = "#000000";
/** R: `rgb(0.7, 0.7, 0.7, 0.5)`, one curve per sample. */
const SAMPLE_CURVE_COLOR = "rgba(179, 179, 179, 0.5)";
/** R's `hist()` default `col`, with `border = FALSE`. */
const BAR_COLOR = "lightgray";
/** R: `lwd = 2` on the population and pooled curves. */
const CURVE_WIDTH = 2;
/** R: `lwd = 1` on each sample's own curve. */
const SAMPLE_CURVE_WIDTH = 1;

/**
 * Panel labels.
 *
 * R writes the first two through `boldly()`, which wraps them in `bold()`, and
 * the third as a plain string. R's `cex = 0.5` would put these at about six
 * pixels: the t-test plot already learned that such text is unreadable on a
 * canvas, so these follow that panel's choice of legibility over fidelity.
 */
const LABEL_FONT = "bold 11px sans-serif";
const COUNT_FONT = "11px sans-serif";
const LABEL_LINE_HEIGHT = 13;

/**
 * Build the scale for one panel.
 *
 * The three panels are stacked in equal bands and share the window, so the
 * same world x lands in the same pixel column in each. The interactive layer
 * and any demo read their geometry from here rather than restating it.
 *
 * @param width The pixel width of the surface.
 * @param height The pixel height of the surface.
 * @param panel Which band to build.
 * @param window The frozen horizontal window, shared by all three.
 * @param yMax The tallest value the panel has to show. Zero is always the
 *   foot of the panel, as it is for a density and for a count.
 * @returns The map between world values and pixels for that panel.
 */
export function samplingScale(
  width: number,
  height: number,
  panel: SamplingPanel,
  window: Extent,
  yMax: number,
): Scale {
  const band = height / PANELS.length;
  const index = PANELS.indexOf(panel);
  const top = index * band;

  return createScale({
    width,
    height,
    x: window,
    y: { min: 0, max: yMax },
    margins: {
      top: top + PANEL_MARGINS.top,
      bottom: height - (top + band) + PANEL_MARGINS.bottom,
      left: PANEL_MARGINS.left,
      right: PANEL_MARGINS.right,
    },
  });
}

/**
 * Draw one round of sampling, and hand back what the next round needs.
 *
 * A population of fewer than two values has no density, and R's `density()`
 * stops there. A library cannot stop: this draws the three panels and their
 * axes with nothing in them, takes no samples, and returns a state with the
 * window set and no statistics. The same holds for the samples themselves —
 * a sample of one value gets no curve of its own, though it still counts
 * toward the pooled one and toward the histogram.
 *
 * @param target A canvas, or a context and a size. See `./target.ts`.
 * @param population The values to sample from.
 * @param options The sample size, the repetitions, the statistic, the
 *   generator, and the state of the last call.
 * @returns This draw's samples and statistics, the histogram drawn from the
 *   accumulated statistics, and the state to pass back next time.
 * @throws RangeError If the sample size is larger than the population, or if
 *   a count is negative or fractional — both from `drawSamples`, which is
 *   where R's own refusals live.
 */
export function plotSampling(
  target: PlotTarget,
  population: readonly number[],
  options: PlotSamplingOptions = {},
): PlotSamplingResult {
  const { ctx, width, height } = resolveTarget(target);
  const {
    sampleSize = DEFAULT_SAMPLE_SIZE,
    reps = DEFAULT_REPS,
    theta = mean,
    rng = seededRng(Math.floor(Math.random() * 0x100000000)),
    state = null,
  } = options;

  const window = frozenWindow(population, state);
  const drawable = population.length >= 2;
  const draw = drawable
    ? drawSamples(rng, population, { sampleSize, reps, theta })
    : { samples: [] as readonly (readonly number[])[], thetas: [] as readonly number[] };
  const sampleTheta = [...(state?.sampleTheta ?? []), ...draw.thetas];

  clearSurface(ctx, width, height);

  drawDensityPanel(
    ctx,
    width,
    height,
    "population",
    window,
    drawable ? kernelDensity(population) : null,
    [],
    "Population Distribution",
  );

  const pooled = draw.samples.flat();
  drawDensityPanel(
    ctx,
    width,
    height,
    "samples",
    window,
    pooled.length >= 2 ? kernelDensity(pooled) : null,
    draw.samples
      .filter((sample) => sample.length >= 2)
      .map((sample) => kernelDensity(sample)),
    "Sample Distribution",
  );

  const counted = sampleTheta.length > 0 ? histogram(sampleTheta) : null;
  drawStatisticPanel(ctx, width, height, window, counted, sampleTheta.length);

  return {
    state: { xMin: window.min, xMax: window.max, sampleTheta },
    samples: draw.samples,
    thetas: draw.thetas,
    histogram: counted,
  };
}

/**
 * Return the window to draw in.
 *
 * R reads `xmin`/`xmax` back out of `vars` whenever it has them and only falls
 * back to the range of the population on the first call, so a population that
 * arrives wider later does not move the picture.
 */
function frozenWindow(
  population: readonly number[],
  state: SamplingState | null,
): Extent {
  if (state !== null) {
    return { min: state.xMin, max: state.xMax };
  }
  if (population.length === 0) {
    return { min: 0, max: 1 };
  }
  const [min, max] = extent(population);
  return { min, max };
}

/**
 * Draw one of the two density panels.
 *
 * The panel's height comes from the curve R plots first — the population's in
 * the top panel, the pooled samples' in the middle one. Each sample's own
 * curve is drawn against that same height and clipped, exactly as R's device
 * clips it, so a narrow sample with a tall peak cannot escape its panel.
 */
function drawDensityPanel(
  ctx: Context2D,
  width: number,
  height: number,
  panel: SamplingPanel,
  window: Extent,
  main: KernelDensityEstimate | null,
  perSample: readonly KernelDensityEstimate[],
  label: string,
): void {
  const peak = main === null ? 1 : highestOf(main.y);
  const scale = samplingScale(width, height, panel, window, peak);
  drawAxes(ctx, scale, { frame: false, yAxis: false });
  // The label goes on even when there is no curve under it, so an empty
  // picture still says which panel is which.
  drawLabel(ctx, scale, [label], peak / 2, LABEL_FONT);

  if (main === null) {
    return;
  }

  // R plots the pooled curve, draws the per-sample curves over it, then
  // strokes the pooled curve again to bring it back to the front.
  drawCurve(ctx, scale, main, CURVE_COLOR, CURVE_WIDTH, panel === "population");
  for (const estimate of perSample) {
    drawCurve(
      ctx,
      scale,
      estimate,
      SAMPLE_CURVE_COLOR,
      SAMPLE_CURVE_WIDTH,
      false,
    );
  }
  if (panel === "samples") {
    // R's second `lines(samd, ...)`. It belongs to this panel alone: the
    // population panel is drawn once, and re-stroking it would put a solid
    // curve over the dotted one.
    drawCurve(ctx, scale, main, CURVE_COLOR, CURVE_WIDTH, false);
  }
}

/** Draw the histogram of every statistic drawn so far. */
function drawStatisticPanel(
  ctx: Context2D,
  width: number,
  height: number,
  window: Extent,
  counted: Histogram | null,
  drawnSoFar: number,
): void {
  const tallest = counted === null ? 1 : highestOf(counted.counts);
  const scale = samplingScale(width, height, "statistic", window, tallest);
  drawAxes(ctx, scale, { frame: false, yAxis: false });

  if (counted !== null) {
    drawBars(ctx, scale, counted);
  }

  // R: paste("Sampling Statistic", "\n(", length(sample_theta), ")"), whose
  // single-space joins and inner line break are kept exactly.
  drawLabel(
    ctx,
    scale,
    ["Sampling Statistic ", `( ${drawnSoFar} )`],
    tallest / 2,
    COUNT_FONT,
  );
}

/** Draw a density estimate as a line, clipped to its panel. */
function drawCurve(
  ctx: Context2D,
  scale: Scale,
  estimate: KernelDensityEstimate,
  color: string,
  lineWidth: number,
  dotted: boolean,
): void {
  const { area } = scale;
  ctx.save();
  clipToArea(ctx, area);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dotted ? DOTTED : []);
  ctx.beginPath();
  estimate.x.forEach((x, index) => {
    const px = scale.toPixelX(x);
    const py = scale.toPixelY(estimate.y[index] as number);
    if (index === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  });
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw the histogram bars, clipped to the panel.
 *
 * R's call passes `border = FALSE`, so each bar is a filled rectangle with no
 * outline. The bars are clipped because the window belongs to the population:
 * a statistic can land outside it, and R's device clips the bar that holds it.
 */
function drawBars(ctx: Context2D, scale: Scale, counted: Histogram): void {
  const { area } = scale;
  const foot = scale.toPixelY(0);

  ctx.save();
  clipToArea(ctx, area);
  ctx.setLineDash([]);
  ctx.fillStyle = BAR_COLOR;
  counted.counts.forEach((count, index) => {
    const left = scale.toPixelX(counted.breaks[index] as number);
    const right = scale.toPixelX(counted.breaks[index + 1] as number);
    const top = scale.toPixelY(count);
    ctx.fillRect(left, top, right - left, foot - top);
  });
  ctx.restore();
}

/**
 * Write a panel's label at the left of the window, halfway up its content.
 *
 * R: `text(xmin, max(y)/2, label, adj = 0)` — left-justified at the window's
 * left edge and centerd on that height.
 */
function drawLabel(
  ctx: Context2D,
  scale: Scale,
  lines: readonly string[],
  at: number,
  font: string,
): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = font;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  lines.forEach((line, index) => {
    ctx.fillText(
      line,
      scale.area.left,
      scale.toPixelY(at) + index * LABEL_LINE_HEIGHT,
    );
  });
  ctx.restore();
}

/** Return the largest value, or 1 for an empty or flat set. */
function highestOf(values: readonly number[]): number {
  const highest = values.reduce((high, value) => (value > high ? value : high), 0);
  return highest > 0 ? highest : 1;
}
