/**
 * The logistic-regression plot: the points, the fitted probability curve, and
 * a small block of statistics.
 *
 * This is the drawing half of `plot_logit()` and `plot_points_logit()` in
 * `../compstatslib/R/logit_plot.R`. Every number it draws comes from
 * `logisticRegression` in `src/core/logit.ts`; this module computes no
 * statistics of its own.
 */

import { logisticRegression, predictLogit } from "../core/logit";
import type { LogitFit } from "../core/logit";
import type { Point } from "../core/regression";
import { createScale, drawAxes } from "./axes";
import type { Extent, Scale } from "./axes";
import { formatStat } from "./format";
import { resolveTarget } from "./target";
import type { Context2D, PlotTarget } from "./target";

/**
 * Which corner of the plot area the statistics block sits in.
 *
 * R's `legend()` takes nine positions. These four are the ones a block of
 * text reads well in, and one of them is R's own default here.
 */
export type LegendLocation =
  | "topleft"
  | "topright"
  | "bottomleft"
  | "bottomright";

/** What to draw. R's defaults throughout. */
export interface PlotLogitOptions {
  /** Fit the model and draw its curve. True by default. */
  readonly regression?: boolean;
  /** List the statistics in a corner. Needs `regression`. True by default. */
  readonly stats?: boolean;
  /** Left edge of the window, before the data widen it. R's `min_x`, 0. */
  readonly minX?: number;
  /** Right edge of the window, before the data widen it. R's `max_x`, 1. */
  readonly maxX?: number;
  /** Corner for the statistics. R's `legend_loc`, "topleft". */
  readonly legendLoc?: LegendLocation;
}

/** R: `ylim = c(0, 1)`, the range of a probability. */
const WORLD_Y: Extent = { min: 0, max: 1 };
/** R: `min_x = 0, max_x = 1`, before the data widen them. */
const DEFAULT_MIN_X = 0;
const DEFAULT_MAX_X = 1;

const BACKGROUND = "#ffffff";
/** R's `col = "gray"` is #BEBEBE. The CSS colour of that name is darker. */
const POINT_COLOR = "#bebebe";
const HALF_LINE_COLOR = "lightgray";
const CURVE_COLOR = "cornflowerblue";
const TEXT_COLOR = "#000000";
/** R: `pch = 19, cex = 2`. */
const POINT_RADIUS = 6;
/** R: `lty = "dotted"`. */
const DOTTED = [1, 3];
/** R: `lwd = 2` on the curve. */
const CURVE_WIDTH = 2;
/** R: `seq(min_x, max_x, len = 500)`. */
const CURVE_SAMPLES = 500;
/** R: `abline(h = 0.5)`, the probability that divides the two outcomes. */
const HALF = 0.5;

const STATS_FONT = "12px monospace";
const STATS_LINE_HEIGHT = 15;
const STATS_PADDING = 8;
/** The width R pads its labels to, from `"Coefficient: "`. */
const STATS_LABEL_WIDTH = 11;

/**
 * Build the scale that `plotLogit` draws through.
 *
 * Unlike the regression plot, whose window is fixed, this one follows the
 * data: R starts at `min_x` and `max_x` and then widens them to cover every
 * point (`max_x <- max(max_x, points[[x_name]])`). The vertical window is
 * always a probability, 0 to 1.
 *
 * The interactive layer reads the scale from here, so the window stays
 * defined in one place. Nothing outside this module may restate it.
 *
 * @param width The pixel width of the surface.
 * @param height The pixel height of the surface.
 * @param points The observations the window has to cover.
 * @param options The same options `plotLogit` takes.
 * @returns The map between world values and pixels.
 */
export function logitScale(
  width: number,
  height: number,
  points: readonly Point[],
  options: PlotLogitOptions = {},
): Scale {
  const min = points.reduce(
    (low, point) => Math.min(low, point.x),
    options.minX ?? DEFAULT_MIN_X,
  );
  const max = points.reduce(
    (high, point) => Math.max(high, point.x),
    options.maxX ?? DEFAULT_MAX_X,
  );
  return createScale({ width, height, x: { min, max }, y: WORLD_Y });
}

/**
 * Draw the points and their fitted probability curve.
 *
 * With fewer than two points the function draws what it has and fits nothing.
 * R stops at the same two places: it returns before `glm()` on an empty frame,
 * and again on a single point. The core would fit that single point — R's
 * `glm()` does, reporting a saturated intercept and no slope — but the plot
 * never asks it to, so neither does this.
 *
 * @param target A canvas, or a context and a size. See `./target.ts`.
 * @param points The observations. Each y must be 0 or 1.
 * @param options What to show and how wide to open the window.
 * @returns The fit the plot drew, or null if it drew none. R returns the
 * points instead, which the caller already holds.
 */
export function plotLogit(
  target: PlotTarget,
  points: readonly Point[],
  options: PlotLogitOptions = {},
): LogitFit | null {
  const { ctx, width, height } = resolveTarget(target);
  const showRegression = options.regression ?? true;
  const showStats = options.stats ?? true;
  const legendLocation = options.legendLoc ?? "topleft";
  const scale = logitScale(width, height, points, options);

  ctx.setLineDash([]);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  drawAxes(ctx, scale, { xLabel: "x", yLabel: "y" });

  drawPoints(ctx, scale, points);
  // R draws this after the points, and draws it on an empty frame too:
  // plot_points_logit() ends with abline(h = 0.5) whether or not it had data.
  drawHalfLine(ctx, scale);

  if (points.length < 2 || !showRegression) {
    return null;
  }

  const fit = logisticRegression(points);
  if (fit === null) {
    return null;
  }

  drawCurve(ctx, scale, fit);
  if (showStats) {
    drawStats(ctx, scale, fit, legendLocation);
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

/** Draw the dotted line at one half. R: `abline(h = 0.5)`. */
function drawHalfLine(ctx: Context2D, scale: Scale): void {
  const { area } = scale;
  ctx.save();
  ctx.strokeStyle = HALF_LINE_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash(DOTTED);
  ctx.beginPath();
  ctx.moveTo(area.left, scale.toPixelY(HALF));
  ctx.lineTo(area.right, scale.toPixelY(HALF));
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw the fitted probability across the window.
 *
 * R builds the curve from 500 predictions spread over the same window it
 * plotted, so this samples the same number at the same places. The curve stays
 * inside the window by construction, since a probability cannot leave 0 to 1,
 * but it is clipped to the plot area all the same: R's base graphics clip
 * every line to the plot region and canvas clips nothing.
 */
function drawCurve(ctx: Context2D, scale: Scale, fit: LogitFit): void {
  const { area, world } = scale;
  const span = world.x.max - world.x.min;
  const samples = Array.from({ length: CURVE_SAMPLES }, (_unused, index) => {
    const x = world.x.min + (span * index) / (CURVE_SAMPLES - 1);
    return {
      px: scale.toPixelX(x),
      py: scale.toPixelY(predictLogit(fit, x)),
    };
  });

  ctx.save();
  ctx.beginPath();
  ctx.rect(area.left, area.top, area.width, area.height);
  ctx.clip();
  ctx.strokeStyle = CURVE_COLOR;
  ctx.lineWidth = CURVE_WIDTH;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const [index, { px, py }] of samples.entries()) {
    if (index === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * List the statistics in one corner, in a monospace block.
 *
 * R draws this with `legend(legend_loc, ...)` under `par(family = "mono")`,
 * pasting three padded labels against `round(value, 2)`. An aliased slope
 * reads "NA", because that is what R's `round(NA, 2)` pastes.
 *
 * A block anchored to the bottom is held inside the plot area rather than
 * allowed to ride up past the top of it. R relies on base graphics clipping
 * text at the plot region, which canvas does not do.
 */
function drawStats(
  ctx: Context2D,
  scale: Scale,
  fit: LogitFit,
  location: LegendLocation,
): void {
  const rows: readonly (readonly [string, number | null])[] = [
    ["Intercept", fit.intercept],
    ["Coefficient", fit.slope],
    ["AIC", fit.aic],
  ];
  const { area } = scale;
  const onRight = location === "topright" || location === "bottomright";
  const atBottom = location === "bottomleft" || location === "bottomright";
  const x = onRight ? area.right - STATS_PADDING : area.left + STATS_PADDING;
  const top = atBottom
    ? Math.max(
        area.top + STATS_PADDING,
        area.bottom - STATS_PADDING - rows.length * STATS_LINE_HEIGHT,
      )
    : area.top + STATS_PADDING;

  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = STATS_FONT;
  ctx.textAlign = onRight ? "right" : "left";
  ctx.textBaseline = "top";
  for (const [index, [label, value]] of rows.entries()) {
    ctx.fillText(
      `${label.padEnd(STATS_LABEL_WIDTH)}: ${formatStat(value)}`,
      x,
      top + index * STATS_LINE_HEIGHT,
    );
  }
  ctx.restore();
}
