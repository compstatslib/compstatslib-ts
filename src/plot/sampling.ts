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

import { extent, mean } from "../core/arith.js";
import { histogram } from "../core/histogram.js";
import type { Histogram } from "../core/histogram.js";
import { kernelDensity } from "../core/kde.js";
import type {
  KernelDensityEstimate,
  KernelDensityOptions,
} from "../core/kde.js";
import { seededRng } from "../core/rng.js";
import type { Rng } from "../core/rng.js";
import { drawSamples } from "../core/sampling.js";
import { createScale, drawAxes } from "./axes.js";
import type { Extent, Scale } from "./axes.js";
import { DOTTED, clearSurface, clipToArea } from "./draw.js";
import { resolveTarget } from "./target.js";
import type { Context2D, PlotTarget } from "./target.js";

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
  /**
   * Where every density curve puts its grid.
   *
   * `"data"`, the default, is R: each `density()` call spreads its 512 grid
   * points over the range of the values it was given. That is right while the
   * values and the window are of one size.
   *
   * `"frozen"` spreads them over the drawn window instead, through R's own
   * `from` and `to` arguments. A population that reaches far outside the
   * window needs this: at 512 points over a range a thousand times the window,
   * one grid step is wider than the whole panel, and the curve draws as a
   * straight line. The samples take the frozen grid as well, for the same
   * reason and so that every curve in the picture is comparable.
   */
  readonly densityWindow?: "data" | "frozen";
  /**
   * Mark the chosen statistic on all three panels. Nothing is marked by
   * default, and the picture is then what it was before this option existed.
   */
  readonly mark?: SamplingMarkOptions;
}

/**
 * What the caller knows about the statistic that the panels cannot compute.
 *
 * The library sees the samples and the pile, so it takes those two numbers
 * itself. It cannot see the population's truth: that is a fact about the shape
 * the values came from, not about the values. A Cauchy population has no mean,
 * and the arithmetic mean of any finite draw from it is still a number, so the
 * caller must say which of the two the panel shows.
 */
export interface SamplingMarkOptions {
  /** A place on the axis, or a distance from a center. */
  readonly kind: "location" | "spread";
  /** The true value in the population, or null when the population has none. */
  readonly populationValue: number | null;
  /**
   * Where the population's span hangs from. Read only when `kind` is
   * `"spread"`. A spread with a value but no center draws nothing: a span at
   * an invented center would say something the caller did not say.
   */
  readonly populationCenter?: number | null;
  /** What the panel calls the statistic, in the singular: `"mean"`. */
  readonly label: string;
}

/** The three numbers the marks drew. Null where a number does not exist. */
export interface SamplingMarks {
  /** What the caller declared, copied back. */
  readonly population: number | null;
  /** The statistic of this call's pooled sample. Null when reps is 0. */
  readonly sample: number | null;
  /**
   * The average of every statistic drawn so far. Null on an empty pile.
   *
   * It counts the whole pile, including the statistics outside the window that
   * the histogram drops. Under a population whose statistic does not settle,
   * the average therefore walks, and it can walk out of the window.
   */
  readonly pile: number | null;
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
   *
   * It counts the statistics inside the window, not the whole pile. The panel
   * clips a bar outside the window anyway, and a statistic it cannot draw must
   * not set the width of the cells either — see `plotSampling`.
   */
  readonly histogram: Histogram | null;
  /** The three numbers the marks drew, or null when no mark was asked for. */
  readonly marks: SamplingMarks | null;
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
 * The mark of the chosen statistic.
 *
 * The color is the one the library already gives to a quantity computed from
 * data, as on the regression line and the logit curve. Each sample's own mark
 * takes the same color at half alpha and the thinner line, which is what the
 * per-sample curves do.
 */
const MARK_COLOR = "cornflowerblue";
const SAMPLE_MARK_COLOR = "rgba(100, 149, 237, 0.5)";
const MARK_WIDTH = 2;
const SAMPLE_MARK_WIDTH = 1;
/** Half the height of the tick at each end of a span, in pixels. */
const MARK_TICK = 4;
/** The height and the depth of the caret that stands for a mark off the window. */
const CARET_SIZE = 6;

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
    densityWindow = "data",
    mark,
  } = options;

  const window = frozenWindow(population, state);
  const grid: KernelDensityOptions =
    densityWindow === "frozen" ? { from: window.min, to: window.max } : {};
  const drawable = population.length >= 2;
  const draw = drawable
    ? drawSamples(rng, population, { sampleSize, reps, theta })
    : { samples: [] as readonly (readonly number[])[], thetas: [] as readonly number[] };
  const sampleTheta = [...(state?.sampleTheta ?? []), ...draw.thetas];

  const pooled = draw.samples.flat();
  const marks = markNumbers(mark, theta, pooled, sampleTheta);

  clearSurface(ctx, width, height);

  drawDensityPanel(
    ctx,
    width,
    height,
    "population",
    window,
    drawable ? kernelDensity(population, grid) : null,
    [],
    "Population Distribution",
    populationMarks(mark),
    mark !== undefined && mark.populationValue === null
      ? `no true ${mark.label}`
      : null,
  );

  drawDensityPanel(
    ctx,
    width,
    height,
    "samples",
    window,
    pooled.length >= 2 ? kernelDensity(pooled, grid) : null,
    draw.samples
      .filter((sample) => sample.length >= 2)
      .map((sample) => kernelDensity(sample, grid)),
    "Sample Distribution",
    sampleMarks(mark, draw.samples, draw.thetas, pooled, marks),
    null,
  );

  // Only the statistics inside the window are binned. R bins the whole pile,
  // and its cell edges therefore follow the widest statistic drawn so far,
  // even though its device clips the bar that holds it. That is unreadable
  // under a population whose statistic does not settle: one sample mean out at
  // 800 makes every cell 100 units wide, and a 124-wide panel then shows one
  // flat bar. The count in the label still reports the whole pile.
  const countable = sampleTheta.filter(
    (theta) => theta >= window.min && theta <= window.max,
  );
  const counted = countable.length > 0 ? histogram(countable) : null;
  drawStatisticPanel(
    ctx,
    width,
    height,
    window,
    counted,
    sampleTheta.length,
    // The third panel's axis holds the value of the statistic itself, so the
    // pile average marks a place there even when the statistic is a spread.
    marks === null || marks.pile === null
      ? []
      : [{ kind: "location", value: marks.pile, center: 0, faint: false }],
  );

  return {
    state: { xMin: window.min, xMax: window.max, sampleTheta },
    samples: draw.samples,
    thetas: draw.thetas,
    histogram: counted,
    marks,
  };
}

/** One mark to draw in one panel. */
interface PanelMark {
  /** A place on the axis, or a distance from a center. */
  readonly kind: "location" | "spread";
  /** The value of the statistic. */
  readonly value: number;
  /** Where a span hangs from. A location mark ignores it. */
  readonly center: number;
  /** A per-sample mark, which draws thinner and paler. */
  readonly faint: boolean;
}

/**
 * Work out the three numbers the marks report.
 *
 * The population's value is the caller's. The sample's value is the statistic
 * of this call's pooled sample, which is the curve the middle panel draws
 * solid. The pile's value averages every statistic drawn so far.
 */
function markNumbers(
  mark: SamplingMarkOptions | undefined,
  theta: (sample: readonly number[]) => number,
  pooled: readonly number[],
  sampleTheta: readonly number[],
): SamplingMarks | null {
  if (mark === undefined) {
    return null;
  }
  return {
    population: mark.populationValue,
    sample: pooled.length > 0 ? theta(pooled) : null,
    pile: sampleTheta.length > 0 ? mean(sampleTheta) : null,
  };
}

/** The mark the population panel draws, if the population has one. */
function populationMarks(
  mark: SamplingMarkOptions | undefined,
): readonly PanelMark[] {
  if (mark === undefined || mark.populationValue === null) {
    return [];
  }
  if (mark.kind === "location") {
    return [
      { kind: "location", value: mark.populationValue, center: 0, faint: false },
    ];
  }
  const center = mark.populationCenter;
  if (center === null || center === undefined) {
    return [];
  }
  return [{ kind: "spread", value: mark.populationValue, center, faint: false }];
}

/**
 * The marks the middle panel draws: one faint mark per sample of this call,
 * and one solid mark for the pooled sample. The solid one is last, so it lands
 * on top of the faint ones. With one repetition the two coincide.
 */
function sampleMarks(
  mark: SamplingMarkOptions | undefined,
  samples: readonly (readonly number[])[],
  thetas: readonly number[],
  pooled: readonly number[],
  marks: SamplingMarks | null,
): readonly PanelMark[] {
  if (mark === undefined || marks === null || marks.sample === null) {
    return [];
  }
  const perSample = samples.map((sample, index) => ({
    kind: mark.kind,
    value: thetas[index] as number,
    center: sample.length > 0 ? mean(sample) : 0,
    faint: true,
  }));
  return [
    ...perSample,
    {
      kind: mark.kind,
      value: marks.sample,
      center: pooled.length > 0 ? mean(pooled) : 0,
      faint: false,
    },
  ];
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
  marks: readonly PanelMark[],
  note: string | null,
): void {
  const peak = main === null ? 1 : highestOf(main.y);
  const scale = samplingScale(width, height, panel, window, peak);
  drawAxes(ctx, scale, { frame: false, yAxis: false });
  // The label goes on even when there is no curve under it, so an empty
  // picture still says which panel is which.
  drawLabel(ctx, scale, [label], peak / 2, LABEL_FONT);
  if (note !== null) {
    drawMarkNote(ctx, scale, note, peak / 2);
  }

  if (main !== null) {
    // R plots the pooled curve, draws the per-sample curves over it, then
    // strokes the pooled curve again to bring it back to the front.
    drawCurve(
      ctx,
      scale,
      main,
      CURVE_COLOR,
      CURVE_WIDTH,
      panel === "population",
    );
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

  // The marks go last, so they sit on top of every curve.
  for (const mark of marks) {
    drawMark(ctx, scale, window, mark);
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
  marks: readonly PanelMark[],
): void {
  const tallest = counted === null ? 1 : highestOf(counted.counts);
  const scale = samplingScale(width, height, "statistic", window, tallest);
  drawAxes(ctx, scale, { frame: false, yAxis: false });

  if (counted !== null) {
    drawBars(ctx, scale, counted);
  }

  for (const mark of marks) {
    drawMark(ctx, scale, window, mark);
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
 * Draw one mark on one panel.
 *
 * A location mark is a vertical line at its value. A spread is a span from its
 * center out to that distance on each side, with a tick at each end, because a
 * distance drawn as a place says nothing.
 *
 * A value outside the frozen window gets a caret at that edge instead. The
 * window belongs to the population and never moves, so a mark can fall off the
 * picture. A clipped line and an absent line look the same, and a population
 * whose statistic does not settle produces both.
 */
function drawMark(
  ctx: Context2D,
  scale: Scale,
  window: Extent,
  mark: PanelMark,
): void {
  const color = mark.faint ? SAMPLE_MARK_COLOR : MARK_COLOR;
  const lineWidth = mark.faint ? SAMPLE_MARK_WIDTH : MARK_WIDTH;

  if (mark.kind === "location") {
    if (isInside(window, mark.value)) {
      drawMarkLine(ctx, scale, mark.value, color, lineWidth);
    } else {
      drawCaret(ctx, scale, mark.value > window.max, color);
    }
    return;
  }

  const low = mark.center - mark.value;
  const high = mark.center + mark.value;
  drawMarkSpan(ctx, scale, low, high, color, lineWidth);
  if (!isInside(window, low)) {
    drawCaret(ctx, scale, false, color);
  }
  if (!isInside(window, high)) {
    drawCaret(ctx, scale, true, color);
  }
}

/** Is a value inside the frozen window? */
function isInside(window: Extent, value: number): boolean {
  return value >= window.min && value <= window.max;
}

/** Draw a vertical line the full height of one panel. */
function drawMarkLine(
  ctx: Context2D,
  scale: Scale,
  value: number,
  color: string,
  lineWidth: number,
): void {
  const { area } = scale;
  const px = scale.toPixelX(value);

  ctx.save();
  clipToArea(ctx, area);
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(px, area.top);
  ctx.lineTo(px, area.bottom);
  ctx.stroke();
  ctx.restore();
}

/** Draw a horizontal span across the middle of one panel, ticked at each end. */
function drawMarkSpan(
  ctx: Context2D,
  scale: Scale,
  low: number,
  high: number,
  color: string,
  lineWidth: number,
): void {
  const { area } = scale;
  const y = (area.top + area.bottom) / 2;
  const left = scale.toPixelX(low);
  const right = scale.toPixelX(high);

  ctx.save();
  clipToArea(ctx, area);
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  ctx.moveTo(left, y - MARK_TICK);
  ctx.lineTo(left, y + MARK_TICK);
  ctx.moveTo(right, y - MARK_TICK);
  ctx.lineTo(right, y + MARK_TICK);
  ctx.stroke();
  ctx.restore();
}

/** Draw a triangle at one edge of a panel, pointing out of the window. */
function drawCaret(
  ctx: Context2D,
  scale: Scale,
  atRight: boolean,
  color: string,
): void {
  const { area } = scale;
  const y = (area.top + area.bottom) / 2;
  const tip = atRight ? area.right : area.left;
  const base = atRight ? tip - CARET_SIZE : tip + CARET_SIZE;

  ctx.save();
  clipToArea(ctx, area);
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip, y);
  ctx.lineTo(base, y - CARET_SIZE / 2);
  ctx.lineTo(base, y + CARET_SIZE / 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Write the note that says the population has no such statistic.
 *
 * It goes under the panel's own label, at the same left edge, so the reader
 * finds it where the panel is named. It takes the mark color, because it
 * stands in place of the mark.
 */
function drawMarkNote(
  ctx: Context2D,
  scale: Scale,
  note: string,
  at: number,
): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = MARK_COLOR;
  ctx.font = COUNT_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(note, scale.area.left, scale.toPixelY(at) + LABEL_LINE_HEIGHT);
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
