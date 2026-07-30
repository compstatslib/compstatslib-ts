/**
 * The target that every interactive component attaches to.
 *
 * An interactive component needs two things: a surface to draw on and an
 * element that reports the clicks. A canvas is both, so a browser caller
 * passes one canvas.
 *
 * A test cannot pass a canvas. happy-dom gives a canvas no 2D context, so
 * nothing can draw to it. A test therefore passes the two things apart: a
 * recording surface to draw to, and a real element to dispatch events at. This
 * split is the pattern for every module in `src/interactive/`.
 */

import { resolveTarget } from "../plot/target";
import type { RenderTarget } from "../plot/target";

/** The part of an element that an interactive component listens to. */
export type ClickSource = Pick<
  HTMLElement,
  "addEventListener" | "removeEventListener" | "getBoundingClientRect"
>;

/** A surface and an element, held apart. */
export interface SplitTarget {
  /** Where the component draws. */
  readonly surface: RenderTarget;
  /** Where the component listens. */
  readonly element: ClickSource;
}

/** What an interactive component accepts. */
export type InteractiveTarget = HTMLCanvasElement | SplitTarget;

/**
 * Reduce an interactive target to a surface and an element.
 *
 * @param target A canvas, or a surface and an element.
 * @returns The two parts.
 * @throws Error If a canvas gives no 2D context.
 */
export function resolveInteractiveTarget(
  target: InteractiveTarget,
): SplitTarget {
  if ("surface" in target) {
    return target;
  }
  return { surface: resolveTarget(target), element: target };
}

/**
 * Convert the position of a mouse event to a pixel of the surface.
 *
 * CSS may show a canvas at a size other than its pixel size. The function
 * therefore scales the position by the ratio of the two. A rectangle of zero
 * width or height carries no ratio, so the function reads the client position
 * as a surface pixel. Only a hidden element and a stub report such a
 * rectangle.
 *
 * @param element The element that received the event.
 * @param surface The drawing surface and its pixel size.
 * @param event The mouse event.
 * @returns The pixel column and row of the event.
 */
export function eventPixel(
  element: ClickSource,
  surface: RenderTarget,
  event: MouseEvent,
): { readonly x: number; readonly y: number } {
  const rect = element.getBoundingClientRect();
  const scaleX = rect.width === 0 ? 1 : surface.width / rect.width;
  const scaleY = rect.height === 0 ? 1 : surface.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}
