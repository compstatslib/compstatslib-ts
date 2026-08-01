/**
 * The interactive regression: click to add a point, and watch the line move.
 *
 * This is the port of `interactive_regression()` in
 * `../compstatslib/R/regression_interactive.R`. R holds the points in a
 * reactive value and calls `plot_regr()` on every change, forwarding its `...`
 * arguments. This module does the same: it owns the points and the clicks, and
 * it hands every draw to `plotRegr`. It contains no drawing code and no
 * statistics.
 *
 * R's `runGadget()` blocks and returns the points when the user clicks "Done".
 * A browser blocks at nothing, so this returns a handle at once. Read the
 * points from `getPoints()`, or call `done()` to hand them to the `onDone`
 * callback.
 */

import type { Point } from "../core/regression";
import { pixelInArea } from "../plot/axes";
import { plotRegr, regrScale } from "../plot/regr";
import type { PlotRegrOptions } from "../plot/regr";
import { eventPixel, resolveInteractiveTarget } from "./target";
import type { InteractiveTarget } from "./target";

/**
 * What the component accepts.
 *
 * The options of `plotRegr` pass through to it unchanged. This is the
 * equivalent of R's `...` forwarding.
 */
export interface InteractiveRegressionOptions extends PlotRegrOptions {
  /** Points to start from. R takes these as its `points` argument. */
  readonly initialPoints?: readonly Point[];
  /** What to run on `done()`. */
  readonly onDone?: (points: readonly Point[]) => void;
}

/** What the caller holds after the component starts. */
export interface InteractiveRegressionHandle {
  /** Return the points collected so far, in click order. */
  getPoints(): readonly Point[];
  /** Drop every point and redraw. This drops the initial points too. */
  reset(): void;
  /** Hand the points to the `onDone` callback. */
  done(): void;
  /** Stop listening. The points stay readable. */
  destroy(): void;
}

/**
 * Start an interactive regression on a target.
 *
 * The component draws at once, so an empty start shows empty axes. Each click
 * inside the plot area adds one point and redraws. A click outside the plot
 * area does nothing, because the world window of the plot ends at the edge of
 * that area and a point beyond it would not appear.
 *
 * @param target A canvas, or a surface and an element. See `./target.ts`.
 * @param options Points to start from, a done callback, and the options of
 * `plotRegr`.
 * @returns The handle to the running component.
 * @throws Error If a canvas gives no 2D context.
 */
export function interactiveRegression(
  target: InteractiveTarget,
  options: InteractiveRegressionOptions = {},
): InteractiveRegressionHandle {
  const { initialPoints, onDone, ...plotOptions } = options;
  const { surface, element } = resolveInteractiveTarget(target);
  const scale = regrScale(surface.width, surface.height);

  let points: readonly Point[] = initialPoints ?? [];

  function draw(): void {
    plotRegr(surface, points, plotOptions);
  }

  function handleClick(event: MouseEvent): void {
    const pixel = eventPixel(element, surface, event);
    if (!pixelInArea(scale.area, pixel)) {
      return;
    }
    points = [
      ...points,
      { x: scale.toWorldX(pixel.x), y: scale.toWorldY(pixel.y) },
    ];
    draw();
  }

  draw();
  element.addEventListener("click", handleClick);

  return {
    getPoints: () => [...points],
    reset() {
      points = [];
      draw();
    },
    done() {
      onDone?.([...points]);
    },
    destroy() {
      element.removeEventListener("click", handleClick);
    },
  };
}
