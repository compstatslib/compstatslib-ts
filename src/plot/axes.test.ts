/**
 * Tests for the shared 2D axis helper.
 *
 * The coordinate transforms and the tick rule are pure arithmetic, so they get
 * exact assertions. `drawAxes` gets structural checks only: the test counts
 * the shapes and reads the labels, and does not compare pixels with base R.
 *
 * Tick expectations follow R's `pretty()` where the two agree. R values:
 *
 * ```r
 * pretty(c(-5, 50))   # 0 10 20 30 40 50
 * pretty(c(0, 1))     # 0.0 0.2 0.4 0.6 0.8 1.0
 * pretty(c(0, 100))   # 0 20 40 60 80 100
 * pretty(c(-3, 3))    # -3 -2 -1 0 1 2 3
 * ```
 */

import { describe, expect, test } from "bun:test";

import { RecordingContext } from "../../test/recording-context";
import { DEFAULT_MARGINS, createScale, drawAxes, prettyTicks } from "./axes";

const MARGINS = { top: 20, right: 20, bottom: 40, left: 50 };

/** A 600 x 400 scale over the world window x, y in [-5, 50]. */
function testScale() {
  return createScale({
    width: 600,
    height: 400,
    x: { min: -5, max: 50 },
    y: { min: -5, max: 50 },
    margins: MARGINS,
  });
}

describe("createScale", () => {
  test("insets the plot area by the margins", () => {
    const scale = testScale();
    expect(scale.area).toEqual({
      left: 50,
      right: 580,
      top: 20,
      bottom: 360,
      width: 530,
      height: 340,
    });
  });

  test("uses the default margins when none are given", () => {
    const scale = createScale({
      width: 600,
      height: 400,
      x: { min: 0, max: 1 },
      y: { min: 0, max: 1 },
    });
    expect(scale.area.left).toBe(DEFAULT_MARGINS.left);
    expect(scale.area.top).toBe(DEFAULT_MARGINS.top);
    expect(scale.area.right).toBe(600 - DEFAULT_MARGINS.right);
    expect(scale.area.bottom).toBe(400 - DEFAULT_MARGINS.bottom);
  });

  test("maps the world x range onto the width of the plot area", () => {
    const scale = testScale();
    expect(scale.toPixelX(-5)).toBe(50);
    expect(scale.toPixelX(50)).toBe(580);
    expect(scale.toPixelX(22.5)).toBe(315);
  });

  test("maps the world y range onto the height, with y upward", () => {
    const scale = testScale();
    expect(scale.toPixelY(-5)).toBe(360);
    expect(scale.toPixelY(50)).toBe(20);
    expect(scale.toPixelY(22.5)).toBe(190);
  });

  test("inverts both transforms", () => {
    const scale = testScale();
    expect(scale.toWorldX(scale.toPixelX(17))).toBeCloseTo(17, 12);
    expect(scale.toWorldY(scale.toPixelY(17))).toBeCloseTo(17, 12);
    expect(scale.toWorldX(50)).toBeCloseTo(-5, 12);
    expect(scale.toWorldY(20)).toBeCloseTo(50, 12);
  });

  test("keeps the world window it was given", () => {
    expect(testScale().world).toEqual({
      x: { min: -5, max: 50 },
      y: { min: -5, max: 50 },
    });
  });

  test("centres a world range of zero width", () => {
    const scale = createScale({
      width: 600,
      height: 400,
      x: { min: 3, max: 3 },
      y: { min: 3, max: 3 },
      margins: MARGINS,
    });
    expect(scale.toPixelX(3)).toBe(315);
    expect(scale.toPixelY(3)).toBe(190);
  });
});

describe("prettyTicks", () => {
  test("gives R's ticks for the regression window", () => {
    expect(prettyTicks({ min: -5, max: 50 })).toEqual([0, 10, 20, 30, 40, 50]);
  });

  test("gives exact decimals for the unit range", () => {
    expect(prettyTicks({ min: 0, max: 1 })).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  test("steps by 20 over a range of 100", () => {
    expect(prettyTicks({ min: 0, max: 100 })).toEqual([
      0, 20, 40, 60, 80, 100,
    ]);
  });

  test("covers a range that spans zero", () => {
    expect(prettyTicks({ min: -3, max: 3 })).toEqual([
      -3, -2, -1, 0, 1, 2, 3,
    ]);
  });

  test("keeps every tick inside the range", () => {
    const ticks = prettyTicks({ min: 1, max: 9 });
    expect(ticks).toEqual([2, 4, 6, 8]);
  });

  test("honours the requested tick count", () => {
    expect(prettyTicks({ min: 0, max: 100 }, 10)).toEqual([
      0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
    ]);
  });

  test("returns the single value of an empty range", () => {
    expect(prettyTicks({ min: 7, max: 7 })).toEqual([7]);
  });

  test("accepts a reversed range", () => {
    expect(prettyTicks({ min: 50, max: -5 })).toEqual([0, 10, 20, 30, 40, 50]);
  });
});

describe("drawAxes", () => {
  test("draws a box around the plot area", () => {
    const ctx = new RecordingContext();
    drawAxes(ctx, testScale());
    expect(ctx.callsTo("rect")).toHaveLength(1);
    expect(ctx.callsTo("rect")[0]?.args).toEqual([50, 20, 530, 340]);
  });

  test("draws one tick mark per tick on both axes", () => {
    const ctx = new RecordingContext();
    drawAxes(ctx, testScale());
    // Six ticks per axis over [-5, 50], each drawn as one line segment.
    expect(ctx.callsTo("moveTo")).toHaveLength(12);
    expect(ctx.callsTo("lineTo")).toHaveLength(12);
  });

  test("labels every tick", () => {
    const ctx = new RecordingContext();
    drawAxes(ctx, testScale());
    const texts = ctx.texts();
    for (const tick of ["0", "10", "20", "30", "40", "50"]) {
      expect(texts.filter((text) => text === tick)).toHaveLength(2);
    }
  });

  test("draws the axis titles it is given", () => {
    const ctx = new RecordingContext();
    drawAxes(ctx, testScale(), { xLabel: "x", yLabel: "y" });
    expect(ctx.texts()).toContain("x");
    expect(ctx.texts()).toContain("y");
  });

  test("omits titles that are not given", () => {
    const ctx = new RecordingContext();
    drawAxes(ctx, testScale());
    expect(ctx.texts()).not.toContain("x");
    expect(ctx.texts()).not.toContain("y");
  });

  test("rotates the y title and restores the transform", () => {
    const ctx = new RecordingContext();
    drawAxes(ctx, testScale(), { yLabel: "y" });
    expect(ctx.callsTo("rotate")).toHaveLength(1);
    expect(ctx.callsTo("save")).toHaveLength(ctx.callsTo("restore").length);
  });

  test("uses the tick count it is given", () => {
    const ctx = new RecordingContext();
    drawAxes(ctx, testScale(), { tickCount: 10 });
    // Eleven ticks per axis at a step of 5 over [-5, 50].
    expect(ctx.callsTo("moveTo")).toHaveLength(24);
  });
});
