/**
 * Tests for the PCA plot, ported from `plot_pca()` in
 * `../compstatslib/R/pca_plot.R`.
 *
 * These are structural checks: the test counts the shapes that reach the
 * context, reads their styles, and recovers the coordinates they were drawn
 * at. It does not compare pixels with base R. The numbers behind the arrows
 * are R-verified in `src/core/pca.test.ts`; nothing here re-derives them.
 *
 * The R code being ported:
 *
 * ```r
 * plot(points[c("x", "y")], xlim = xlim, ylim = ylim,
 *      pch = 19, cex = 2, col = "gray", asp = 1)
 * if (nrow(points) >= 3) {
 *   pca   <- prcomp(mc_points, scale. = FALSE)
 *   egvec <- pca$rotation[, c("PC1", "PC2")]
 *   vec   <- egvec %*% diag(pca$sdev[1:2])
 *   arrows(-vec["x", ] + mc_diff["x"], -vec["y", ] + mc_diff["y"],
 *           vec["x", ] + mc_diff["x"],  vec["y", ] + mc_diff["y"],
 *          lty = c("solid", "dotted"), length = 0.1)
 * }
 * ```
 *
 * Three details of that call decide what the tests below expect, and each was
 * read out of R rather than assumed:
 *
 * 1. **One arrowhead, at the `+vec` end.** `arrows()` takes `code = 2` by
 *    default, and `?arrows` says "if `code = 2` an arrowhead is drawn at
 *    `(x1[i], y1[i])`". `plot_pca` passes no `code`, so each component gets a
 *    single head, at the end the loading vector points to — not a head at
 *    both ends.
 * 2. **Zero-length arrows lose their head.** `?arrows`: "The direction of a
 *    zero-length arrow is indeterminate ... arrowheads are omitted (with a
 *    warning) on any arrow of length less than 1/1000 inch." Running it
 *    confirms the warning: `arrows(5, 5, 5, 5)` prints "zero-length arrow is
 *    of indeterminate angle and so skipped". The shaft R still draws covers no
 *    distance, so the port skips the whole arrow and the picture is the same.
 * 3. **The points drawn are the raw points**, never the centered ones —
 *    `plot(points[...])`, not `plot(mc_points)`. Mean-centering moves the
 *    arrows' anchor and nothing else.
 *
 * The window is `asp = 1`: equal world units per pixel on both axes. Measured
 * from R on a null device, `xlim = ylim = c(-50, 50)`:
 *
 * ```text
 * 10 x 5 inch device: par("usr") = -149.696 149.696 -54 54
 * 5 x 10 inch device: par("usr") =  -54 54 -117.191 117.191
 * ```
 *
 * So R keeps the requested limits on whichever axis constrains the fit and
 * widens the other one about its middle. (R's `±54` is its 4% `xaxs = "r"`
 * padding of `±50`. This port drops that padding, as slices 1 to 4 all do, so
 * the constraining axis keeps the literal limits it was given.)
 */

import { describe, expect, test } from "bun:test";

import { principalComponents } from "../core/pca";
import type { PcaResult } from "../core/pca";
import type { Point } from "../core/regression";
import { RecordingContext } from "../../test/recording-context";
import type { DrawCall, DrawStyle } from "../../test/recording-context";
import { createScale } from "./axes";
import type { Scale } from "./axes";
import { pcaScale, plotPca } from "./pca";
import type { RenderTarget } from "./target";

/** A surface whose plot area is exactly square, so `asp = 1` widens neither
 * axis and the expected pixels are the plain ones. Default margins are 52 and
 * 20 across, 20 and 44 down. */
const WIDTH = 472;
const HEIGHT = 464;

/** R's default `xlim` and `ylim`. */
const WORLD = { min: -50, max: 50 };

/** R: `lty = "dotted"`, mapped as `plot/regression.ts` maps it. */
const DOTTED = [1, 3];

/** The general 8-point set of the PCA fixtures, F2. */
const fixture: Point[] = [
  { x: -30, y: -25 },
  { x: -18, y: -11 },
  { x: -7, y: -9 },
  { x: 2, y: 3 },
  { x: 9, y: 2 },
  { x: 17, y: 15 },
  { x: 26, y: 18 },
  { x: 38, y: 30 },
];

function makeTarget(
  width = WIDTH,
  height = HEIGHT,
): { ctx: RecordingContext; target: RenderTarget } {
  const ctx = new RecordingContext();
  return { ctx, target: { ctx, width, height } };
}

/** The scale `plotPca` draws through on a square plot area. */
function expectedScale(): Scale {
  return createScale({ width: WIDTH, height: HEIGHT, x: WORLD, y: WORLD });
}

/** The calls made after the plot area was clipped: the data, not the frame. */
function afterClip(ctx: RecordingContext): DrawCall[] {
  const index = ctx.calls.findIndex((call) => call.method === "clip");
  return index === -1 ? [] : ctx.calls.slice(index + 1);
}

/** One stroked path, as the coordinates it visited. */
interface StrokedPath {
  readonly style: DrawStyle;
  readonly points: readonly (readonly [number, number])[];
}

/** Recover every stroked path drawn inside the clip. */
function strokedPaths(ctx: RecordingContext): StrokedPath[] {
  const paths: StrokedPath[] = [];
  let points: (readonly [number, number])[] = [];

  for (const call of afterClip(ctx)) {
    if (call.method === "beginPath") {
      points = [];
    } else if (call.method === "moveTo" || call.method === "lineTo") {
      points.push([call.args[0] as number, call.args[1] as number]);
    } else if (call.method === "stroke") {
      paths.push({ style: call.style, points });
      points = [];
    }
  }
  return paths;
}

/** Where each point was drawn, as the centre of its filled circle. */
function drawnPointCentres(
  ctx: RecordingContext,
): (readonly [number, number])[] {
  return ctx
    .callsTo("arc")
    .map((call) => [call.args[0] as number, call.args[1] as number] as const);
}

function distance(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

describe("pcaScale", () => {
  test("keeps both requested ranges when the plot area is square", () => {
    const scale = pcaScale(WIDTH, HEIGHT);

    expect(scale.world.x).toEqual(WORLD);
    expect(scale.world.y).toEqual(WORLD);
  });

  test("drops R's 4% padding, keeping the literal limits", () => {
    // R would report -54..54 here. Every plot in this port uses the window it
    // was given, and this one follows.
    const scale = pcaScale(WIDTH, HEIGHT);

    expect(scale.world.x.min).toBe(-50);
    expect(scale.world.x.max).toBe(50);
  });

  test("widens only the x range on a wide surface", () => {
    const scale = pcaScale(900, HEIGHT);

    expect(scale.world.y).toEqual(WORLD);
    expect(scale.world.x.max - scale.world.x.min).toBeGreaterThan(100);
    // Widened about the middle of the requested range.
    expect(scale.world.x.min + scale.world.x.max).toBeCloseTo(0, 9);
  });

  test("widens only the y range on a tall surface", () => {
    const scale = pcaScale(WIDTH, 900);

    expect(scale.world.x).toEqual(WORLD);
    expect(scale.world.y.max - scale.world.y.min).toBeGreaterThan(100);
    expect(scale.world.y.min + scale.world.y.max).toBeCloseTo(0, 9);
  });

  test("gives equal world units per pixel on both axes", () => {
    for (const [width, height] of [
      [900, 464],
      [472, 900],
      [472, 464],
      [800, 300],
    ] as const) {
      const scale = pcaScale(width, height);
      const perPixelX = Math.abs(scale.toPixelX(10) - scale.toPixelX(0)) / 10;
      const perPixelY = Math.abs(scale.toPixelY(10) - scale.toPixelY(0)) / 10;

      expect(perPixelX).toBeGreaterThan(0);
      expect(perPixelX).toBeCloseTo(perPixelY, 9);
    }
  });

  test("widens a caller's own limits about their middle", () => {
    const scale = pcaScale(900, HEIGHT, {
      xlim: [0, 10],
      ylim: [4, 14],
    });

    expect(scale.world.y).toEqual({ min: 4, max: 14 });
    expect(scale.world.x.min + scale.world.x.max).toBeCloseTo(10, 9);
    expect(scale.world.x.max - scale.world.x.min).toBeGreaterThan(10);
  });

  test("never narrows a requested range", () => {
    const scale = pcaScale(900, HEIGHT, { xlim: [-2, 2], ylim: [-50, 50] });

    expect(scale.world.y.min).toBeLessThanOrEqual(-50);
    expect(scale.world.y.max).toBeGreaterThanOrEqual(50);
    expect(scale.world.x.min).toBeLessThanOrEqual(-2);
    expect(scale.world.x.max).toBeGreaterThanOrEqual(2);
  });
});

describe("plotPca", () => {
  describe("no points", () => {
    test("draws framed axes labelled x and y", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, []);

      expect(ctx.callsTo("rect")).toHaveLength(1);
      expect(ctx.texts()).toContain("x");
      expect(ctx.texts()).toContain("y");
    });

    test("draws no points and no arrows", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, []);

      // The axes still reach the context, so this is a picture with nothing
      // in it rather than a function that drew nothing at all.
      expect(ctx.callsTo("stroke").length).toBeGreaterThan(0);
      expect(ctx.callsTo("arc")).toHaveLength(0);
      expect(strokedPaths(ctx)).toHaveLength(0);
    });

    test("reports no components", () => {
      const { target } = makeTarget();

      expect(plotPca(target, [])).toBeNull();
    });
  });

  describe("below three points", () => {
    test("draws one point and no arrows", () => {
      const { ctx, target } = makeTarget();

      const result = plotPca(target, [{ x: 10, y: 20 }]);

      expect(drawnPointCentres(ctx)).toHaveLength(1);
      expect(strokedPaths(ctx)).toHaveLength(0);
      expect(result).toBeNull();
    });

    test("draws two points and no arrows", () => {
      const { ctx, target } = makeTarget();

      const result = plotPca(target, [
        { x: -10, y: -20 },
        { x: 10, y: 20 },
      ]);

      expect(drawnPointCentres(ctx)).toHaveLength(2);
      expect(strokedPaths(ctx)).toHaveLength(0);
      // The core would answer for two points. R's plot guards before asking,
      // and so does this.
      expect(result).toBeNull();
    });
  });

  describe("points", () => {
    test("draws one filled circle per point", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture);

      expect(drawnPointCentres(ctx)).toHaveLength(fixture.length);
      expect(ctx.callsTo("fill").length).toBeGreaterThanOrEqual(
        fixture.length,
      );
    });

    test("draws them in R's gray at R's cex = 2 size", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture);

      const arcs = ctx.callsTo("arc");
      expect(arcs[0]?.style.fillStyle).toBe("#bebebe");
      expect(arcs[0]?.args[2]).toBe(6);
    });

    test("draws them where they are, never mean-centered", () => {
      // Every point sits far from the origin. R plots `points`, not
      // `mc_points`, so centering must not move a single dot.
      const offset: Point[] = fixture.map((point) => ({
        x: point.x / 2 + 20,
        y: point.y / 2 + 20,
      }));
      const scale = expectedScale();

      const { ctx, target } = makeTarget();
      plotPca(target, offset);
      const centered = makeTarget();
      plotPca(centered.target, offset, { meancenter: false });

      const expected = offset.map(
        (point) =>
          [scale.toPixelX(point.x), scale.toPixelY(point.y)] as const,
      );
      expect(drawnPointCentres(ctx)).toEqual(expected);
      expect(drawnPointCentres(centered.ctx)).toEqual(expected);
    });
  });

  describe("arrows", () => {
    const result = principalComponents(fixture);
    const scale = expectedScale();

    test("draws one arrow per component", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture);

      expect(strokedPaths(ctx)).toHaveLength(2);
    });

    test("returns the components it drew", () => {
      const { target } = makeTarget();

      expect(plotPca(target, fixture)).toEqual(result);
    });

    test("runs each shaft from -vec to +vec about the centre", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture);

      const paths = strokedPaths(ctx);
      [0, 1].forEach((index) => {
        const loadings = (result?.rotation[index] ?? [0, 0]) as readonly [
          number,
          number,
        ];
        const sdev = result?.sdev[index] ?? 0;
        const anchor = result?.center ?? { x: 0, y: 0 };
        const tail = [
          scale.toPixelX(anchor.x - loadings[0] * sdev),
          scale.toPixelY(anchor.y - loadings[1] * sdev),
        ] as const;
        const tip = [
          scale.toPixelX(anchor.x + loadings[0] * sdev),
          scale.toPixelY(anchor.y + loadings[1] * sdev),
        ] as const;

        const drawn = paths[index]?.points ?? [];
        expect(distance(drawn[0] as readonly [number, number], tail)).toBeLessThan(1e-9);
        expect(distance(drawn[1] as readonly [number, number], tip)).toBeLessThan(1e-9);
      });
    });

    test("puts a single arrowhead at the +vec end, as R's code = 2 does", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture);

      const path = strokedPaths(ctx)[0] as StrokedPath;
      const tail = path.points[0] as readonly [number, number];
      const tip = path.points[1] as readonly [number, number];
      const head = path.points.slice(2);

      // Two edges meeting at the tip: three vertices, all at the tip end.
      expect(head).toHaveLength(3);
      head.forEach((vertex) => {
        expect(distance(vertex, tip)).toBeLessThanOrEqual(10.000001);
        expect(distance(vertex, tail)).toBeGreaterThan(10);
      });
    });

    test("cuts the head edges at R's 30 degrees, 0.1 inch long", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture);

      const path = strokedPaths(ctx)[0] as StrokedPath;
      const tail = path.points[0] as readonly [number, number];
      const tip = path.points[1] as readonly [number, number];
      const back = Math.atan2(tail[1] - tip[1], tail[0] - tip[0]);

      for (const vertex of [path.points[2], path.points[4]] as const) {
        const edge = vertex as readonly [number, number];
        expect(distance(edge, tip)).toBeCloseTo(10, 9);
        const angle = Math.atan2(edge[1] - tip[1], edge[0] - tip[0]) - back;
        const turned = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
        expect(turned).toBeCloseTo(Math.PI / 6, 9);
      }
      // The two edges are on opposite sides of the shaft.
      expect(path.points[3]).toEqual(tip);
    });

    test("draws PC1 solid and PC2 dotted, both black", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture);

      const paths = strokedPaths(ctx);
      expect(paths[0]?.style.lineDash).toEqual([]);
      expect(paths[1]?.style.lineDash).toEqual(DOTTED);
      expect(paths[0]?.style.strokeStyle).toBe("#000000");
      expect(paths[1]?.style.strokeStyle).toBe("#000000");
    });

    test("anchors on the data centre while meancenter is on", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture);

      const path = strokedPaths(ctx)[0] as StrokedPath;
      const middle = [
        ((path.points[0] as readonly [number, number])[0] +
          (path.points[1] as readonly [number, number])[0]) /
          2,
        ((path.points[0] as readonly [number, number])[1] +
          (path.points[1] as readonly [number, number])[1]) /
          2,
      ] as const;

      expect(
        distance(middle, [
          scale.toPixelX(result?.center.x ?? 0),
          scale.toPixelY(result?.center.y ?? 0),
        ]),
      ).toBeLessThan(1e-9);
    });

    test("anchors on the origin while meancenter is off", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture, { meancenter: false });

      const path = strokedPaths(ctx)[0] as StrokedPath;
      const middle = [
        ((path.points[0] as readonly [number, number])[0] +
          (path.points[1] as readonly [number, number])[0]) /
          2,
        ((path.points[0] as readonly [number, number])[1] +
          (path.points[1] as readonly [number, number])[1]) /
          2,
      ] as const;

      expect(
        distance(middle, [scale.toPixelX(0), scale.toPixelY(0)]),
      ).toBeLessThan(1e-9);
    });

    test("reports the same components either way", () => {
      // meancenter moves the anchor and nothing else. R fixture F7 pins this.
      const first = makeTarget();
      const second = makeTarget();

      const uncentered = plotPca(first.target, fixture, { meancenter: false });
      const centered = plotPca(second.target, fixture);

      expect(uncentered).not.toBeNull();
      expect(uncentered).toEqual(centered as PcaResult);
    });
  });

  describe("degenerate spreads", () => {
    test("skips both arrows for identical points", () => {
      const { ctx, target } = makeTarget();
      const points: Point[] = [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ];

      const result = plotPca(target, points);

      expect(strokedPaths(ctx)).toHaveLength(0);
      expect(result?.sdev).toEqual([0, 0]);
      expect(drawnPointCentres(ctx)).toHaveLength(3);
    });

    test("skips the second arrow for collinear points", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 20, y: 10 },
      ]);

      expect(strokedPaths(ctx)).toHaveLength(1);
      expect(strokedPaths(ctx)[0]?.style.lineDash).toEqual([]);
    });

    test("skips the second arrow for a constant coordinate", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, [
        { x: 3, y: -8 },
        { x: 3, y: -1 },
        { x: 3, y: 4 },
        { x: 3, y: 12 },
      ]);

      expect(strokedPaths(ctx)).toHaveLength(1);
    });

    test("draws no coordinate that is not a number", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ]);

      const drawn = ctx.calls.flatMap((call) =>
        call.args.filter((arg): arg is number => typeof arg === "number"),
      );
      expect(drawnPointCentres(ctx)).toHaveLength(3);
      expect(drawn.length).toBeGreaterThan(10);
      expect(drawn.every((value) => Number.isFinite(value))).toBe(true);
    });
  });

  describe("the plot area", () => {
    test("clips the data to it", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture);

      const clips = ctx.callsTo("clip");
      expect(clips).toHaveLength(1);
      const rects = ctx.callsTo("rect");
      const { area } = expectedScale();
      expect(rects[rects.length - 1]?.args).toEqual([
        area.left,
        area.top,
        area.width,
        area.height,
      ]);
    });

    test("paints the background before anything else", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture);

      const first = ctx.callsTo("fillRect")[0];
      expect(first?.args).toEqual([0, 0, WIDTH, HEIGHT]);
      expect(first?.style.fillStyle).toBe("#ffffff");
    });

    test("keeps arrows inside a window the caller narrows", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture, { xlim: [-5, 5], ylim: [-5, 5] });

      expect(ctx.callsTo("clip")).toHaveLength(1);
      expect(strokedPaths(ctx)).toHaveLength(2);
    });
  });

  describe("what this plot does not draw", () => {
    test("writes no text but the axis ticks and titles", () => {
      const { ctx, target } = makeTarget();

      plotPca(target, fixture);

      const ticks = new Set([
        "x",
        "y",
        ...[-40, -20, 0, 20, 40].map(String),
        ...[-50, -25, 25, 50].map(String),
      ]);
      expect(ctx.texts()).toContain("x");
      expect(ctx.texts()).toContain("y");
      ctx.texts().forEach((text) => expect(ticks.has(text)).toBe(true));
    });

    test("draws no regression line or crosshair", () => {
      // Only the two arrows are stroked inside the plot area.
      const { ctx, target } = makeTarget();

      plotPca(target, fixture);

      expect(strokedPaths(ctx)).toHaveLength(2);
    });
  });
});
