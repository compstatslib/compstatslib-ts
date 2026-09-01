/**
 * The matrix inverse plot: a matrix and its inverse, each as a parallelogram
 * with an arrow along each column.
 *
 * This is the drawing half of `plot_matrix_inverse()` in
 * `../compstatslib/R/matrix_inverse_plot.R`. Every number it draws comes from
 * `invertMatrix` in `src/core/matrix.ts`; this module computes no arithmetic
 * of its own. The picture teaches one thing: the area of each parallelogram is
 * the determinant of the matrix that spans it, so a matrix that stretches
 * space has an inverse that squeezes it, and the two areas are reciprocal.
 *
 * Three things here differ from the other plots in this port.
 *
 * **A matrix with no inverse leaves the canvas untouched.** `solve(A)` is the
 * second line of the R function and `plot(NA, ...)` is the fourth, so R stops
 * with an error before it opens a window. Traced on a null device, the
 * singular case makes no graphics call at all. This function does the same and
 * returns the report, which names the reason. A caller that redraws while a
 * control moves has to clear its own surface, because this function will not.
 *
 * **The window does not hold its aspect.** The R call passes no `asp`, unlike
 * `plot_pca()`, so a square in the data is a square on screen only on a square
 * plot area. Measured in R, `par("usr")` reads -3.24 3.24 -3.24 3.24 on a 10
 * by 5 inch device and the same on a 5 by 5 inch one. The parallelograms shear
 * with the surface, and that is R's picture.
 *
 * **The arrowhead is a physical size.** R asks for `length = 0.25`, measured
 * in inches, so the head does not shrink with a short vector. A vector short
 * enough loses its arrow altogether: see `MIN_ARROW_PIXELS` in `draw.ts`.
 */

import { invertMatrix } from "../core/matrix.js";
import type { Matrix2, MatrixInversion } from "../core/matrix.js";
import { createScale, drawAxes } from "./axes.js";
import type { Extent, Scale } from "./axes.js";
import { clearSurface, clipToArea, drawArrow } from "./draw.js";
import { resolveTarget } from "./target.js";
import type { Context2D, PlotTarget } from "./target.js";

/** R: `xlim = c(-3, 3)` and `ylim = c(-3, 3)`, fixed in the function body. */
const WORLD: Extent = { min: -3, max: 3 };

/** R's `rgb(1, 0, 0, 0.1)`, the fill of the matrix. */
const MATRIX_FILL = "#FF00001A";
/** R's `rgb(0, 0, 1, 0.1)`, the fill of the inverse. */
const INVERSE_FILL = "#0000FF1A";
/** R's `rgb(0, 0, 0, 0.3)`, the border of both parallelograms. */
const BORDER_COLOR = "#0000004D";
/** R's `arrows()` draws in `par("fg")`, which is black, at `lwd = 1`. */
const ARROW_COLOR = "#000000";
const LINE_WIDTH = 1;
/**
 * The length of an arrowhead edge, in pixels.
 *
 * R asks for `length = 0.25`, measured in inches, which is 24 at the 96 pixels
 * an inch a browser assumes. The value does not follow the length of the arrow
 * or the size of the window, so a short vector carries a large head — which is
 * what R draws.
 */
const HEAD_LENGTH = 24;

/**
 * Build the scale that `plotMatrixInverse` draws through.
 *
 * The window is R's fixed -3 to 3 on both axes. The two axes are scaled
 * separately, as R scales them: a wide surface makes a wide picture. Unlike R,
 * the limits are the literal ones — R pads a range by 4% first, and this port
 * drops that padding everywhere.
 *
 * @param width The pixel width of the surface.
 * @param height The pixel height of the surface.
 * @returns The map between world values and pixels.
 */
export function matrixInverseScale(width: number, height: number): Scale {
  return createScale({ width, height, x: WORLD, y: WORLD });
}

/**
 * Draw the matrix and its inverse.
 *
 * A matrix with no inverse draws nothing — not the axes, not the background.
 * See the note on this module: R stops before it draws, and the report this
 * function returns says why.
 *
 * @param target A canvas, or a context and a size. See `./target.ts`.
 * @param matrix The matrix, as two columns. See `Matrix2`.
 * @returns The determinant, the inverse, and the singularity, exactly as
 *   `invertMatrix` reports them. R returns nothing, but a browser caller needs
 *   the numbers it has just drawn — and needs the reason when nothing was
 *   drawn.
 */
export function plotMatrixInverse(
  target: PlotTarget,
  matrix: Matrix2,
): MatrixInversion {
  const inversion = invertMatrix(matrix);
  // The target is resolved first, so a target that cannot be drawn to reports
  // that whether or not the matrix has an inverse. Resolving draws nothing.
  const { ctx, width, height } = resolveTarget(target);

  if (inversion.inverse === null) {
    return inversion;
  }

  const scale = matrixInverseScale(width, height);
  clearSurface(ctx, width, height);
  // R: `frame.plot = FALSE` drops the box and keeps both axes. R names the two
  // titles explicitly, because `plot(NA, ...)` otherwise deparses the missing
  // value it was passed into them and the axes read "Index" and "NA".
  drawAxes(ctx, scale, { frame: false, xLabel: "x", yLabel: "y" });

  // R's device clips the plot region; canvas clips nothing. This is not a
  // detail here: the inverse of a nearly singular matrix has entries in the
  // hundreds, and the window is three units wide.
  const { area } = scale;
  ctx.save();
  clipToArea(ctx, area);

  drawMatrix(ctx, scale, matrix, MATRIX_FILL);
  drawMatrix(ctx, scale, inversion.inverse, INVERSE_FILL);

  ctx.restore();
  return inversion;
}

/**
 * Draw one matrix: the parallelogram its columns span, then an arrow along
 * each column. R's `plot_matrix_det()`.
 */
function drawMatrix(
  ctx: Context2D,
  scale: Scale,
  matrix: Matrix2,
  fill: string,
): void {
  drawParallelogram(ctx, scale, matrix, fill);
  drawColumnArrow(ctx, scale, matrix.x1, matrix.y1);
  drawColumnArrow(ctx, scale, matrix.x2, matrix.y2);
}

/**
 * Draw the parallelogram the two columns span.
 *
 * R's corners are the origin, the first column, the sum of the columns, and
 * the second column. `polygon()` closes the outline itself; this returns to
 * the origin to close it, which is the same shape.
 */
function drawParallelogram(
  ctx: Context2D,
  scale: Scale,
  matrix: Matrix2,
  fill: string,
): void {
  const corners = [
    [0, 0],
    [matrix.x1, matrix.y1],
    [matrix.x1 + matrix.x2, matrix.y1 + matrix.y2],
    [matrix.x2, matrix.y2],
    [0, 0],
  ] as const;

  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = fill;
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = LINE_WIDTH;
  ctx.beginPath();
  corners.forEach(([x, y], index) => {
    const px = scale.toPixelX(x);
    const py = scale.toPixelY(y);
    if (index === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  });
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw one arrow from the origin to a column vector.
 *
 * The head goes at the far end alone, which is what `arrows()` does with its
 * default `code = 2`.
 */
function drawColumnArrow(
  ctx: Context2D,
  scale: Scale,
  x: number,
  y: number,
): void {
  const tail = [scale.toPixelX(0), scale.toPixelY(0)] as const;
  const tip = [scale.toPixelX(x), scale.toPixelY(y)] as const;

  drawArrow(ctx, tail, tip, {
    headLength: HEAD_LENGTH,
    color: ARROW_COLOR,
    lineWidth: LINE_WIDTH,
  });
}
