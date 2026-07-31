/**
 * Tests for the matrix inverse plot, ported from `plot_matrix_inverse()` in
 * `../compstatslib/R/matrix_inverse_plot.R`.
 *
 * These are structural checks: the test counts the shapes that reach the
 * context, reads their styles, and recovers the coordinates they were drawn
 * at. It does not compare pixels with base R. The numbers behind the arrows
 * are R-verified in `src/core/matrix.test.ts`; nothing here re-derives them.
 *
 * The R code being ported:
 *
 * ```r
 * plot_matrix_inverse <- function(x1, y1, x2, y2) {
 *   A <- matrix(c(x1, y1, x2, y2), nrow = 2)
 *   Ainv <- solve(A)
 *   A_col <- rgb(1, 0, 0, 0.1)
 *   Ainv_col <- rgb(0, 0, 1, 0.1)
 *   plot(NA, xlim = c(-3, 3), ylim = c(-3, 3), frame.plot = FALSE)
 *   plot_matrix_det(A, A_col)
 *   plot_matrix_det(Ainv, Ainv_col)
 * }
 * plot_matrix_det <- function(M, col) {
 *   polygon(c(0, M[1,1], M[1,1] + M[1,2], M[1,2]),
 *           c(0, M[2,1], M[2,1] + M[2,2], M[2,2]),
 *           col = col, border = rgb(0, 0, 0, 0.3))
 *   arrows(0, 0, M[1,1], M[2,1])
 *   arrows(0, 0, M[1,2], M[2,2])
 * }
 * ```
 *
 * Five details of that code decide what the tests below expect, and each was
 * read out of R rather than assumed. They are in
 * `.claude/plans/matrix-inverse-fixtures.md`, section 3, which pinned them by
 * tracing the graphics primitives on a null device.
 *
 * 1. **A singular matrix draws nothing at all.** `solve(A)` is the second
 *    line of the function and `plot(NA, ...)` is the fourth, so an error from
 *    `solve()` ends the call before any device is touched. The trace confirms
 *    it: for `plot_matrix_inverse(1, 1, 1, 1)` there is no `plot.default`, no
 *    `polygon` and no `arrows` output. Every other plot in this port answers a
 *    degenerate input with empty axes; this one answers with an empty canvas.
 * 2. **The window does not hold its aspect.** The call passes no `asp`, so
 *    world units per pixel differ between the axes on any surface that is not
 *    square, and the parallelograms shear. Measured in R: `par("usr")` is
 *    -3.24 3.24 -3.24 3.24 on a 10 by 5 inch device and the same four numbers
 *    on a 5 by 5 inch device. (R's ±3.24 is its 4% `xaxs = "r"` padding of
 *    ±3, which this port drops as it drops it everywhere.)
 * 3. **Both axes are drawn, the box is not.** `frame.plot = FALSE` removes
 *    `box()` and leaves `axes = TRUE`, exactly as the t-test plot does.
 * 4. **The colours are three fixed values.** `rgb(1,0,0,0.1)` is `#FF00001A`,
 *    `rgb(0,0,1,0.1)` is `#0000FF1A`, `rgb(0,0,0,0.3)` is `#0000004D`, each
 *    checked with `col2rgb(..., alpha = TRUE)`.
 * 5. **`arrows()` runs on its defaults**: `length = 0.25` inches, `angle =
 *    30`, `code = 2` (one head, at the far end), `par("fg")` black, `lty` and
 *    `lwd` at 1. The head is a fixed physical size, so it does not grow or
 *    shrink with the arrow.
 */

import { describe, expect, test } from "bun:test";

import { invertMatrix } from "../core/matrix";
import type { Matrix2 } from "../core/matrix";
import { RecordingContext } from "../../test/recording-context";
import type { DrawCall, DrawStyle } from "../../test/recording-context";
import { createScale, DEFAULT_MARGINS } from "./axes";
import type { Scale } from "./axes";
import { matrixInverseScale, plotMatrixInverse } from "./matrixInverse";
import type { RenderTarget } from "./target";

const WIDTH = 520;
const HEIGHT = 440;

/** R: `xlim = c(-3, 3)`, `ylim = c(-3, 3)`. */
const WORLD = { min: -3, max: 3 };

/** R's `rgb(1, 0, 0, 0.1)`, the fill of A. */
const A_FILL = "#FF00001A";
/** R's `rgb(0, 0, 1, 0.1)`, the fill of the inverse. */
const INVERSE_FILL = "#0000FF1A";
/** R's `rgb(0, 0, 0, 0.3)`, the border of both. */
const BORDER = "#0000004D";
const ARROW_COLOR = "#000000";
/** R: `length = 0.25` inches, at the 96 pixels an inch a browser assumes. */
const HEAD_LENGTH = 24;

/** The default of `interactive_matrix_inverse`: F1 of the fixtures. */
const DEFAULT_MATRIX: Matrix2 = { x1: 1, y1: 2, x2: 2, y2: 1 };
/** F5: four ones, which R reports as exactly singular. */
const EXACTLY_SINGULAR: Matrix2 = { x1: 1, y1: 1, x2: 1, y2: 1 };
/** F4a: R reports "computationally singular", with a nonzero determinant. */
const COMPUTATIONALLY_SINGULAR: Matrix2 = {
  x1: -2,
  y1: -1.6,
  x2: -1.5,
  y2: -1.2,
};
/** F4c: invertible, with an inverse of about 200 in a window of 3. */
const STRETCHED: Matrix2 = { x1: 2, y1: 1.9, x2: 1.9, y2: 1.8 };

function makeTarget(
  width = WIDTH,
  height = HEIGHT,
): { ctx: RecordingContext; target: RenderTarget } {
  const ctx = new RecordingContext();
  return { ctx, target: { ctx, width, height } };
}

/** The scale `plotMatrixInverse` draws through. */
function expectedScale(width = WIDTH, height = HEIGHT): Scale {
  return createScale({ width, height, x: WORLD, y: WORLD });
}

/** Where a world point lands, as a pixel pair. */
function pixel(
  scale: Scale,
  x: number,
  y: number,
): readonly [number, number] {
  return [scale.toPixelX(x), scale.toPixelY(y)];
}

function distance(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** One path built between a `beginPath` and the calls that consumed it. */
interface Path {
  readonly points: readonly (readonly [number, number])[];
  readonly filled: boolean;
  readonly stroked: boolean;
  readonly style: DrawStyle;
  /** The index in the call list where the path was opened. */
  readonly at: number;
}

/** The calls made after the plot area was clipped: the data, not the axes. */
function afterClip(ctx: RecordingContext): DrawCall[] {
  const index = ctx.calls.findIndex((call) => call.method === "clip");
  return index === -1 ? [] : ctx.calls.slice(index + 1);
}

/** Recover every path drawn inside the clip, in the order they were drawn. */
function paths(ctx: RecordingContext): Path[] {
  const found: Path[] = [];
  let points: (readonly [number, number])[] = [];
  let filled = false;
  let stroked = false;
  let style: DrawStyle | null = null;
  let at = -1;

  const flush = (): void => {
    if (style !== null && (filled || stroked)) {
      found.push({ points, filled, stroked, style, at });
    }
    points = [];
    filled = false;
    stroked = false;
    style = null;
  };

  afterClip(ctx).forEach((call, index) => {
    if (call.method === "beginPath") {
      flush();
      at = index;
    } else if (call.method === "moveTo" || call.method === "lineTo") {
      points.push([call.args[0] as number, call.args[1] as number]);
    } else if (call.method === "fill") {
      filled = true;
      style = call.style;
    } else if (call.method === "stroke") {
      stroked = true;
      style = call.style;
    }
  });
  flush();

  return found;
}

/** The two parallelograms: the paths that were filled. */
function polygons(ctx: RecordingContext): Path[] {
  return paths(ctx).filter((path) => path.filled);
}

/** The arrows: the black stroked paths that were not filled. */
function arrows(ctx: RecordingContext): Path[] {
  return paths(ctx).filter(
    (path) => !path.filled && path.style.strokeStyle === ARROW_COLOR,
  );
}

describe("matrixInverseScale", () => {
  test("holds R's fixed window of -3 to 3 on both axes", () => {
    const scale = matrixInverseScale(WIDTH, HEIGHT);

    expect(scale.world.x).toEqual(WORLD);
    expect(scale.world.y).toEqual(WORLD);
  });

  test("drops R's 4% padding, keeping the literal limits", () => {
    // R reports -3.24..3.24. Every plot in this port uses the window it was
    // given, and this one follows.
    const scale = matrixInverseScale(WIDTH, HEIGHT);

    expect(scale.world.x.min).toBe(-3);
    expect(scale.world.x.max).toBe(3);
  });

  test("keeps the same window on any surface, as R does without asp", () => {
    // R measured on a null device: par("usr") is the same four numbers on a
    // 10 by 5 inch device and on a 5 by 5 inch one. Nothing widens.
    for (const [width, height] of [
      [900, 300],
      [300, 900],
      [520, 440],
      [200, 200],
    ] as const) {
      const scale = matrixInverseScale(width, height);

      expect(scale.world.x).toEqual(WORLD);
      expect(scale.world.y).toEqual(WORLD);
    }
  });

  test("lets the parallelograms shear on a surface that is not square", () => {
    // The opposite of the PCA plot, whose R call passes asp = 1. Here a unit
    // across and a unit up are different numbers of pixels, and the picture
    // stretches with the window. Pinned so that nobody adds an aspect rule.
    const scale = matrixInverseScale(900, 300);
    const perPixelX = Math.abs(scale.toPixelX(1) - scale.toPixelX(0));
    const perPixelY = Math.abs(scale.toPixelY(1) - scale.toPixelY(0));

    // One world unit is a sixth of the plot area on each axis, because the
    // window is six units wide and six units tall.
    expect(perPixelX).toBeCloseTo(scale.area.width / 6, 9);
    expect(perPixelY).toBeCloseTo(scale.area.height / 6, 9);
    expect(perPixelX).toBeGreaterThan(perPixelY * 1.5);
  });

  test("reserves the shared margins for the axes", () => {
    const scale = matrixInverseScale(WIDTH, HEIGHT);

    expect(scale.area.left).toBe(DEFAULT_MARGINS.left);
    expect(scale.area.top).toBe(DEFAULT_MARGINS.top);
    expect(scale.area.width).toBe(
      WIDTH - DEFAULT_MARGINS.left - DEFAULT_MARGINS.right,
    );
    // The window fills that area: 3 lands on its right edge, 0 in its middle.
    expect(scale.toPixelX(3)).toBeCloseTo(scale.area.right, 9);
    expect(scale.toPixelX(0)).toBeCloseTo(
      (scale.area.left + scale.area.right) / 2,
      9,
    );
  });
});

describe("plotMatrixInverse, with an invertible matrix", () => {
  test("returns what the core reports about the matrix", () => {
    const { ctx, target } = makeTarget();

    const result = plotMatrixInverse(target, DEFAULT_MATRIX);

    expect(ctx.calls.length).toBeGreaterThan(0);
    expect(result).toEqual(invertMatrix(DEFAULT_MATRIX));
    expect(result.singularity).toBeNull();
    expect(result.determinant).toBe(-2.9999999999999996);
  });

  test("paints the background before anything else", () => {
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, DEFAULT_MATRIX);

    const first = ctx.callsTo("fillRect")[0];
    expect(first).toBeDefined();
    expect(first?.args).toEqual([0, 0, WIDTH, HEIGHT]);
  });

  test("draws both axes and no box, as frame.plot = FALSE asks", () => {
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, DEFAULT_MATRIX);
    const scale = expectedScale();

    // The only rectangle is the clip: an axis box would be a second one.
    expect(ctx.callsTo("rect")).toHaveLength(1);
    // Both axes carry their tick labels.
    expect(ctx.texts()).toContain("-3");
    expect(ctx.texts()).toContain("3");
    expect(ctx.texts().filter((text) => text === "0")).toHaveLength(2);
    // The vertical axis line and the horizontal one both reach the context.
    const axisCalls = ctx.calls.slice(0, ctx.calls.findIndex((c) => c.method === "clip"));
    const visited = axisCalls
      .filter((call) => call.method === "moveTo" || call.method === "lineTo")
      .map((call) => [call.args[0] as number, call.args[1] as number]);
    expect(visited).toContainEqual([scale.area.left, scale.area.top]);
    expect(visited).toContainEqual([scale.area.right, scale.area.bottom]);
  });

  test("gives the axes no titles, since R's own are an artifact", () => {
    // R's plot(NA, ...) labels the axes "Index" and "NA", which is what
    // xy.coords does with a single NA and says nothing about the picture.
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, DEFAULT_MATRIX);

    expect(ctx.texts().length).toBeGreaterThan(0);
    for (const label of ["Index", "NA", "x", "y"]) {
      expect(ctx.texts()).not.toContain(label);
    }
    for (const text of ctx.texts()) {
      expect(Number.isNaN(Number(text))).toBe(false);
    }
  });

  test("clips to the plot area", () => {
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, DEFAULT_MATRIX);
    const { area } = expectedScale();

    const clips = ctx.callsTo("clip");
    expect(clips).toHaveLength(1);
    const rect = ctx.callsTo("rect")[0];
    expect(rect?.args).toEqual([area.left, area.top, area.width, area.height]);
  });

  test("draws the two parallelograms in R's colours, A first", () => {
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, DEFAULT_MATRIX);
    const drawn = polygons(ctx);

    expect(drawn).toHaveLength(2);
    expect(drawn[0]?.style.fillStyle).toBe(A_FILL);
    expect(drawn[1]?.style.fillStyle).toBe(INVERSE_FILL);
    expect(drawn[0]?.style.strokeStyle).toBe(BORDER);
    expect(drawn[1]?.style.strokeStyle).toBe(BORDER);
    expect(drawn.every((polygon) => polygon.stroked)).toBe(true);
  });

  test("draws each parallelogram through R's four corners", () => {
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, DEFAULT_MATRIX);
    const scale = expectedScale();
    const inverse = invertMatrix(DEFAULT_MATRIX).inverse as Matrix2;
    const drawn = polygons(ctx);

    const corners = (matrix: Matrix2) => [
      pixel(scale, 0, 0),
      pixel(scale, matrix.x1, matrix.y1),
      pixel(scale, matrix.x1 + matrix.x2, matrix.y1 + matrix.y2),
      pixel(scale, matrix.x2, matrix.y2),
    ];

    // R's polygon() closes the shape itself, so the port's extra return to the
    // origin is the same outline.
    expect(drawn[0]?.points.slice(0, 4)).toEqual(corners(DEFAULT_MATRIX));
    expect(drawn[1]?.points.slice(0, 4)).toEqual(corners(inverse));
  });

  test("draws one arrow along each of the four column vectors", () => {
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, DEFAULT_MATRIX);
    const scale = expectedScale();
    const inverse = invertMatrix(DEFAULT_MATRIX).inverse as Matrix2;
    const drawn = arrows(ctx);

    expect(drawn).toHaveLength(4);
    const origin = pixel(scale, 0, 0);
    const tips = [
      pixel(scale, DEFAULT_MATRIX.x1, DEFAULT_MATRIX.y1),
      pixel(scale, DEFAULT_MATRIX.x2, DEFAULT_MATRIX.y2),
      pixel(scale, inverse.x1, inverse.y1),
      pixel(scale, inverse.x2, inverse.y2),
    ];

    drawn.forEach((arrow, index) => {
      // The shaft runs from the origin to the tip of the column vector.
      expect(arrow.points[0]).toEqual(origin);
      expect(arrow.points[1]).toEqual(tips[index] as readonly [number, number]);
    });
  });

  test("puts one arrowhead at the far end, at R's length and angle", () => {
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, DEFAULT_MATRIX);
    const arrow = arrows(ctx)[0];

    // Shaft, then back to one head edge, the tip again, and the other edge.
    expect(arrow?.points).toHaveLength(5);
    const tip = arrow?.points[1] as readonly [number, number];
    const firstEdge = arrow?.points[2] as readonly [number, number];
    const secondEdge = arrow?.points[4] as readonly [number, number];
    // Nothing sits at the origin end: code = 2 draws one head only.
    expect(arrow?.points[3]).toEqual(tip);
    expect(distance(tip, firstEdge)).toBeCloseTo(HEAD_LENGTH, 9);
    expect(distance(tip, secondEdge)).toBeCloseTo(HEAD_LENGTH, 9);

    const angleOf = (edge: readonly [number, number]) =>
      Math.atan2(edge[1] - tip[1], edge[0] - tip[0]);
    const between = Math.abs(angleOf(firstEdge) - angleOf(secondEdge));
    expect(between).toBeCloseTo(Math.PI / 3, 9);
  });

  test("draws the arrows solid black at the default width", () => {
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, DEFAULT_MATRIX);

    expect(arrows(ctx)).toHaveLength(4);
    for (const arrow of arrows(ctx)) {
      expect(arrow.style.strokeStyle).toBe(ARROW_COLOR);
      expect(arrow.style.lineWidth).toBe(1);
      expect(arrow.style.lineDash).toEqual([]);
    }
  });

  test("draws all of A before any of the inverse", () => {
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, DEFAULT_MATRIX);
    const drawn = paths(ctx);

    // Polygon, two arrows, polygon, two arrows.
    expect(drawn).toHaveLength(6);
    expect(drawn.map((path) => path.filled)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(drawn[0]?.style.fillStyle).toBe(A_FILL);
    expect(drawn[3]?.style.fillStyle).toBe(INVERSE_FILL);
  });

  test("keeps the arrowhead the same size whatever the arrow", () => {
    // R's length is measured in inches, not in the data, so a short vector
    // gets a head as large as a long one.
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, { x1: 0.4, y1: 0, x2: 0, y2: 2.5 });

    expect(arrows(ctx)).toHaveLength(4);
    for (const arrow of arrows(ctx)) {
      const tip = arrow.points[1] as readonly [number, number];
      expect(distance(tip, arrow.points[2] as readonly [number, number]))
        .toBeCloseTo(HEAD_LENGTH, 9);
    }
  });
});

describe("plotMatrixInverse, with a singular matrix", () => {
  test("draws nothing at all for an exactly singular matrix", () => {
    // R's solve() stops the function before plot() runs. Confirmed by trace:
    // the singular case produces no graphics calls whatever.
    const { ctx, target } = makeTarget();
    const drawable = makeTarget();
    plotMatrixInverse(drawable.target, DEFAULT_MATRIX);

    plotMatrixInverse(target, EXACTLY_SINGULAR);

    expect(drawable.ctx.calls.length).toBeGreaterThan(0);
    expect(ctx.calls).toHaveLength(0);
  });

  test("draws nothing at all for a computationally singular matrix", () => {
    const { ctx, target } = makeTarget();
    const drawable = makeTarget();
    plotMatrixInverse(drawable.target, DEFAULT_MATRIX);

    plotMatrixInverse(target, COMPUTATIONALLY_SINGULAR);

    expect(drawable.ctx.calls.length).toBeGreaterThan(0);
    expect(ctx.calls).toHaveLength(0);
  });

  test("still reports why nothing was drawn", () => {
    const { ctx, target } = makeTarget();

    expect(plotMatrixInverse(target, DEFAULT_MATRIX).inverse).not.toBeNull();
    expect(ctx.calls.length).toBeGreaterThan(0);
    const exact = plotMatrixInverse(target, EXACTLY_SINGULAR);
    const computational = plotMatrixInverse(target, COMPUTATIONALLY_SINGULAR);

    expect(exact.singularity).toBe("exact");
    expect(exact.zeroPivot).toBe(2);
    expect(exact.inverse).toBeNull();
    expect(computational.singularity).toBe("computational");
    expect(computational.rcond).toBeLessThan(Number.EPSILON);
  });

  test("leaves whatever was on the canvas, background included", () => {
    // The port draws nothing rather than clearing, because R draws nothing.
    // A caller that redraws on every slider step has to clear the surface
    // itself; `interactive_matrix_inverse` gets that from shiny.
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, DEFAULT_MATRIX);
    const drawnWhenInvertible = ctx.calls.length;
    expect(drawnWhenInvertible).toBeGreaterThan(0);
    plotMatrixInverse(target, EXACTLY_SINGULAR);

    expect(ctx.calls).toHaveLength(drawnWhenInvertible);
  });
});

describe("plotMatrixInverse, at the edges of the window", () => {
  test("draws an inverse far outside the window without clamping it", () => {
    // F4c inverts to entries near 200 in a window of 3. R lets its device
    // clip them; the port clips too, and must not pull them back in.
    const { ctx, target } = makeTarget();

    const result = plotMatrixInverse(target, STRETCHED);
    const scale = expectedScale();
    const inverse = result.inverse as Matrix2;

    expect(arrows(ctx)).toHaveLength(4);
    const tips = arrows(ctx).map((arrow) => arrow.points[1] as readonly [number, number]);
    expect(tips[2]).toEqual(pixel(scale, inverse.x1, inverse.y1));
    // Far to the left of the plot area, not clamped to its edge.
    expect((tips[2] as readonly [number, number])[0]).toBeLessThan(
      scale.area.left - 1000,
    );
  });

  test("skips an arrow too short to have a direction", () => {
    // One column near zero with the other large still inverts. R omits the
    // arrowhead below 1/1000 inch and draws a shaft of no length; the port
    // skips the arrow, which leaves the same picture. The parallelogram is
    // still drawn, as R draws it.
    const { ctx, target } = makeTarget();

    const result = plotMatrixInverse(target, { x1: 1e-6, y1: 0, x2: 0, y2: 2 });

    expect(result.singularity).toBeNull();
    expect(arrows(ctx)).toHaveLength(3);
    expect(polygons(ctx)).toHaveLength(2);
  });

  test("draws every arrow when none is degenerate", () => {
    const { ctx, target } = makeTarget();

    plotMatrixInverse(target, DEFAULT_MATRIX);

    expect(arrows(ctx)).toHaveLength(4);
  });
});
