/**
 * Tests for the interactive logit, ported from `interactive_logit()` in
 * `../compstatslib/R/logit_interactive.R`.
 *
 * These tests exercise state and input handling only. The drawing belongs to
 * `plotLogit`, which `src/plot/logit.test.ts` covers. Each test reads the
 * recorded calls to answer two questions: did the component redraw, and did it
 * hand `plotLogit` the points and the options it was given.
 *
 * The test dispatches real `MouseEvent`s at a real happy-dom canvas, so the
 * listener wiring and the pixel arithmetic run as they do in a browser.
 * happy-dom gives that canvas no 2D context, so the drawing goes to a separate
 * recording surface. See `makeHarness`.
 *
 * Three details come straight from the R source:
 *
 * - `max_x` defaults to **50** here, where `plot_logit()` defaults it to 1, and
 *   R widens it once at startup from the points it was given.
 * - A click is clamped with `max(0, min(max_x, click$x))`. The lower bound is
 *   zero, not `min_x`, so a click left of the origin lands on it even when the
 *   window opens further left. That is R's rule, quirk and all.
 * - The outcome is `round(click$y)`, which is what makes every collected point
 *   a 0 or a 1.
 */

import { describe, expect, test } from "bun:test";

import type { Point } from "../core/regression.js";
import { RecordingContext } from "../../test/recording-context.js";
import type { DrawCall } from "../../test/recording-context.js";
import { createScale } from "../plot/axes.js";
import { interactiveLogit } from "./logit.js";

const WIDTH = 600;
const HEIGHT = 400;

/** R's interactive window: x from `min_x` 0 to `max_x` 50, y a probability. */
const scale = createScale({
  width: WIDTH,
  height: HEIGHT,
  x: { min: 0, max: 50 },
  y: { min: 0, max: 1 },
});

interface Harness {
  readonly ctx: RecordingContext;
  readonly canvas: HTMLCanvasElement;
  readonly target: {
    readonly surface: { ctx: RecordingContext; width: number; height: number };
    readonly element: HTMLCanvasElement;
  };
}

function makeHarness(): Harness {
  const ctx = new RecordingContext();
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  document.body.appendChild(canvas);
  return {
    ctx,
    canvas,
    target: { surface: { ctx, width: WIDTH, height: HEIGHT }, element: canvas },
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

/** Click at a world coordinate of the default window. */
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

/** Return the legend lines of the most recent draw. */
function legendLines(ctx: RecordingContext): string[] {
  return lastDraw(ctx)
    .filter(
      (call) =>
        call.method === "fillText" && call.style.font.includes("monospace"),
    )
    .map((call) => String(call.args[0]));
}

/** Report whether the most recent draw drew the fitted curve. */
function drewCurve(ctx: RecordingContext): boolean {
  return lastDraw(ctx).some(
    (call) =>
      call.method === "stroke" && call.style.strokeStyle === "cornflowerblue",
  );
}

describe("interactiveLogit", () => {
  describe("on creation", () => {
    test("draws once", () => {
      const { ctx, target } = makeHarness();
      interactiveLogit(target);
      expect(draws(ctx)).toHaveLength(1);
    });

    test("starts with no points", () => {
      const { target } = makeHarness();
      expect(interactiveLogit(target).getPoints()).toEqual([]);
    });

    test("draws the points it was given", () => {
      const { ctx, target } = makeHarness();
      const initialPoints: Point[] = [
        { x: 10, y: 0 },
        { x: 30, y: 1 },
      ];
      const handle = interactiveLogit(target, { initialPoints });
      expect(handle.getPoints()).toEqual(initialPoints);
      expect(dotCount(ctx)).toBe(2);
      expect(drewCurve(ctx)).toBe(true);
    });
  });

  describe("clicking", () => {
    test("adds a point where the click landed", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveLogit(target);
      clickWorld(canvas, 25, 0.9);
      expect(handle.getPoints()).toEqual([{ x: 25, y: 1 }]);
    });

    test("rounds the outcome to 0 or 1, as R's round(click$y) does", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveLogit(target);
      clickWorld(canvas, 10, 0.9);
      clickWorld(canvas, 20, 0.1);
      clickWorld(canvas, 30, 0.6);
      clickWorld(canvas, 40, 0.4);
      expect(handle.getPoints().map((point) => point.y)).toEqual([1, 0, 1, 0]);
    });

    test("keeps the x of the click", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveLogit(target);
      clickWorld(canvas, 12.5, 0.9);
      expect(handle.getPoints()[0]?.x).toBeCloseTo(12.5, 9);
    });

    test("redraws on every click", () => {
      const { ctx, canvas, target } = makeHarness();
      interactiveLogit(target);
      clickWorld(canvas, 10, 0.9);
      clickWorld(canvas, 20, 0.1);
      expect(draws(ctx)).toHaveLength(3);
      expect(dotCount(ctx)).toBe(2);
    });

    test("fits once there are two points", () => {
      const { ctx, canvas, target } = makeHarness();
      interactiveLogit(target);
      clickWorld(canvas, 10, 0.1);
      expect(drewCurve(ctx)).toBe(false);
      clickWorld(canvas, 40, 0.9);
      expect(drewCurve(ctx)).toBe(true);
      expect(legendLines(ctx)).toHaveLength(3);
    });

    test("ignores a click outside the plot area", () => {
      const { ctx, canvas, target } = makeHarness();
      const handle = interactiveLogit(target);
      clickAt(canvas, 2, 2);
      clickAt(canvas, WIDTH - 2, HEIGHT - 2);
      expect(handle.getPoints()).toEqual([]);
      expect(draws(ctx)).toHaveLength(1);
    });

    test("accepts a click on the edge of the plot area", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveLogit(target);
      clickAt(canvas, scale.area.left, scale.area.top);
      expect(handle.getPoints()).toEqual([{ x: 0, y: 1 }]);
    });
  });

  describe("R's click clamp", () => {
    test("pins a click left of the origin to zero", () => {
      // R: click_x <- max(0, min(max_x, click$x)). The lower bound is 0 even
      // when min_x is below it, which it is here because an initial point at
      // -6 opens the window that far left.
      const { canvas, target } = makeHarness();
      const wide = createScale({
        width: WIDTH,
        height: HEIGHT,
        x: { min: -6, max: 50 },
        y: { min: 0, max: 1 },
      });
      const handle = interactiveLogit(target, {
        initialPoints: [{ x: -6, y: 0 }],
      });
      clickAt(canvas, wide.toPixelX(-3), wide.toPixelY(0.9));
      expect(handle.getPoints()[1]).toEqual({ x: 0, y: 1 });
    });

    test("maps a click through the window the points widened", () => {
      const { canvas, target } = makeHarness();
      const wide = createScale({
        width: WIDTH,
        height: HEIGHT,
        x: { min: 0, max: 80 },
        y: { min: 0, max: 1 },
      });
      const handle = interactiveLogit(target, {
        initialPoints: [{ x: 80, y: 1 }],
      });
      clickAt(canvas, wide.toPixelX(70), wide.toPixelY(0.1));
      expect(handle.getPoints()[1]?.x).toBeCloseTo(70, 9);
    });

    test("opens the window to maxX from the options", () => {
      const { canvas, target } = makeHarness();
      const narrow = createScale({
        width: WIDTH,
        height: HEIGHT,
        x: { min: 0, max: 10 },
        y: { min: 0, max: 1 },
      });
      const handle = interactiveLogit(target, { maxX: 10 });
      clickAt(canvas, narrow.toPixelX(5), narrow.toPixelY(0.9));
      expect(handle.getPoints()[0]?.x).toBeCloseTo(5, 9);
    });
  });

  describe("forwarded plot options", () => {
    const twoPoints: Point[] = [
      { x: 10, y: 0 },
      { x: 40, y: 1 },
    ];

    test("passes stats through to the plot", () => {
      const { ctx, target } = makeHarness();
      interactiveLogit(target, { initialPoints: twoPoints, stats: false });
      expect(drewCurve(ctx)).toBe(true);
      expect(legendLines(ctx)).toHaveLength(0);
    });

    test("passes regression through to the plot", () => {
      const { ctx, target } = makeHarness();
      interactiveLogit(target, {
        initialPoints: twoPoints,
        regression: false,
      });
      expect(drewCurve(ctx)).toBe(false);
      expect(dotCount(ctx)).toBe(2);
    });

    test("passes legendLoc through to the plot", () => {
      const { ctx: left, target: leftTarget } = makeHarness();
      const { ctx: right, target: rightTarget } = makeHarness();
      interactiveLogit(leftTarget, { initialPoints: twoPoints });
      interactiveLogit(rightTarget, {
        initialPoints: twoPoints,
        legendLoc: "bottomright",
      });
      const leftX = lastDraw(left)
        .filter((call) => call.method === "fillText")
        .filter((call) => call.style.font.includes("monospace"))
        .map((call) => call.args[1] as number);
      const rightX = lastDraw(right)
        .filter((call) => call.method === "fillText")
        .filter((call) => call.style.font.includes("monospace"))
        .map((call) => call.args[1] as number);
      expect(rightX[0]).toBeGreaterThan(leftX[0] as number);
    });

    test("keeps a drawing option out of the collected points", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveLogit(target, {
        stats: false,
        legendLoc: "topright",
      });
      clickWorld(canvas, 25, 0.9);
      expect(handle.getPoints()).toEqual([{ x: 25, y: 1 }]);
    });
  });

  describe("getPoints", () => {
    test("returns a copy", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveLogit(target);
      clickWorld(canvas, 25, 0.9);
      const points = handle.getPoints() as Point[];
      points.push({ x: 99, y: 0 });
      expect(handle.getPoints()).toHaveLength(1);
    });
  });

  describe("reset", () => {
    test("drops every point, including the initial ones", () => {
      const { ctx, canvas, target } = makeHarness();
      const handle = interactiveLogit(target, {
        initialPoints: [{ x: 10, y: 0 }],
      });
      clickWorld(canvas, 25, 0.9);
      handle.reset();
      expect(handle.getPoints()).toEqual([]);
      expect(dotCount(ctx)).toBe(0);
    });

    test("redraws", () => {
      const { ctx, target } = makeHarness();
      interactiveLogit(target).reset();
      expect(draws(ctx)).toHaveLength(2);
    });

    test("leaves the component listening", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveLogit(target);
      handle.reset();
      clickWorld(canvas, 25, 0.9);
      expect(handle.getPoints()).toHaveLength(1);
    });
  });

  describe("done", () => {
    test("hands the points to the callback", () => {
      const { canvas, target } = makeHarness();
      const collected: (readonly Point[])[] = [];
      const handle = interactiveLogit(target, {
        onDone: (points) => collected.push(points),
      });
      clickWorld(canvas, 25, 0.9);
      handle.done();
      expect(collected).toEqual([[{ x: 25, y: 1 }]]);
    });

    test("does nothing without a callback", () => {
      const { target } = makeHarness();
      expect(() => interactiveLogit(target).done()).not.toThrow();
    });

    test("leaves the points in place, so the caller can carry on", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveLogit(target, { onDone: () => undefined });
      clickWorld(canvas, 25, 0.9);
      handle.done();
      expect(handle.getPoints()).toHaveLength(1);
    });
  });

  describe("destroy", () => {
    test("stops collecting clicks", () => {
      const { ctx, canvas, target } = makeHarness();
      const handle = interactiveLogit(target);
      handle.destroy();
      clickWorld(canvas, 25, 0.9);
      expect(handle.getPoints()).toEqual([]);
      expect(draws(ctx)).toHaveLength(1);
    });

    test("leaves the points readable", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveLogit(target);
      clickWorld(canvas, 25, 0.9);
      handle.destroy();
      expect(handle.getPoints()).toEqual([{ x: 25, y: 1 }]);
    });

    test("can run twice", () => {
      const { target } = makeHarness();
      const handle = interactiveLogit(target);
      handle.destroy();
      expect(() => handle.destroy()).not.toThrow();
    });

    test("adds exactly one listener, however many times it redraws", () => {
      // The guard against a listener piling up on each redraw: twenty clicks
      // must leave twenty points, not forty or four hundred.
      const { canvas, target } = makeHarness();
      const handle = interactiveLogit(target);
      for (let index = 0; index < 20; index++) {
        clickWorld(canvas, 5 + index, index % 2 === 0 ? 0.9 : 0.1);
      }
      expect(handle.getPoints()).toHaveLength(20);
    });
  });

  describe("canvas targets", () => {
    test("reports a canvas that gives no 2D context", () => {
      const canvas = document.createElement("canvas");
      expect(() => interactiveLogit(canvas)).toThrow(/2D context/);
    });
  });
});
