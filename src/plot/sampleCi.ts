/**
 * One row per sample, each showing what that sample says about the mean it
 * came from — the drawing half of `plot_sample_ci()` in
 * `../compstatslib/R/sample_ci_plot.R`.
 *
 * The population is simulated, so its mean is known and drawn as a vertical
 * line. Each sample gets a row: a wide 99% interval, a 95% interval over it,
 * and a diamond at the sample mean. Rows whose intervals miss the true mean
 * are drawn again in coral over the blue, which is the whole lesson of the
 * picture — at 95% confidence, about one row in twenty should miss.
 *
 * Drawing order is faithful to R and is not incidental. R draws every row in
 * the good colours, then draws the missing ones again on top, then the mean
 * line last:
 *
 * ```r
 * segments_ci(..., good = TRUE)              # every row, skyblue
 * segments_ci(...[bad], bad, good = FALSE)   # the misses again, coral
 * abline(v = mean(population_data))
 * ```
 *
 * Within one of those calls R works in three vectorised passes — every 99%
 * span, then every 95% span, then every point — rather than finishing a row
 * at a time. This does the same, so overlapping neighbours stack as they do
 * in R.
 *
 * The statistics all come from `simulateSampleCi` in `src/core/sampling.ts`;
 * this module computes none of its own.
 */

import type { Rng } from "../core/rng";
import { seededRng } from "../core/rng";
import { simulateSampleCi } from "../core/sampling";
import type {
  SampleCiOptions,
  SampleCiSimulation,
  SampleInterval,
} from "../core/sampling";
import { createScale, drawAxes } from "./axes";
import type { Scale } from "./axes";
import { clearSurface, clipToArea } from "./draw";
import { resolveTarget } from "./target";
import type { Context2D, PlotTarget } from "./target";

/** What to draw. R's `plot_sample_ci()` arguments, plus the generator. */
export interface PlotSampleCiOptions extends SampleCiOptions {
  /**
   * Where the randomness comes from.
   *
   * One call draws one picture, so unlike the sampling plot there is nothing
   * to carry between calls and the default is harmless. It is still built the
   * same way — a stream seeded once from `Math.random()` — so a page that
   * says nothing about seeds gets a fresh picture each time, and
   * `seededRng(42)` repeats one exactly.
   */
  readonly rng?: Rng;
}

/**
 * R's palette names, resolved with `col2rgb()`.
 *
 * Only `lightskyblue` and `lightcoral` are also CSS colour names. The other
 * four are R's own palette and mean nothing to a browser, so all six are
 * written as literals — the same choice slice 1 made when R's `gray` turned
 * out to be `#bebebe` rather than the darker CSS `gray`.
 */
const GOOD_COLORS = {
  span99: "#87cefa", // lightskyblue
  span95: "#6ca6cd", // skyblue3
  point: "#4a708b", // skyblue4
} as const;

const BAD_COLORS = {
  span99: "#f08080", // lightcoral
  span95: "#cd5b45", // coral3
  point: "#8b3e2f", // coral4
} as const;

const MEAN_LINE_COLOR = "#000000";
/** R: `lwd = 3` on both spans. */
const SPAN_WIDTH = 3;
/**
 * Half the height of a diamond, in pixels.
 *
 * R draws `pch = 18, cex = 0.6`. At the size this port gives `cex = 1`
 * elsewhere that would be under two pixels, which disappears on a dense
 * screen. Two and a half keeps the diamond visible and still fits the row
 * pitch at R's default of a hundred rows.
 */
const POINT_RADIUS = 2.5;

/**
 * Build the scale the plot draws through.
 *
 * The window is R's: half a standard deviation of the population each side of
 * its mean, which is deliberately too narrow to hold every interval — the
 * ones that run off the edge are the interesting ones. Rows count upward from
 * one, so the first sample sits at the foot of the panel.
 *
 * A population with no spread leaves the width undefined. R stops there, on
 * a non-finite `xlim`. This opens a unit window around the mean instead, so
 * the frame and its axes still draw.
 *
 * @param width The pixel width of the surface.
 * @param height The pixel height of the surface.
 * @param simulation What `simulateSampleCi` returned.
 * @returns The map between world values and pixels.
 */
export function sampleCiScale(
  width: number,
  height: number,
  simulation: SampleCiSimulation,
): Scale {
  const centre = Number.isFinite(simulation.populationMean)
    ? simulation.populationMean
    : 0;
  const half = Number.isFinite(simulation.populationSd)
    ? simulation.populationSd / 2
    : 0.5;

  return createScale({
    width,
    height,
    x: { min: centre - half, max: centre + half },
    y: { min: 1, max: Math.max(1, simulation.intervals.length) },
  });
}

/**
 * Simulate a population, sample it, and draw what each sample says.
 *
 * A sample too small to have a spread gives an interval of NaN, which R would
 * report as NA. Such a row is left undrawn rather than turned into a shape at
 * a meaningless coordinate; the row still appears in the returned simulation,
 * where the caller can see the NaN for what it is.
 *
 * @param target A canvas, or a context and a size. See `./target.ts`.
 * @param options The sizes, the population's distribution, and the generator.
 * @returns The simulation drawn — the population's mean and spread, and every
 *   sample's interval — so a caller need not run it again to read it.
 * @throws RangeError If the sample size is larger than the population, or a
 *   count is negative or fractional. Both come from the core, which is where
 *   R's own refusals live.
 */
export function plotSampleCi(
  target: PlotTarget,
  options: PlotSampleCiOptions = {},
): SampleCiSimulation {
  const { ctx, width, height } = resolveTarget(target);
  const {
    rng = seededRng(Math.floor(Math.random() * 0x100000000)),
    ...simulationOptions
  } = options;

  const simulation = simulateSampleCi(rng, simulationOptions);
  const scale = sampleCiScale(width, height, simulation);

  clearSurface(ctx, width, height);
  drawAxes(ctx, scale, {
    xLabel: "Confidence Intervals",
    yLabel: "Samples",
  });

  // R's device clips the plot region; canvas clips nothing. The window is
  // narrower than the widest interval by design, so this is load-bearing.
  const { area } = scale;
  ctx.save();
  clipToArea(ctx, area);

  const rows = simulation.intervals
    .map((interval, index) => ({ interval, row: index + 1 }))
    .filter(({ interval }) => isDrawable(interval));

  drawRows(ctx, scale, rows, GOOD_COLORS);
  drawRows(
    ctx,
    scale,
    rows.filter(({ interval }) => interval.excludesPopulationMean),
    BAD_COLORS,
  );
  drawPopulationMean(ctx, scale, simulation.populationMean);

  ctx.restore();
  return simulation;
}

/** One row's worth of drawing, and which sample it belongs to. */
interface Row {
  readonly interval: SampleInterval;
  readonly row: number;
}

/** Whether a row has finite bounds to draw. */
function isDrawable(interval: SampleInterval): boolean {
  return (
    Number.isFinite(interval.mean) &&
    Number.isFinite(interval.ci95.low) &&
    Number.isFinite(interval.ci95.high) &&
    Number.isFinite(interval.ci99.low) &&
    Number.isFinite(interval.ci99.high)
  );
}

/**
 * Draw a set of rows in one colour scheme, in R's three passes.
 *
 * The wider interval goes down first so the narrower one reads on top of it,
 * and the sample mean goes over both.
 */
function drawRows(
  ctx: Context2D,
  scale: Scale,
  rows: readonly Row[],
  colors: { span99: string; span95: string; point: string },
): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = SPAN_WIDTH;

  ctx.strokeStyle = colors.span99;
  for (const { interval, row } of rows) {
    drawSpan(ctx, scale, interval.ci99.low, interval.ci99.high, row);
  }

  ctx.strokeStyle = colors.span95;
  for (const { interval, row } of rows) {
    drawSpan(ctx, scale, interval.ci95.low, interval.ci95.high, row);
  }

  ctx.fillStyle = colors.point;
  for (const { interval, row } of rows) {
    drawDiamond(ctx, scale, interval.mean, row);
  }

  ctx.restore();
}

/** Draw one horizontal span at a row. R: `segments(low, i, high, i)`. */
function drawSpan(
  ctx: Context2D,
  scale: Scale,
  low: number,
  high: number,
  row: number,
): void {
  const y = scale.toPixelY(row);
  ctx.beginPath();
  ctx.moveTo(scale.toPixelX(low), y);
  ctx.lineTo(scale.toPixelX(high), y);
  ctx.stroke();
}

/** Draw the sample mean. R: `points(mean, i, pch = 18)`, a filled diamond. */
function drawDiamond(
  ctx: Context2D,
  scale: Scale,
  at: number,
  row: number,
): void {
  const x = scale.toPixelX(at);
  const y = scale.toPixelY(row);
  ctx.beginPath();
  ctx.moveTo(x, y - POINT_RADIUS);
  ctx.lineTo(x + POINT_RADIUS, y);
  ctx.lineTo(x, y + POINT_RADIUS);
  ctx.lineTo(x - POINT_RADIUS, y);
  ctx.fill();
}

/** Draw the true mean down the panel. R: `abline(v = mean(population))`. */
function drawPopulationMean(
  ctx: Context2D,
  scale: Scale,
  at: number,
): void {
  if (!Number.isFinite(at)) {
    return;
  }
  const { area } = scale;
  const x = scale.toPixelX(at);

  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = MEAN_LINE_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, area.top);
  ctx.lineTo(x, area.bottom);
  ctx.stroke();
  ctx.restore();
}
