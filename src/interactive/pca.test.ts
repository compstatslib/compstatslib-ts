/**
 * Tests for the interactive PCA, ported from `interactive_pca()` in
 * `../compstatslib/R/pca_interactive.R`.
 *
 * These tests exercise state and input handling only. The drawing belongs to
 * `plotPca`, which `src/plot/pca.test.ts` covers, and the numbers belong to
 * `principalComponents`, which `src/core/pca.test.ts` covers against R.
 *
 * The test dispatches real `MouseEvent`s at a real happy-dom canvas, so the
 * listener wiring and the pixel arithmetic run as they do in a browser.
 * happy-dom gives that canvas no 2D context, so the drawing goes to a separate
 * recording surface. See `makeHarness`.
 *
 * The R being ported, in full — it is short, and every line of it decides a
 * test below:
 *
 * ```r
 * interactive_pca <- function(meancenter = TRUE) {
 *   pts        <- shiny::reactiveVal(data.frame())
 *   pca_result <- shiny::reactiveVal(NULL)
 *
 *   shiny::observeEvent(input$plot_click, {
 *     click  <- input$plot_click
 *     new_pt <- data.frame(x = click$x, y = click$y)
 *     ...  # appended, with no clamp and no rounding
 *   })
 *
 *   output$pca_plot <- shiny::renderPlot({
 *     result <- plot_pca(pts(), meancenter = meancenter)
 *     pca_result(result)
 *   })
 *
 *   shiny::observeEvent(input$done, {
 *     shiny::stopApp(list(points = pts(), pca = pca_result()))
 *   })
 * }
 * ```
 *
 * Three things to read out of it:
 *
 * 1. **A click is taken as it comes.** `data.frame(x = click$x, y = click$y)`
 *    — no `max`/`min` as in `interactive_logit`, no `round`, and no test that
 *    the click landed inside the plot area as `interactive_regression` makes.
 *    Shiny reports a coordinate for a click anywhere on the plot image,
 *    margins included, so a point outside the window is a state R can reach.
 * 2. **Done hands back two things**, the points and the last `plot_pca`
 *    return. Every other component in this port returns one or none.
 * 3. **`pca_result` is whatever the last draw returned**, so it is NULL below
 *    three points with no separate rule to write.
 */

import { describe, expect, test } from "bun:test";

import { principalComponents } from "../core/pca.js";
import type { PcaResult } from "../core/pca.js";
import type { Point } from "../core/regression.js";
import { RecordingContext } from "../../test/recording-context.js";
import type { DrawCall } from "../../test/recording-context.js";
import { pcaScale } from "../plot/pca.js";
import { interactivePca } from "./pca.js";

/** A square plot area, so the `asp = 1` window is R's plain -50 to 50. */
const WIDTH = 472;
const HEIGHT = 464;

/** The same scale that `plotPca` draws through. */
const scale = pcaScale(WIDTH, HEIGHT);

interface Harness {
  readonly ctx: RecordingContext;
  readonly canvas: HTMLCanvasElement;
  readonly target: {
    readonly surface: { ctx: RecordingContext; width: number; height: number };
    readonly element: HTMLCanvasElement;
  };
}

function makeHarness(width = WIDTH, height = HEIGHT): Harness {
  const ctx = new RecordingContext();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  document.body.appendChild(canvas);
  return {
    ctx,
    canvas,
    target: { surface: { ctx, width, height }, element: canvas },
  };
}

/**
 * Click the element at a pixel of the canvas.
 *
 * happy-dom reports a zero-sized bounding rectangle, so a client coordinate
 * equals a canvas pixel here.
 */
function clickAt(canvas: HTMLCanvasElement, px: number, py: number): void {
  canvas.dispatchEvent(
    new MouseEvent("click", { clientX: px, clientY: py, bubbles: true }),
  );
}

/** Click the element at a world coordinate. */
function clickWorld(canvas: HTMLCanvasElement, x: number, y: number): void {
  clickAt(canvas, scale.toPixelX(x), scale.toPixelY(y));
}

/** Split the recorded calls into one group per draw. */
function draws(ctx: RecordingContext): DrawCall[][] {
  const frames: DrawCall[][] = [];
  for (const call of ctx.calls) {
    if (call.method === "fillRect") {
      frames.push([]);
    }
    frames.at(-1)?.push(call);
  }
  return frames;
}

/** Return the calls of the most recent draw. */
function lastDraw(ctx: RecordingContext): DrawCall[] {
  return draws(ctx).at(-1) ?? [];
}

/** Count the dots of the most recent draw. */
function dotCount(ctx: RecordingContext): number {
  return lastDraw(ctx).filter((call) => call.method === "arc").length;
}

/** Count the arrows of the most recent draw: the strokes inside the clip. */
function arrowCount(ctx: RecordingContext): number {
  const frame = lastDraw(ctx);
  const clip = frame.findIndex((call) => call.method === "clip");
  return clip === -1
    ? 0
    : frame.slice(clip).filter((call) => call.method === "stroke").length;
}

/** Where the dots of the most recent draw were drawn. */
function dotCenters(ctx: RecordingContext): (readonly [number, number])[] {
  return lastDraw(ctx)
    .filter((call) => call.method === "arc")
    .map((call) => [call.args[0] as number, call.args[1] as number] as const);
}

const threePoints: readonly Point[] = [
  { x: -20, y: -15 },
  { x: 5, y: 10 },
  { x: 25, y: 12 },
];

describe("interactivePca", () => {
  describe("on creation", () => {
    test("draws once", () => {
      const { ctx, target } = makeHarness();

      interactivePca(target);

      expect(draws(ctx)).toHaveLength(1);
      expect(dotCount(ctx)).toBe(0);
    });

    test("draws the points it was given", () => {
      const { ctx, target } = makeHarness();

      interactivePca(target, { initialPoints: threePoints });

      expect(dotCount(ctx)).toBe(3);
      expect(arrowCount(ctx)).toBe(2);
    });

    test("reports those points and their fit", () => {
      const { target } = makeHarness();

      const handle = interactivePca(target, { initialPoints: threePoints });

      expect(handle.getPoints()).toEqual([...threePoints]);
      expect(handle.getFit()).toEqual(
        principalComponents(threePoints) as PcaResult,
      );
    });

    test("reports no fit below three points", () => {
      const { target } = makeHarness();

      const handle = interactivePca(target, {
        initialPoints: threePoints.slice(0, 2),
      });

      expect(handle.getFit()).toBeNull();
    });
  });

  describe("clicking", () => {
    test("adds a point and redraws", () => {
      const { ctx, canvas, target } = makeHarness();
      const handle = interactivePca(target);

      clickWorld(canvas, 10, 20);

      expect(draws(ctx)).toHaveLength(2);
      expect(handle.getPoints()).toHaveLength(1);
      expect(dotCount(ctx)).toBe(1);
    });

    test("keeps the world coordinate whole, with no rounding", () => {
      // R appends `click$x` and `click$y` as they arrive. A component that
      // rounded to the outcome classes, as the logit one must, would lose
      // these digits.
      const { canvas, target } = makeHarness();
      const handle = interactivePca(target);

      clickWorld(canvas, 12.345678, -7.6543);

      const point = handle.getPoints()[0] as Point;
      expect(point.x).toBeCloseTo(12.345678, 9);
      expect(point.y).toBeCloseTo(-7.6543, 9);
      expect(Number.isInteger(point.x)).toBe(false);
    });

    test("collects points in click order", () => {
      const { canvas, target } = makeHarness();
      const handle = interactivePca(target);

      clickWorld(canvas, -30, -30);
      clickWorld(canvas, 0, 0);
      clickWorld(canvas, 30, 30);

      const xs = handle.getPoints().map((point) => point.x);
      expect(xs[0]).toBeCloseTo(-30, 9);
      expect(xs[1]).toBeCloseTo(0, 9);
      expect(xs[2]).toBeCloseTo(30, 9);
    });

    test("shows the components once three points are down", () => {
      const { ctx, canvas, target } = makeHarness();
      const handle = interactivePca(target);

      clickWorld(canvas, -20, -15);
      expect(arrowCount(ctx)).toBe(0);
      clickWorld(canvas, 5, 10);
      expect(arrowCount(ctx)).toBe(0);
      expect(handle.getFit()).toBeNull();

      clickWorld(canvas, 25, 12);

      expect(arrowCount(ctx)).toBe(2);
      expect(handle.getFit()).toEqual(
        principalComponents(handle.getPoints()) as PcaResult,
      );
    });

    test("returns a copy of the points", () => {
      const { canvas, target } = makeHarness();
      const handle = interactivePca(target);
      clickWorld(canvas, 1, 2);

      const taken = handle.getPoints() as Point[];
      taken.push({ x: 99, y: 99 });

      expect(handle.getPoints()).toHaveLength(1);
    });
  });

  describe("clicks outside the window", () => {
    test("takes a click in the margin, as R does", () => {
      // R applies no clamp and makes no inside-the-area test: shiny reports a
      // coordinate for a click anywhere on the plot image. This is the
      // deliberate difference from `interactiveRegression`, which ignores
      // such a click, and from `interactiveLogit`, which clamps it.
      const { canvas, target } = makeHarness();
      const handle = interactivePca(target);

      clickAt(canvas, 5, 5);

      const point = handle.getPoints()[0] as Point;
      expect(handle.getPoints()).toHaveLength(1);
      expect(point.x).toBeLessThan(-50);
      expect(point.y).toBeGreaterThan(50);
    });

    test("draws that point outside the plot area, for the clip to cut", () => {
      const { ctx, canvas, target } = makeHarness();
      interactivePca(target);

      clickAt(canvas, 5, 5);

      const center = dotCenters(ctx)[0] as readonly [number, number];
      expect(center[0]).toBeLessThan(scale.area.left);
      expect(center[1]).toBeLessThan(scale.area.top);
      expect(lastDraw(ctx).some((call) => call.method === "clip")).toBe(true);
    });
  });

  describe("the window", () => {
    test("maps a click through the widened window of a wide surface", () => {
      // `asp = 1` widens the x range on a wide surface, so the same pixel
      // means a different world value. A scale built once at some other size,
      // or built without the aspect rule, would put this point at -50.
      const wide = makeHarness(900, HEIGHT);
      const wideScale = pcaScale(900, HEIGHT);
      const handle = interactivePca(wide.target);

      clickAt(wide.canvas, wideScale.area.left, wideScale.area.bottom);

      const point = handle.getPoints()[0] as Point;
      expect(wideScale.world.x.min).toBeLessThan(-100);
      expect(point.x).toBeCloseTo(wideScale.world.x.min, 9);
      expect(point.y).toBeCloseTo(-50, 9);
    });

    test("maps a click through limits the caller set", () => {
      const { canvas, target } = makeHarness();
      const options = { xlim: [-5, 5], ylim: [-5, 5] } as const;
      const narrow = pcaScale(WIDTH, HEIGHT, options);
      const handle = interactivePca(target, options);

      clickAt(canvas, narrow.toPixelX(2.5), narrow.toPixelY(-1.25));

      const point = handle.getPoints()[0] as Point;
      expect(point.x).toBeCloseTo(2.5, 9);
      expect(point.y).toBeCloseTo(-1.25, 9);
    });
  });

  describe("forwarding to the plot", () => {
    test("passes meancenter through, moving the arrow anchor", () => {
      const centered = makeHarness();
      const atOrigin = makeHarness();

      interactivePca(centered.target, { initialPoints: threePoints });
      interactivePca(atOrigin.target, {
        initialPoints: threePoints,
        meancenter: false,
      });

      const shaftMiddle = (ctx: RecordingContext): number => {
        const frame = lastDraw(ctx);
        const clip = frame.findIndex((call) => call.method === "clip");
        const moves = frame
          .slice(clip)
          .filter(
            (call) => call.method === "moveTo" || call.method === "lineTo",
          );
        const from = moves[0]?.args[0] as number;
        const to = moves[1]?.args[0] as number;
        return (from + to) / 2;
      };

      expect(shaftMiddle(atOrigin.ctx)).toBeCloseTo(scale.toPixelX(0), 9);
      expect(shaftMiddle(centered.ctx)).not.toBeCloseTo(scale.toPixelX(0), 3);
    });

    test("passes the limits through, moving where a point is drawn", () => {
      const plain = makeHarness();
      const narrow = makeHarness();
      const points: readonly Point[] = [{ x: 2, y: 2 }];

      interactivePca(plain.target, { initialPoints: points });
      interactivePca(narrow.target, {
        initialPoints: points,
        xlim: [-5, 5],
        ylim: [-5, 5],
      });

      expect(dotCenters(narrow.ctx)[0]).not.toEqual(
        dotCenters(plain.ctx)[0] as readonly [number, number],
      );
    });
  });

  describe("reset", () => {
    test("drops every point, including the ones it started with", () => {
      const { ctx, canvas, target } = makeHarness();
      const handle = interactivePca(target, { initialPoints: threePoints });
      clickWorld(canvas, 40, 40);
      expect(dotCount(ctx)).toBe(4);

      handle.reset();

      expect(handle.getPoints()).toEqual([]);
      expect(dotCount(ctx)).toBe(0);
      expect(arrowCount(ctx)).toBe(0);
    });

    test("redraws and forgets the fit", () => {
      const { ctx, target } = makeHarness();
      const handle = interactivePca(target, { initialPoints: threePoints });

      handle.reset();

      expect(draws(ctx)).toHaveLength(2);
      expect(handle.getFit()).toBeNull();
    });

    test("goes on collecting afterwards", () => {
      const { canvas, target } = makeHarness();
      const handle = interactivePca(target, { initialPoints: threePoints });

      handle.reset();
      clickWorld(canvas, 10, 10);

      expect(handle.getPoints()).toHaveLength(1);
    });
  });

  describe("done", () => {
    test("hands over the points and the fit", () => {
      const { target } = makeHarness();
      const seen: { points: readonly Point[]; fit: PcaResult | null }[] = [];
      const handle = interactivePca(target, {
        initialPoints: threePoints,
        onDone: (payload) => seen.push(payload),
      });

      handle.done();

      expect(seen).toHaveLength(1);
      expect(seen[0]?.points).toEqual([...threePoints]);
      expect(seen[0]?.fit).toEqual(principalComponents(threePoints) as PcaResult);
    });

    test("hands over a null fit below three points", () => {
      const { canvas, target } = makeHarness();
      let fit: PcaResult | null | undefined;
      const handle = interactivePca(target, {
        onDone: (payload) => {
          fit = payload.fit;
        },
      });
      clickWorld(canvas, 1, 1);

      handle.done();

      expect(fit).toBeNull();
    });

    test("hands over a copy of the points", () => {
      const { target } = makeHarness();
      let taken: readonly Point[] = [];
      const handle = interactivePca(target, {
        initialPoints: threePoints,
        onDone: (payload) => {
          taken = payload.points;
        },
      });

      handle.done();
      (taken as Point[]).push({ x: 99, y: 99 });

      expect(handle.getPoints()).toHaveLength(3);
    });

    test("does nothing without a callback", () => {
      const { target } = makeHarness();
      const handle = interactivePca(target);

      expect(() => handle.done()).not.toThrow();
    });

    test("leaves the component running", () => {
      const { canvas, target } = makeHarness();
      const handle = interactivePca(target);

      handle.done();
      clickWorld(canvas, 5, 5);

      expect(handle.getPoints()).toHaveLength(1);
    });
  });

  describe("destroy", () => {
    test("stops collecting clicks", () => {
      const { ctx, canvas, target } = makeHarness();
      const handle = interactivePca(target);
      clickWorld(canvas, 5, 5);
      const before = draws(ctx).length;

      handle.destroy();
      clickWorld(canvas, 20, 20);

      expect(handle.getPoints()).toHaveLength(1);
      expect(draws(ctx)).toHaveLength(before);
    });

    test("leaves nothing listening on a detached element", () => {
      // Holding the element and detaching it proves the listener left with
      // the component rather than with the node.
      const { ctx, canvas, target } = makeHarness();
      const handle = interactivePca(target, { initialPoints: threePoints });

      handle.destroy();
      canvas.remove();
      clickWorld(canvas, 20, 20);

      expect(handle.getPoints()).toHaveLength(3);
      expect(draws(ctx)).toHaveLength(1);
    });

    test("keeps the points and the fit readable", () => {
      const { target } = makeHarness();
      const handle = interactivePca(target, { initialPoints: threePoints });

      handle.destroy();

      expect(handle.getPoints()).toHaveLength(3);
      expect(handle.getFit()).not.toBeNull();
    });
  });
});
