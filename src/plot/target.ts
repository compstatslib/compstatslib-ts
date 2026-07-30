/**
 * The drawing surface that every 2D plot writes to.
 *
 * R's base graphics draw to a current device. Nothing here does: a plot
 * function receives its target and draws only to that target.
 *
 * `Context2D` lists the exact members of `CanvasRenderingContext2D` that this
 * library uses. A real context satisfies the type, and a test can pass any
 * object that implements those members. This matters because happy-dom has no
 * 2D canvas context, so a DOM alone cannot exercise a plot function. See
 * `test/recording-context.ts` for the stub the plot tests use.
 */

/** The part of a canvas 2D context that the plot functions draw through. */
export type Context2D = Pick<
  CanvasRenderingContext2D,
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "save"
  | "restore"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "rect"
  | "fillRect"
  | "clip"
  | "fill"
  | "stroke"
  | "fillText"
  | "setLineDash"
  | "translate"
  | "rotate"
>;

/** A context together with the pixel size of its surface. */
export interface RenderTarget {
  readonly ctx: Context2D;
  readonly width: number;
  readonly height: number;
}

/**
 * What a plot function accepts.
 *
 * Pass a canvas in a browser. Pass a `RenderTarget` to draw through your own
 * context, which is how the tests run without a DOM.
 */
export type PlotTarget = HTMLCanvasElement | RenderTarget;

/** Reduce a plot target to a context and a size. */
export function resolveTarget(target: PlotTarget): RenderTarget {
  if ("ctx" in target) {
    return target;
  }
  const ctx = target.getContext("2d");
  if (ctx === null) {
    throw new Error(
      "plot target: the canvas gave no 2D context. In tests, pass " +
        "{ ctx, width, height } instead of a canvas element.",
    );
  }
  return { ctx, width: target.width, height: target.height };
}
