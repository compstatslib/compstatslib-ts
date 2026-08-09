/**
 * The interactive PCA: click to add a point, and watch the components turn.
 *
 * This is the port of `interactive_pca()` in
 * `../compstatslib/R/pca_interactive.R`. R holds the points in a reactive
 * value and calls `plot_pca()` on every change. This module does the same: it
 * owns the points and the clicks, and it hands every draw to `plotPca`. It
 * contains no drawing code and no statistics.
 *
 * R's `runGadget()` blocks and returns `list(points, pca)` when the user
 * clicks "Done". A browser blocks at nothing, so this returns a handle at
 * once. Read the two through `getPoints()` and `getFit()`, or call `done()` to
 * hand both to the `onDone` callback.
 *
 * **A click is taken as it comes.** R appends `data.frame(x = click$x,
 * y = click$y)` with no clamp, no rounding, and no test that the click landed
 * inside the plot area — and shiny reports a coordinate for a click anywhere
 * on the plot image, margins included. So this accepts a click anywhere on the
 * surface and keeps the world coordinate whole. That is a deliberate
 * difference from `interactiveRegression`, which ignores a click outside the
 * plot area because its window ends there, and from `interactiveLogit`, which
 * must clamp and round because its outcome is 0 or 1. Here a point outside the
 * window is a real state, and the plot clips it out of sight while it goes on
 * counting towards the components.
 */

import type { PcaResult } from "../core/pca";
import type { Point } from "../core/regression";
import { pcaScale, plotPca } from "../plot/pca";
import type { PlotPcaOptions } from "../plot/pca";
import { eventPixel, resolveInteractiveTarget } from "./target";
import type { InteractiveTarget } from "./target";

/**
 * What `done()` hands over: R's `list(points = ..., pca = ...)`.
 *
 * R's `pca` field is `fit` here. Inside a component that is already about
 * PCA, a field called `pca` says nothing, and "the fit" is what this port
 * calls the thing a plot computed from a set of points everywhere else —
 * `plotRegression` and `plotLogit` both return one.
 */
export interface InteractivePcaResult {
  /** The points collected, in click order. */
  readonly points: readonly Point[];
  /** What the last draw computed, or null below three points. */
  readonly fit: PcaResult | null;
}

/**
 * What the component accepts.
 *
 * The options of `plotPca` pass through to it unchanged. This is the
 * equivalent of R's `...` forwarding, though R's own `interactive_pca()`
 * exposes only `meancenter` and leaves the window at the `plot_pca` defaults.
 */
export interface InteractivePcaOptions extends PlotPcaOptions {
  /** Points to start from. R starts from an empty data frame. */
  readonly initialPoints?: readonly Point[];
  /** What to run on `done()`. */
  readonly onDone?: (result: InteractivePcaResult) => void;
}

/** What the caller holds after the component starts. */
export interface InteractivePcaHandle {
  /** Return the points collected so far, in click order. */
  getPoints(): readonly Point[];
  /**
   * Return what the last draw computed.
   *
   * Null below three points, which is `plot_pca`'s own guard: R's
   * `pca_result` holds whatever the last `plot_pca()` returned, and that is
   * NULL there too.
   */
  getFit(): PcaResult | null;
  /** Drop every point and redraw. This drops the initial points too. */
  reset(): void;
  /** Hand the points and the fit to the `onDone` callback. */
  done(): void;
  /** Stop listening. The points and the fit stay readable. */
  destroy(): void;
}

/**
 * Start an interactive PCA on a target.
 *
 * The component draws at once, so an empty start shows empty axes. Each click
 * adds one point and redraws. From the third point the two component arrows
 * appear and turn with every point after it.
 *
 * @param target A canvas, or a surface and an element. See `./target.ts`.
 * @param options Points to start from, a done callback, and the options of
 *   `plotPca`.
 * @returns The handle to the running component.
 * @throws Error If a canvas gives no 2D context.
 */
export function interactivePca(
  target: InteractiveTarget,
  options: InteractivePcaOptions = {},
): InteractivePcaHandle {
  const { initialPoints, onDone, ...plotOptions } = options;
  const { surface, element } = resolveInteractiveTarget(target);

  let points: readonly Point[] = initialPoints ?? [];
  let fit: PcaResult | null = null;

  function draw(): void {
    fit = plotPca(surface, points, plotOptions);
  }

  function handleClick(event: MouseEvent): void {
    // Built fresh for every click. The window is fixed, but `asp = 1` ties it
    // to the size of the surface, so a scale kept from an earlier size would
    // put the point somewhere plausible and wrong.
    const scale = pcaScale(surface.width, surface.height, plotOptions);
    const pixel = eventPixel(element, surface, event);
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
    getFit: () => fit,
    reset() {
      points = [];
      draw();
    },
    done() {
      onDone?.({ points: [...points], fit });
    },
    destroy() {
      element.removeEventListener("click", handleClick);
    },
  };
}
