/**
 * Shared drawing primitives for the 2D plots.
 *
 * The post-port reuse audit found each of these written out in most of the
 * `plot/` modules, byte for byte. They live here so a change to any of them
 * reaches every plot at once. `axes.ts` keeps what belongs to an axis: the
 * world-to-pixel scale, the tick rule, and the frame.
 *
 * Nothing here reads a scale's world window. Each function takes pixels, so a
 * caller keeps its own world geometry and this file stays about the canvas.
 */

import type { PlotArea, Scale } from "./axes";
import type { Context2D } from "./target";
import type { Point } from "../core/regression";

/** R: `lty = "dotted"`. */
export const DOTTED = [1, 3];

/** R's `col = "gray"` is #BEBEBE. The CSS color of that name is darker. */
const POINT_COLOR = "#bebebe";
/** R: `pch = 19, cex = 2`. */
const POINT_RADIUS = 6;

/** R's `arrows()` draws in `par("fg")`, which is black. */
const ARROW_COLOR = "#000000";
const ARROW_WIDTH = 1;
/** R: `angle = 30`, the default, measured from the shaft. */
const HEAD_ANGLE = Math.PI / 6;
/**
 * The shortest arrow that still gets drawn, in pixels.
 *
 * `?arrows`: "The direction of a zero-length arrow is indeterminate, and
 * hence so is the direction of the arrowheads. To allow for rounding error,
 * arrowheads are omitted (with a warning) on any arrow of length less than
 * 1/1000 inch." That is this many pixels at the 96 pixels per inch a browser
 * calls an inch. R still draws the shaft, which covers no distance and so
 * paints nothing; this skips the whole arrow, which leaves the same picture
 * and keeps an indeterminate direction from reaching the arrowhead as a NaN.
 *
 * Both callers reach it in ordinary use: a principal component with no spread
 * — identical points, or points on a line — and a matrix with one column near
 * zero, which still has an inverse.
 */
const MIN_ARROW_PIXELS = 96 / 1000;

/** Paint the whole surface white, the color of a fresh R device. */
export function clearSurface(
  ctx: Context2D,
  width: number,
  height: number,
): void {
  ctx.setLineDash([]);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
}

/**
 * Keep drawing inside the plot area, as base graphics does by default.
 *
 * R's device clips the plot region and canvas clips nothing, so every plot
 * that can put ink outside its window needs this. The caller saves and
 * restores around it: the clip lifts with the state it was set in.
 */
export function clipToArea(ctx: Context2D, area: PlotArea): void {
  ctx.beginPath();
  ctx.rect(area.left, area.top, area.width, area.height);
  ctx.clip();
}

/** Draw each point as a filled dot. R: `pch = 19, cex = 2, col = "gray"`. */
export function drawDots(
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

/** How an arrow is drawn. The defaults are R's `arrows()` defaults. */
export interface ArrowOptions {
  /** The length of an arrowhead edge, in pixels. R measures it in inches. */
  readonly headLength: number;
  /** The dash pattern. R's `lty` covers the head as well as the shaft. */
  readonly dash?: readonly number[];
  readonly color?: string;
  readonly lineWidth?: number;
}

/**
 * Draw one arrow between two pixel positions.
 *
 * The head goes at the tip alone, which is what `arrows()` does with its
 * default `code = 2`. An arrow too short to have a direction is skipped
 * whole: see `MIN_ARROW_PIXELS`.
 */
export function drawArrow(
  ctx: Context2D,
  tail: readonly [number, number],
  tip: readonly [number, number],
  options: ArrowOptions,
): void {
  const {
    headLength,
    dash = [],
    color = ARROW_COLOR,
    lineWidth = ARROW_WIDTH,
  } = options;

  const length = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]);
  if (!Number.isFinite(length) || length < MIN_ARROW_PIXELS) {
    return;
  }

  // Back along the shaft from the tip, then a turn each way for the head.
  const back = Math.atan2(tail[1] - tip[1], tail[0] - tip[0]);
  const edge = (turn: number): readonly [number, number] => [
    tip[0] + headLength * Math.cos(back + turn),
    tip[1] + headLength * Math.sin(back + turn),
  ];

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([...dash]);
  ctx.beginPath();
  ctx.moveTo(tail[0], tail[1]);
  ctx.lineTo(tip[0], tip[1]);
  const [firstX, firstY] = edge(HEAD_ANGLE);
  const [secondX, secondY] = edge(-HEAD_ANGLE);
  ctx.moveTo(firstX, firstY);
  ctx.lineTo(tip[0], tip[1]);
  ctx.lineTo(secondX, secondY);
  ctx.stroke();
  ctx.restore();
}
