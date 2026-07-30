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

/**
 * Reduce a plot target to a context and a size.
 *
 * A canvas reports the size of its pixel store, which is the size the plot
 * draws in. On a dense screen those two part company: the store has to hold
 * more pixels than the layout does, or the browser stretches the image and
 * softens every edge.
 *
 * This function never touches a canvas the caller passed in — the caller owns
 * it, and resizing it under them would throw away whatever else they drew. So
 * a caller who wants a crisp picture on such a screen does three things:
 *
 * 1. size the store at the layout size times `devicePixelRatio`, and set the
 *    CSS width and height to the layout size;
 * 2. call `ctx.scale(ratio, ratio)` once, so drawing carries on in layout
 *    pixels;
 * 3. pass `{ ctx, width, height }` with the **layout** size, rather than the
 *    canvas.
 *
 * The third step matters. Handing over the canvas would report the store size
 * on top of a context that already scales, and the picture would come out at
 * the square of the ratio. Reporting layout pixels also keeps `eventPixel`
 * right, since it divides the surface size by the size of the client
 * rectangle. `resolveControlTarget` in `../interactive/target.ts` does all
 * three for the canvas it builds itself.
 */
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
