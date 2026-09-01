/**
 * The PCA plot: the points, and an arrow along each principal component.
 *
 * This is the drawing half of `plot_pca()` in `../compstatslib/R/pca_plot.R`.
 * Every number it draws comes from `principalComponents` in
 * `src/core/pca.ts`; this module computes no statistics of its own.
 *
 * Two things here differ from every earlier plot in this port.
 *
 * **The window keeps equal units on both axes.** R's call passes `asp = 1`,
 * which makes a right angle on the data look like a right angle on screen —
 * the whole point of a picture about perpendicular components. R holds the
 * limits it was given on whichever axis constrains the fit and widens the
 * other about its middle; `pcaScale` does the same. Measured from R on a null
 * device with `xlim = ylim = c(-50, 50)`: a 10 by 5 inch device reports
 * `par("usr")` of `-149.696 149.696 -54 54`, and a 5 by 10 inch device
 * reports `-54 54 -117.191 117.191`.
 *
 * **Mean-centering is not a statistical option.** It moves the arrows'
 * anchor and nothing else. The components are the same either way, because
 * R's `prcomp` centers internally whatever it is handed (fixture F7 shows the
 * two runs agreeing bit for bit), and the points on screen are the raw ones —
 * R plots `points`, not `mc_points`.
 */

import { principalComponents } from "../core/pca.js";
import type { PcaResult } from "../core/pca.js";
import type { Point } from "../core/regression.js";
import { DEFAULT_MARGINS, createScale, drawAxes, extentOf } from "./axes.js";
import type { Extent, Scale } from "./axes.js";
import { DOTTED, clearSurface, clipToArea, drawArrow, drawDots } from "./draw.js";
import { resolveTarget } from "./target.js";
import type { Context2D, PlotTarget } from "./target.js";

/** R's `plot_pca()` arguments, less the points. */
export interface PlotPcaOptions {
  /**
   * Anchor the arrows on the middle of the data. True by default, as in R.
   *
   * False anchors them on the origin instead. Nothing else changes: not the
   * components, not the points, only where the arrows are drawn.
   */
  readonly meancenter?: boolean;
  /** The x limits, R's `xlim`. Both default to R's `c(-50, 50)`. */
  readonly xlim?: readonly [number, number];
  /** The y limits, R's `ylim`. */
  readonly ylim?: readonly [number, number];
}

/** R: `xlim = c(-50, 50)` and `ylim = c(-50, 50)`. */
const DEFAULT_LIMITS: readonly [number, number] = [-50, 50];

/**
 * The length of an arrowhead edge, in pixels.
 *
 * R asks for `length = 0.1`, measured in inches. At the 96 pixels per inch a
 * browser calls an inch that is 9.6, rounded here to a round 10.
 */
const HEAD_LENGTH = 10;

/**
 * Build the scale that `plotPca` draws through, with equal units per pixel.
 *
 * The interactive layer needs this to turn a click into a world coordinate.
 * It reads the scale from here so the window rule stays in one place.
 *
 * Both requested ranges are honoured or widened, never narrowed: the axis
 * that needs the most world per pixel keeps its limits, and the other grows
 * about its middle until the two agree. Unlike R, the constraining axis keeps
 * the literal limits it was given — R would pad them by 4% first, and this
 * port drops that padding everywhere.
 *
 * @param width The pixel width of the surface.
 * @param height The pixel height of the surface.
 * @param options The limits. A reversed pair reads as the range it spans, not
 *   as a flipped axis.
 * @returns The map between world values and pixels.
 */
export function pcaScale(
  width: number,
  height: number,
  options: PlotPcaOptions = {},
): Scale {
  const x = extentOf(options.xlim ?? DEFAULT_LIMITS);
  const y = extentOf(options.ylim ?? DEFAULT_LIMITS);
  const areaWidth = width - DEFAULT_MARGINS.left - DEFAULT_MARGINS.right;
  const areaHeight = height - DEFAULT_MARGINS.top - DEFAULT_MARGINS.bottom;

  const perPixel = Math.max(
    (x.max - x.min) / areaWidth,
    (y.max - y.min) / areaHeight,
  );
  // A surface too small to hold a plot area, or a pair of limits with no
  // width at all, leaves nothing to equalize. The window stays as asked and
  // `createScale` handles the degenerate span.
  if (!(areaWidth > 0 && areaHeight > 0 && perPixel > 0)) {
    return createScale({ width, height, x, y });
  }

  return createScale({
    width,
    height,
    x: widenedTo(x, perPixel * areaWidth),
    y: widenedTo(y, perPixel * areaHeight),
  });
}

/**
 * Draw the points and the arrows along their principal components.
 *
 * R guards this drawing at three sizes, and so does this. With no points it
 * draws an empty pair of axes. Below three points it draws the points alone:
 * two points always lie on a line, so the second component would be an arrow
 * of no length and the first would say only what the eye already sees. The
 * core will answer for one or two points; this asks it only from three, which
 * is R's own `nrow(points) >= 3`.
 *
 * @param target A canvas, or a context and a size. See `./target.ts`.
 * @param points The observations, in world coordinates.
 * @param options The anchor and the window.
 * @returns The components drawn, or null below three points. R returns the
 *   same `prcomp` result, invisibly, and NULL at the same two guards.
 */
export function plotPca(
  target: PlotTarget,
  points: readonly Point[],
  options: PlotPcaOptions = {},
): PcaResult | null {
  const { ctx, width, height } = resolveTarget(target);
  const scale = pcaScale(width, height, options);

  clearSurface(ctx, width, height);
  drawAxes(ctx, scale, { xLabel: "x", yLabel: "y" });

  if (points.length === 0) {
    return null;
  }

  // R's device clips the plot region; canvas clips nothing. A fixed window of
  // -50 to 50 says nothing about where the points are, so this matters.
  const { area } = scale;
  ctx.save();
  clipToArea(ctx, area);

  drawDots(ctx, scale, points);

  const result = points.length >= 3 ? principalComponents(points) : null;
  if (result !== null) {
    // R's anchor is `mc_diff`, which is the column means under `meancenter`
    // and the origin otherwise. R also drops to the origin at one point,
    // which no arrow can reach: it takes three points to get here.
    const anchor = (options.meancenter ?? true) ? result.center : ORIGIN;
    drawComponent(ctx, scale, result, anchor, 0, []);
    drawComponent(ctx, scale, result, anchor, 1, DOTTED);
  }

  ctx.restore();
  return result;
}

const ORIGIN: Point = { x: 0, y: 0 };

/** Grow an extent to a span, keeping its middle where it is. */
function widenedTo(extent: Extent, span: number): Extent {
  const middle = (extent.min + extent.max) / 2;
  return { min: middle - span / 2, max: middle + span / 2 };
}

/**
 * Draw one component as an arrow through the anchor.
 *
 * R's `vec` matrix is the loading vector scaled by the component's standard
 * deviation, and the arrow runs from `-vec` to `+vec` about the anchor — so
 * its length shows how much spread the component carries. The head goes at
 * the `+vec` end alone, which is what `arrows()` does with its default
 * `code = 2`.
 */
function drawComponent(
  ctx: Context2D,
  scale: Scale,
  result: PcaResult,
  anchor: Point,
  component: 0 | 1,
  dash: readonly number[],
): void {
  const loadings = result.rotation[component];
  const sdev = result.sdev[component];
  const tail = [
    scale.toPixelX(anchor.x - loadings[0] * sdev),
    scale.toPixelY(anchor.y - loadings[1] * sdev),
  ] as const;
  const tip = [
    scale.toPixelX(anchor.x + loadings[0] * sdev),
    scale.toPixelY(anchor.y + loadings[1] * sdev),
  ] as const;

  drawArrow(ctx, tail, tip, { headLength: HEAD_LENGTH, dash });
}
