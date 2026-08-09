/**
 * Tests for the interactive regression, ported from
 * `interactive_regression()` in `../compstatslib/R/regression_interactive.R`.
 *
 * These tests exercise state and input handling only. The drawing belongs to
 * `plotRegression`, which `src/plot/regression.test.ts` covers. Each test reads the
 * recorded calls to answer two questions: did the component redraw, and did it
 * hand `plotRegression` the points and the options it was given.
 *
 * The test dispatches real `MouseEvent`s at a real happy-dom canvas, so the
 * listener wiring and the pixel arithmetic run as they do in a browser.
 * happy-dom gives that canvas no 2D context, so the drawing goes to a separate
 * recording surface. See `makeHarness`.
 */

import { describe, expect, test } from "bun:test";

import type { Point } from "../core/regression";
import { RecordingContext } from "../../test/recording-context";
import type { DrawCall } from "../../test/recording-context";
import { createScale } from "../plot/axes";
import { interactiveRegression } from "./regression";

const WIDTH = 600;
const HEIGHT = 600;

/** The world window of `plot_regression()`: x and y both run from -5 to 50. */
const WORLD = { min: -5, max: 50 };

/** The same scale that `plotRegression` draws through. */
const scale = createScale({ width: WIDTH, height: HEIGHT, x: WORLD, y: WORLD });

interface Harness {
  readonly ctx: RecordingContext;
  readonly canvas: HTMLCanvasElement;
  readonly target: {
    readonly surface: { ctx: RecordingContext; width: number; height: number };
    readonly element: HTMLCanvasElement;
  };
}

/**
 * Build a click source and a drawing surface.
 *
 * The element is a real canvas, so `addEventListener` and `dispatchEvent`
 * behave as they do in a browser. The surface is a recording context, because
 * happy-dom returns no 2D context. This split is the pattern for every
 * `interactive/` test.
 */
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

/** Click the element at a world coordinate. */
function clickWorld(canvas: HTMLCanvasElement, x: number, y: number): void {
  clickAt(canvas, scale.toPixelX(x), scale.toPixelY(y));
}

/**
 * Split the recorded calls into one group per draw.
 *
 * Every `plotRegression` call starts by filling the background, so a `fillRect`
 * marks the start of a frame.
 */
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

describe("interactiveRegression", () => {
  describe("on creation", () => {
    test("draws once", () => {
      const { ctx, target } = makeHarness();
      interactiveRegression(target);
      expect(draws(ctx)).toHaveLength(1);
    });

    test("draws empty axes when it holds no points", () => {
      const { ctx, target } = makeHarness();
      interactiveRegression(target);
      expect(dotCount(ctx)).toBe(0);
      expect(ctx.texts()).toContain("x");
      expect(ctx.texts()).toContain("y");
    });

    test("holds no points", () => {
      const { target } = makeHarness();
      expect(interactiveRegression(target).getPoints()).toEqual([]);
    });

    test("holds and draws the initial points", () => {
      const { ctx, target } = makeHarness();
      const initialPoints: Point[] = [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ];
      const handle = interactiveRegression(target, { initialPoints });
      expect(handle.getPoints()).toEqual(initialPoints);
      expect(dotCount(ctx)).toBe(2);
    });
  });

  describe("clicking", () => {
    test("adds the point that the click lands on", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      clickWorld(canvas, 10, 20);
      const points = handle.getPoints();
      expect(points).toHaveLength(1);
      expect(points[0]?.x).toBeCloseTo(10, 10);
      expect(points[0]?.y).toBeCloseTo(20, 10);
    });

    test("reads the world coordinate of the pixel", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      clickAt(canvas, scale.area.left, scale.area.bottom);
      const points = handle.getPoints();
      expect(points[0]?.x).toBeCloseTo(WORLD.min, 10);
      expect(points[0]?.y).toBeCloseTo(WORLD.min, 10);
    });

    test("keeps the points in click order", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      clickWorld(canvas, 30, 5);
      clickWorld(canvas, 10, 40);
      clickWorld(canvas, 20, 25);
      expect(handle.getPoints().map((point) => Math.round(point.x))).toEqual([
        30, 10, 20,
      ]);
    });

    test("redraws after each click", () => {
      const { ctx, canvas, target } = makeHarness();
      interactiveRegression(target);
      clickWorld(canvas, 10, 20);
      clickWorld(canvas, 20, 30);
      expect(draws(ctx)).toHaveLength(3);
      expect(dotCount(ctx)).toBe(2);
    });

    test("ignores a click in the left margin", () => {
      const { ctx, canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      clickAt(canvas, scale.area.left - 10, scale.area.top + 10);
      expect(handle.getPoints()).toEqual([]);
      expect(draws(ctx)).toHaveLength(1);
    });

    test("ignores a click under the x axis", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      clickAt(canvas, scale.area.left + 10, scale.area.bottom + 10);
      expect(handle.getPoints()).toEqual([]);
    });

    test("accepts a click on the edge of the plot area", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      clickAt(canvas, scale.area.right, scale.area.top);
      expect(handle.getPoints()).toHaveLength(1);
    });

    test("returns points that a later click does not change", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      const before = handle.getPoints();
      clickWorld(canvas, 10, 20);
      expect(before).toHaveLength(0);
    });
  });

  describe("forwarded plot options", () => {
    /** Return the statistics lines, which are the only monospace text. */
    function statLines(ctx: RecordingContext): string[] {
      return lastDraw(ctx)
        .filter(
          (call) =>
            call.method === "fillText" && call.style.font.includes("monospace"),
        )
        .map((call) => String(call.args[0]));
    }

    /** Return the strokes of the fitted line. */
    function fittedLines(ctx: RecordingContext): DrawCall[] {
      return lastDraw(ctx).filter(
        (call) =>
          call.method === "stroke" && call.style.strokeStyle === "cornflowerblue",
      );
    }

    test("lists the statistics by default", () => {
      const { ctx, canvas, target } = makeHarness();
      interactiveRegression(target);
      clickWorld(canvas, 10, 20);
      clickWorld(canvas, 30, 40);
      expect(statLines(ctx)).toHaveLength(7);
      expect(fittedLines(ctx)).toHaveLength(1);
    });

    test("hands stats: false to the plot", () => {
      const { ctx, canvas, target } = makeHarness();
      interactiveRegression(target, { stats: false });
      clickWorld(canvas, 10, 20);
      clickWorld(canvas, 30, 40);
      expect(statLines(ctx)).toHaveLength(0);
      expect(fittedLines(ctx)).toHaveLength(1);
    });

    test("hands regression: false to the plot", () => {
      const { ctx, canvas, target } = makeHarness();
      interactiveRegression(target, { regression: false });
      clickWorld(canvas, 10, 20);
      clickWorld(canvas, 30, 40);
      expect(fittedLines(ctx)).toHaveLength(0);
      expect(dotCount(ctx)).toBe(2);
    });
  });

  describe("reset", () => {
    test("drops every point", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveRegression(target, {
        initialPoints: [{ x: 1, y: 2 }],
      });
      clickWorld(canvas, 10, 20);
      handle.reset();
      expect(handle.getPoints()).toEqual([]);
    });

    test("redraws the empty plot", () => {
      const { ctx, canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      clickWorld(canvas, 10, 20);
      handle.reset();
      expect(draws(ctx)).toHaveLength(3);
      expect(dotCount(ctx)).toBe(0);
    });

    test("keeps collecting the clicks that follow", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      clickWorld(canvas, 10, 20);
      handle.reset();
      clickWorld(canvas, 30, 40);
      expect(handle.getPoints()).toHaveLength(1);
    });
  });

  describe("done", () => {
    test("hands the points to the callback", () => {
      const { canvas, target } = makeHarness();
      const collected: (readonly Point[])[] = [];
      const handle = interactiveRegression(target, {
        onDone: (points) => collected.push(points),
      });
      clickWorld(canvas, 10, 20);
      handle.done();
      expect(collected).toHaveLength(1);
      expect(collected[0]).toHaveLength(1);
      expect(collected[0]?.[0]?.x).toBeCloseTo(10, 10);
    });

    test("runs the callback once for each call", () => {
      const { target } = makeHarness();
      let calls = 0;
      const handle = interactiveRegression(target, {
        onDone: () => {
          calls += 1;
        },
      });
      handle.done();
      handle.done();
      expect(calls).toBe(2);
    });

    test("does nothing without a callback", () => {
      const { target } = makeHarness();
      expect(() => interactiveRegression(target).done()).not.toThrow();
    });

    test("leaves the points in place", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      clickWorld(canvas, 10, 20);
      handle.done();
      expect(handle.getPoints()).toHaveLength(1);
    });
  });

  describe("destroy", () => {
    test("stops collecting clicks", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      handle.destroy();
      clickWorld(canvas, 10, 20);
      expect(handle.getPoints()).toEqual([]);
    });

    test("stops redrawing", () => {
      const { ctx, canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      handle.destroy();
      clickWorld(canvas, 10, 20);
      expect(draws(ctx)).toHaveLength(1);
    });

    test("keeps the collected points readable", () => {
      const { canvas, target } = makeHarness();
      const handle = interactiveRegression(target);
      clickWorld(canvas, 10, 20);
      handle.destroy();
      expect(handle.getPoints()).toHaveLength(1);
    });

    test("does nothing on a second call", () => {
      const { target } = makeHarness();
      const handle = interactiveRegression(target);
      handle.destroy();
      expect(() => handle.destroy()).not.toThrow();
    });
  });

  describe("canvas targets", () => {
    test("reports a canvas that gives no 2D context", () => {
      const canvas = document.createElement("canvas");
      expect(() => interactiveRegression(canvas)).toThrow(/2D context/);
    });
  });
});
