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

/**
 * A drawing surface and an element to build controls in, held apart.
 *
 * This is the `SplitTarget` idea again, for a component driven by a panel of
 * controls rather than by clicks on the picture. A test passes the two parts,
 * so it can drive the inputs without a real layout and without a canvas that
 * happy-dom cannot give a context to.
 */
export interface PanelTarget {
  /** Where the component draws. */
  readonly surface: RenderTarget;
  /** Where the component builds its inputs. The caller keeps this element. */
  readonly controls: HTMLElement;
}

/**
 * What a control-driven component accepts.
 *
 * Pass a container element in a browser and the component fills it. Pass a
 * `PanelTarget` to hold the two parts apart, which is how the tests run.
 */
export type ControlTarget = HTMLElement | PanelTarget;

/** A resolved panel, and a way to take back anything that was built for it. */
export interface ResolvedPanel {
  readonly surface: RenderTarget;
  readonly controls: HTMLElement;
  /** Remove what this resolver created. A no-op when the caller supplied it. */
  release(): void;
}

/** R lays the gadget out as a 140px column of controls beside the plot. */
const CONTROL_COLUMN_WIDTH = 140;
const FALLBACK_WIDTH = 640;
const FALLBACK_HEIGHT = 400;

/**
 * Reduce a control target to a surface and a place to build controls.
 *
 * Given a container, this builds the canvas and the controls column inside it
 * in R's arrangement, and `release()` takes them out again. Given the parts,
 * it passes them through and `release()` does nothing, because the caller owns
 * what it supplied.
 *
 * @param target A container element, or a surface and a controls host.
 * @returns The two parts and a way to undo what was built.
 * @throws Error If a container is a canvas, or if a created canvas gives no 2D
 * context.
 */
export function resolveControlTarget(target: ControlTarget): ResolvedPanel {
  if ("surface" in target) {
    return {
      surface: target.surface,
      controls: target.controls,
      release: () => undefined,
    };
  }

  if (target.tagName === "CANVAS") {
    throw new Error(
      "interactive target: pass a container element to build the panel in, " +
        "not a canvas. A canvas has no room for the controls.",
    );
  }

  const owner = target.ownerDocument;
  const controls = owner.createElement("div");
  controls.style.width = `${CONTROL_COLUMN_WIDTH}px`;
  controls.style.flexShrink = "0";
  controls.style.padding = "4px 6px";
  controls.style.overflowY = "auto";

  const canvas = owner.createElement("canvas");
  canvas.width =
    target.clientWidth > CONTROL_COLUMN_WIDTH
      ? target.clientWidth - CONTROL_COLUMN_WIDTH
      : FALLBACK_WIDTH;
  canvas.height =
    target.clientHeight > 0 ? target.clientHeight : FALLBACK_HEIGHT;
  canvas.style.flex = "1";
  canvas.style.minWidth = "0";

  target.style.display = "flex";
  target.appendChild(controls);
  target.appendChild(canvas);

  const remove = (): void => {
    controls.remove();
    canvas.remove();
  };

  try {
    return { surface: resolveTarget(canvas), controls, release: remove };
  } catch (error) {
    // Leave the container as it was found rather than half filled.
    remove();
    throw error;
  }
}
