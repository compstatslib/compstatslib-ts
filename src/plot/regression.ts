/**
 * The regression plot: points, the mean crosshair, the fitted line, and a
 * block of statistics.
 *
 * This is the drawing half of `plot_regression()` in
 * `../compstatslib/R/regression_plot.R`. Every number it draws comes from
 * `linearRegression` in `src/core/regression.ts`; this module computes no
 * statistics of its own.
 */

import { mean } from "../core/arith";
import { linearRegression } from "../core/regression";
import type { Point, RegressionFit } from "../core/regression";
import { createScale, drawAxes, extentOf } from "./axes";
import { formatStat } from "./format";
import type { Extent, Scale } from "./axes";
import { DOTTED, clearSurface, clipToArea, drawDots } from "./draw";
import { resolveTarget } from "./target";
import type { Context2D, PlotTarget } from "./target";

/** What to show, and where. The toggles default to true, as in R. */
export interface PlotRegressionOptions {
  /** Draw the mean crosshair and the fitted line. */
  readonly regression?: boolean;
  /** List the statistics at the top left. Needs `regression`. */
  readonly stats?: boolean;
  /** The x limits, R's `xlim`. Both default to R's `c(-5, 50)`. */
  readonly xlim?: readonly [number, number];
  /** The y limits, R's `ylim`. */
  readonly ylim?: readonly [number, number];
}

/** R: `xlim = c(-5, max_x)` and `ylim = c(-5, max_x)`, with `max_x = 50`. */
const WORLD: Extent = { min: -5, max: 50 };

const CROSSHAIR_COLOR = "lightgray";
const LINE_COLOR = "cornflowerblue";
const TEXT_COLOR = "#000000";
const STATS_FONT = "12px monospace";
const STATS_LINE_HEIGHT = 15;
const STATS_PADDING = 8;
const STATS_LABEL_WIDTH = 13;

/**
 * Build the scale that `plotRegression` draws through.
 *
 * The interactive layer needs this to turn a click into a world coordinate.
 * It reads the scale from here so that the world window stays defined in one
 * place. Nothing outside this module may restate it.
 *
 * @param width The pixel width of the surface.
 * @param height The pixel height of the surface.
 * @param options The limits. A reversed pair reads as the range it spans, not
 *   as a flipped axis. Omitted limits keep the R teaching window.
 * @returns The map between world values and pixels.
 */
export function regressionScale(
  width: number,
  height: number,
  options: PlotRegressionOptions = {},
): Scale {
  return createScale({
    width,
    height,
    x: options.xlim ? extentOf(options.xlim) : WORLD,
    y: options.ylim ? extentOf(options.ylim) : WORLD,
  });
}

/**
 * Draw the points and their regression.
 *
 * With no points, the function draws empty axes. With one point, it draws the
 * point alone, because a single point has no line to fit. R stops at the same
 * two places.
 *
 * @param target A canvas, or a context and a size. See `./target.ts`.
 * @param points The observations, in world coordinates.
 * @param options What to show.
 * @returns The fit that the plot drew, or null if there are no points. R
 * returns the points instead, which the caller already holds.
 */
export function plotRegression(
  target: PlotTarget,
  points: readonly Point[],
  options: PlotRegressionOptions = {},
): RegressionFit | null {
  const { ctx, width, height } = resolveTarget(target);
  const showRegression = options.regression ?? true;
  const showStats = options.stats ?? true;
  const scale = regressionScale(width, height, options);

  clearSurface(ctx, width, height);
  drawAxes(ctx, scale, { xLabel: "x", yLabel: "y" });

  const fit = linearRegression(points);
  if (fit === null) {
    return null;
  }

  drawDots(ctx, scale, points);
  if (points.length < 2 || !showRegression) {
    return fit;
  }

  drawMeanCrosshair(ctx, scale, points);
  if (fit.slope !== null) {
    drawFittedLine(ctx, scale, fit.intercept, fit.slope);
  }
  if (showStats) {
    drawStats(ctx, scale, fit);
  }
  return fit;
}

/**
 * Draw the two dotted segments that mark the means.
 *
 * R: `segments(0, mean_y, max_x, mean_y)` and
 * `segments(mean_x, 0, mean_x, mean_y)`. The vertical segment stops at the
 * horizontal one. R's window always contains its 0 origin; a custom window
 * that does not clamps that origin to its nearest edge, so the segments span
 * the window instead of leaving it.
 */
function drawMeanCrosshair(
  ctx: Context2D,
  scale: Scale,
  points: readonly Point[],
): void {
  const meanX = mean(points.map((point) => point.x));
  const meanY = mean(points.map((point) => point.y));
  const { x, y } = scale.world;
  const originX = Math.min(Math.max(0, x.min), x.max);
  const originY = Math.min(Math.max(0, y.min), y.max);

  ctx.save();
  ctx.strokeStyle = CROSSHAIR_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash(DOTTED);
  ctx.beginPath();
  ctx.moveTo(scale.toPixelX(originX), scale.toPixelY(meanY));
  ctx.lineTo(scale.toPixelX(x.max), scale.toPixelY(meanY));
  ctx.moveTo(scale.toPixelX(meanX), scale.toPixelY(originY));
  ctx.lineTo(scale.toPixelX(meanX), scale.toPixelY(meanY));
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw the fitted line across the plot area.
 *
 * R's `abline()` draws across the whole plot region, so this draws the line at
 * both edges of the world window and clips it to the area. A steep line then
 * leaves through the top or the bottom, as it does in R.
 */
function drawFittedLine(
  ctx: Context2D,
  scale: Scale,
  intercept: number,
  slope: number,
): void {
  const { area, world } = scale;
  ctx.save();
  clipToArea(ctx, area);
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(
    scale.toPixelX(world.x.min),
    scale.toPixelY(intercept + slope * world.x.min),
  );
  ctx.lineTo(
    scale.toPixelX(world.x.max),
    scale.toPixelY(intercept + slope * world.x.max),
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * List the statistics at the top left, in a monospace block.
 *
 * R draws this with `legend("topleft", ...)` under `par(family = "mono")`.
 */
function drawStats(ctx: Context2D, scale: Scale, fit: RegressionFit): void {
  const rows: readonly (readonly [string, number | null])[] = [
    ["Raw intercept", fit.intercept],
    ["Raw slope", fit.slope],
    ["Correlation", fit.correlation],
    ["SSR", fit.ssr],
    ["SSE", fit.sse],
    ["SST", fit.sst],
    ["R-squared", fit.rSquared],
  ];

  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = STATS_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const [index, [label, value]] of rows.entries()) {
    ctx.fillText(
      `${label.padEnd(STATS_LABEL_WIDTH)}: ${formatStat(value)}`,
      scale.area.left + STATS_PADDING,
      scale.area.top + STATS_PADDING + index * STATS_LINE_HEIGHT,
    );
  }
  ctx.restore();
}
