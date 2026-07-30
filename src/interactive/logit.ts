/**
 * The interactive logit: click to add an outcome, and watch the curve move.
 *
 * This is the port of `interactive_logit()` in
 * `../compstatslib/R/logit_interactive.R`. R holds the points in a reactive
 * value and calls `plot_logit()` on every change, forwarding its `...`
 * arguments. This module does the same: it owns the points and the clicks, and
 * it hands every draw to `plotLogit`. It contains no drawing code and no
 * statistics.
 *
 * R's `runGadget()` blocks and returns the points when the user clicks "Done".
 * A browser blocks at nothing, so this returns a handle at once. Read the
 * points from `getPoints()`, or call `done()` to hand them to the `onDone`
 * callback.
 */

import type { Point } from "../core/regression";
import { logitScale, plotLogit } from "../plot/logit";
import type { PlotLogitOptions } from "../plot/logit";
import type { Scale } from "../plot/axes";
import { eventPixel, resolveInteractiveTarget } from "./target";
import type { InteractiveTarget } from "./target";

/**
 * What the component accepts.
 *
 * The options of `plotLogit` pass through to it unchanged. This is the
 * equivalent of R's `...` forwarding.
 */
export interface InteractiveLogitOptions extends PlotLogitOptions {
  /** Points to start from. R takes these as its `points` argument. */
  readonly initialPoints?: readonly Point[];
  /** What to run on `done()`. */
  readonly onDone?: (points: readonly Point[]) => void;
}

/** What the caller holds after the component starts. */
export interface InteractiveLogitHandle {
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
 * R: `interactive_logit(points, formula, min_x = 0, max_x = 50, ...)`.
 *
 * The right edge is 50 here and 1 in `plot_logit()`. The two genuinely differ
 * in R: the gadget opens on a wide window to click into, and the plotting
 * function opens on the narrow one its own default implies.
 */
const DEFAULT_MIN_X = 0;
const DEFAULT_MAX_X = 50;

/**
 * Start an interactive logit on a target.
 *
 * The component draws at once, so an empty start shows empty axes. Each click
 * inside the plot area adds one point and redraws. A click outside that area
 * does nothing, because the world window ends at the edge of the area and a
 * point beyond it would not appear.
 *
 * @param target A canvas, or a surface and an element. See `./target.ts`.
 * @param options Points to start from, a done callback, and the options of
 * `plotLogit`.
 * @returns The handle to the running component.
 * @throws Error If a canvas gives no 2D context.
 */
export function interactiveLogit(
  target: InteractiveTarget,
  options: InteractiveLogitOptions = {},
): InteractiveLogitHandle {
  const {
    initialPoints,
    onDone,
    minX = DEFAULT_MIN_X,
    maxX = DEFAULT_MAX_X,
    ...plotOptions
  } = options;
  const { surface, element } = resolveInteractiveTarget(target);

  let points: readonly Point[] = initialPoints ?? [];

  // R widens the right edge once, from the points it was handed
  // (`if (nrow(points) > 0) max_x <- max(max_x, points[[x_name]])`), and holds
  // that value for the rest of the session. Nothing collected later can push
  // past it, because every click is clamped to it.
  const rightEdge = points.reduce(
    (edge, point) => Math.max(edge, point.x),
    maxX,
  );

  function draw(): void {
    plotLogit(surface, points, { ...plotOptions, minX, maxX: rightEdge });
  }

  function handleClick(event: MouseEvent): void {
    // The window follows the points, so the scale is read again on each click
    // rather than held from the start: a point outside the default window
    // moves every pixel of the picture. `logitScale` is the one place that
    // window is defined, and `plotLogit` draws through the same call.
    const scale = logitScale(surface.width, surface.height, points, {
      minX,
      maxX: rightEdge,
    });
    const pixel = eventPixel(element, surface, event);
    if (!insidePlotArea(scale, pixel)) {
      return;
    }

    points = [
      ...points,
      {
        // R: `click_x <- max(0, min(max_x, click$x))`. The lower bound is zero
        // rather than `min_x`, so a click left of the origin lands on it even
        // when the window opens further left. That is R's rule as written.
        x: clamp(scale.toWorldX(pixel.x), 0, rightEdge),
        // R: `click_y <- round(click$y)`. This is what makes every outcome a 0
        // or a 1, which `logisticRegression` requires. JavaScript rounds an
        // exact half up and R rounds it to even, so a click on the half line
        // itself becomes a 1 here and a 0 in R. The same deviation is already
        // recorded for `formatStat`.
        y: Math.round(clamp(scale.toWorldY(pixel.y), 0, 1)),
      },
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

/** Report whether a pixel lies in the plot area. An edge counts as inside. */
function insidePlotArea(
  scale: Scale,
  pixel: { readonly x: number; readonly y: number },
): boolean {
  const { area } = scale;
  return (
    pixel.x >= area.left &&
    pixel.x <= area.right &&
    pixel.y >= area.top &&
    pixel.y <= area.bottom
  );
}

/** Hold a value between two bounds. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
