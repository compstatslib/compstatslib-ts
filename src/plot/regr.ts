/**
 * The regression plot: points, the mean crosshair, the fitted line, and a
 * block of statistics.
 *
 * This is the drawing half of `plot_regr()` in
 * `../compstatslib/R/regression_plot.R`. Every number it draws comes from
 * `linearRegression` in `src/core/regression.ts`; this module computes no
 * statistics of its own.
 */

import { mean } from "../core/arith";
import { linearRegression } from "../core/regression";
import type { Point, RegressionFit } from "../core/regression";
import { createScale, drawAxes } from "./axes";
import type { Extent, Scale } from "./axes";
import { resolveTarget } from "./target";
import type { Context2D, PlotTarget } from "./target";

/** What to show. Both default to true, as in R. */
export interface PlotRegrOptions {
  /** Draw the mean crosshair and the fitted line. */
  readonly regression?: boolean;
  /** List the statistics at the top left. Needs `regression`. */
  readonly stats?: boolean;
}

/** R: `xlim = c(-5, max_x)` and `ylim = c(-5, max_x)`, with `max_x = 50`. */
const WORLD: Extent = { min: -5, max: 50 };

const BACKGROUND = "#ffffff";
/** R's `col = "gray"` is #BEBEBE. The CSS colour of that name is darker. */
const POINT_COLOR = "#bebebe";
const CROSSHAIR_COLOR = "lightgray";
const LINE_COLOR = "cornflowerblue";
const TEXT_COLOR = "#000000";
/** R: `pch = 19, cex = 2`. */
const POINT_RADIUS = 6;
/** R: `lty = "dotted"`. */
const DOTTED = [1, 3];
const STATS_FONT = "12px monospace";
const STATS_LINE_HEIGHT = 15;
const STATS_PADDING = 8;
const STATS_LABEL_WIDTH = 13;

/**
 * Build the scale that `plotRegr` draws through.
 *
 * The interactive layer needs this to turn a click into a world coordinate.
 * It reads the scale from here so that the world window stays defined in one
 * place. Nothing outside this module may restate it.
 *
 * @param width The pixel width of the surface.
 * @param height The pixel height of the surface.
 * @returns The map between world values and pixels.
 */
export function regrScale(width: number, height: number): Scale {
  return createScale({ width, height, x: WORLD, y: WORLD });
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
export function plotRegr(
  target: PlotTarget,
  points: readonly Point[],
  options: PlotRegrOptions = {},
): RegressionFit | null {
  const { ctx, width, height } = resolveTarget(target);
  const showRegression = options.regression ?? true;
  const showStats = options.stats ?? true;
  const scale = regrScale(width, height);

  ctx.setLineDash([]);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  drawAxes(ctx, scale, { xLabel: "x", yLabel: "y" });

  const fit = linearRegression(points);
  if (fit === null) {
    return null;
  }

  drawPoints(ctx, scale, points);
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

/** Draw each point as a filled dot. */
function drawPoints(
  ctx: Context2D,
  scale: Scale,
  points: readonly Point[],
): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = POINT_COLOR;
  for (const point of points) {
    ctx.beginPath();
    ctx.arc(
      scale.toPixelX(point.x),
      scale.toPixelY(point.y),
      POINT_RADIUS,
      0,
      2 * Math.PI,
    );
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw the two dotted segments that mark the means.
 *
 * R: `segments(0, mean_y, max_x, mean_y)` and
 * `segments(mean_x, 0, mean_x, mean_y)`. The vertical segment stops at the
 * horizontal one.
 */
function drawMeanCrosshair(
  ctx: Context2D,
  scale: Scale,
  points: readonly Point[],
): void {
  const meanX = mean(points.map((point) => point.x));
  const meanY = mean(points.map((point) => point.y));

  ctx.save();
  ctx.strokeStyle = CROSSHAIR_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash(DOTTED);
  ctx.beginPath();
  ctx.moveTo(scale.toPixelX(0), scale.toPixelY(meanY));
  ctx.lineTo(scale.toPixelX(WORLD.max), scale.toPixelY(meanY));
  ctx.moveTo(scale.toPixelX(meanX), scale.toPixelY(0));
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
  const { area } = scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.left, area.top, area.width, area.height);
  ctx.clip();
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(
    scale.toPixelX(WORLD.min),
    scale.toPixelY(intercept + slope * WORLD.min),
  );
  ctx.lineTo(
    scale.toPixelX(WORLD.max),
    scale.toPixelY(intercept + slope * WORLD.max),
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

/**
 * Round to two decimals for display, and report a missing value as R does.
 *
 * R prints `round(x, 2)`, which drops a trailing zero, so 2.50 reads as "2.5".
 * R rounds half to even and this rounds half away from zero; the two differ
 * only on an exact half at the third decimal.
 */
function formatStat(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "NA";
  }
  return String(Math.round(value * 100) / 100);
}
