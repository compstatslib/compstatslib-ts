/**
 * Tests for the regression plot, ported from `plot_regression()` in
 * `../compstatslib/R/regression_plot.R`.
 *
 * These are structural checks. The test counts the shapes that reach the
 * context, reads their colors, and reads the text of the statistics block. It
 * does not compare pixels with base R.
 *
 * The four-point fixture is the example in the R documentation,
 * `x = c(1, 3, 5, 8)`, `y = c(2, 4, 6, 8)`. R gives intercept 1.35, slope 0.86,
 * correlation 0.99, SSR 19.78, SSE 0.22, SST 20, and R-squared 0.99 at two
 * decimals. The full-precision values live in `src/core/regression.test.ts`.
 */

import { describe, expect, test } from "bun:test";

import type { Point } from "../core/regression.js";
import { RecordingContext } from "../../test/recording-context.js";
import { createScale } from "./axes.js";
import { plotRegression, regressionScale } from "./regression.js";
import type { RenderTarget } from "./target.js";

const WIDTH = 600;
const HEIGHT = 600;

/** The world window of `plot_regression()`: x and y both run from -5 to 50. */
const WORLD = { min: -5, max: 50 };

const fixture: Point[] = [
  { x: 1, y: 2 },
  { x: 3, y: 4 },
  { x: 5, y: 6 },
  { x: 8, y: 8 },
];

function makeTarget(): { ctx: RecordingContext; target: RenderTarget } {
  const ctx = new RecordingContext();
  return { ctx, target: { ctx, width: WIDTH, height: HEIGHT } };
}

/** The same scale that `plotRegression` builds, for checking drawn positions. */
function expectedScale() {
  return createScale({ width: WIDTH, height: HEIGHT, x: WORLD, y: WORLD });
}

/** Return the strokes drawn in one color. */
function strokesIn(ctx: RecordingContext, color: string) {
  return ctx.callsTo("stroke").filter((call) => call.style.strokeStyle === color);
}

/** Return the statistics lines, which are the only monospace text. */
function statLines(ctx: RecordingContext): string[] {
  return ctx
    .callsTo("fillText")
    .filter((call) => call.style.font.includes("monospace"))
    .map((call) => String(call.args[0]));
}

describe("plotRegression", () => {
  describe("no points", () => {
    test("draws the axes and nothing else", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, []);
      expect(ctx.callsTo("rect")).toHaveLength(1);
      expect(ctx.texts()).toContain("x");
      expect(ctx.texts()).toContain("y");
      expect(ctx.callsTo("arc")).toHaveLength(0);
      expect(statLines(ctx)).toHaveLength(0);
    });

    test("reports no fit", () => {
      const { target } = makeTarget();
      expect(plotRegression(target, [])).toBeNull();
    });
  });

  describe("one point", () => {
    const single: Point[] = [{ x: 10, y: 20 }];

    test("draws the point", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, single);
      expect(ctx.callsTo("arc")).toHaveLength(1);
    });

    test("draws no regression line", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, single);
      expect(strokesIn(ctx, "cornflowerblue")).toHaveLength(0);
    });

    test("draws no mean crosshair", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, single);
      expect(strokesIn(ctx, "lightgray")).toHaveLength(0);
    });

    test("draws no statistics", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, single);
      expect(statLines(ctx)).toHaveLength(0);
    });
  });

  describe("the R documentation example", () => {
    test("draws one filled dot per point, in R's gray", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, fixture);
      const dots = ctx.callsTo("arc");
      expect(dots).toHaveLength(4);
      for (const dot of dots) {
        expect(dot.style.fillStyle).toBe("#bebebe");
      }
    });

    test("places each dot at the pixel of its point", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, fixture);
      const scale = expectedScale();
      const centers = ctx
        .callsTo("arc")
        .map((call) => [call.args[0], call.args[1]]);
      expect(centers).toEqual(
        fixture.map((point) => [
          scale.toPixelX(point.x),
          scale.toPixelY(point.y),
        ]),
      );
    });

    test("draws the regression line in cornflowerblue at width 2", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, fixture);
      const strokes = strokesIn(ctx, "cornflowerblue");
      expect(strokes).toHaveLength(1);
      expect(strokes[0]?.style.lineWidth).toBe(2);
    });

    test("clips the regression line to the plot area", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, fixture);
      expect(ctx.callsTo("clip")).toHaveLength(1);
      expect(ctx.callsTo("save")).toHaveLength(ctx.callsTo("restore").length);
    });

    test("draws the mean crosshair dotted, in lightgray", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, fixture);
      const strokes = strokesIn(ctx, "lightgray");
      expect(strokes).toHaveLength(1);
      expect(strokes[0]?.style.lineWidth).toBe(1);
      expect(strokes[0]?.style.lineDash.length).toBeGreaterThan(0);
    });

    test("runs the crosshair where R's segments() run", () => {
      // R: segments(0, mean_y, 50, mean_y) and segments(mean_x, 0, mean_x, mean_y).
      const { ctx, target } = makeTarget();
      plotRegression(target, fixture);
      const scale = expectedScale();
      const meanX = 4.25;
      const meanY = 5;
      const dashed = ctx.calls.filter(
        (call) =>
          (call.method === "moveTo" || call.method === "lineTo") &&
          call.style.lineDash.length > 0,
      );
      expect(dashed.map((call) => call.args)).toEqual([
        [scale.toPixelX(0), scale.toPixelY(meanY)],
        [scale.toPixelX(50), scale.toPixelY(meanY)],
        [scale.toPixelX(meanX), scale.toPixelY(0)],
        [scale.toPixelX(meanX), scale.toPixelY(meanY)],
      ]);
    });

    test("lists R's statistics, rounded to two decimals", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, fixture);
      expect(statLines(ctx)).toEqual([
        "Raw intercept: 1.35",
        "Raw slope    : 0.86",
        "Correlation  : 0.99",
        "SSR          : 19.78",
        "SSE          : 0.22",
        "SST          : 20",
        "R-squared    : 0.99",
      ]);
    });

    test("puts the statistics block at the top left of the plot area", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, fixture);
      const scale = expectedScale();
      const lines = ctx
        .callsTo("fillText")
        .filter((call) => call.style.font.includes("monospace"));
      const xs = lines.map((call) => Number(call.args[1]));
      const ys = lines.map((call) => Number(call.args[2]));
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(scale.area.left);
        expect(x).toBeLessThan(scale.area.left + scale.area.width / 2);
      }
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(scale.area.top);
      // The lines run down the page in the order R lists them.
      expect(ys).toEqual([...ys].sort((a, b) => a - b));
    });

    test("returns the fit that the core module computed", () => {
      const { target } = makeTarget();
      const fit = plotRegression(target, fixture);
      expect(fit?.slope).toBeCloseTo(0.85981308411214952, 12);
      expect(fit?.intercept).toBeCloseTo(1.3457943925233646, 12);
    });
  });

  describe("options", () => {
    test("regression: false hides the line, crosshair, and statistics", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, fixture, { regression: false });
      expect(ctx.callsTo("arc")).toHaveLength(4);
      expect(strokesIn(ctx, "cornflowerblue")).toHaveLength(0);
      expect(strokesIn(ctx, "lightgray")).toHaveLength(0);
      expect(statLines(ctx)).toHaveLength(0);
    });

    test("stats: false keeps the line and hides the statistics", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, fixture, { stats: false });
      expect(strokesIn(ctx, "cornflowerblue")).toHaveLength(1);
      expect(statLines(ctx)).toHaveLength(0);
    });
  });

  describe("window overrides", () => {
    // The teaching window stays the default. A caller with real data passes
    // its own limits, as plotPca allows.
    const XLIM: readonly [number, number] = [100, 900];
    const YLIM: readonly [number, number] = [10, 30];
    const data: Point[] = [
      { x: 150, y: 12 },
      { x: 400, y: 20 },
      { x: 850, y: 28 },
    ];

    function customScale() {
      return createScale({
        width: WIDTH,
        height: HEIGHT,
        x: { min: 100, max: 900 },
        y: { min: 10, max: 30 },
      });
    }

    test("regressionScale honours xlim and ylim", () => {
      const scale = regressionScale(WIDTH, HEIGHT, { xlim: XLIM, ylim: YLIM });
      const expected = customScale();
      expect(scale.world).toEqual(expected.world);
      expect(scale.toPixelX(400)).toBe(expected.toPixelX(400));
      expect(scale.toPixelY(20)).toBe(expected.toPixelY(20));
    });

    test("without options, regressionScale keeps the R window", () => {
      expect(regressionScale(WIDTH, HEIGHT).world).toEqual({
        x: { min: -5, max: 50 },
        y: { min: -5, max: 50 },
      });
    });

    test("dots land at the pixels of the custom window", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, data, { xlim: XLIM, ylim: YLIM });
      const scale = customScale();
      const dots = ctx.callsTo("arc");
      expect(dots).toHaveLength(3);
      expect(dots.map((call) => [call.args[0], call.args[1]])).toEqual(
        data.map((point) => [scale.toPixelX(point.x), scale.toPixelY(point.y)]),
      );
    });

    test("the crosshair spans the custom window from its low edges", () => {
      // R runs the segments from 0; a window that does not contain 0 clamps
      // that origin to its nearest edge.
      const { ctx, target } = makeTarget();
      plotRegression(target, data, { xlim: XLIM, ylim: YLIM });
      const scale = customScale();
      const meanX = (150 + 400 + 850) / 3;
      const meanY = 20;
      const dashed = ctx.calls.filter(
        (call) =>
          (call.method === "moveTo" || call.method === "lineTo") &&
          call.style.lineDash.length > 0,
      );
      expect(dashed.map((call) => call.args)).toEqual([
        [scale.toPixelX(100), scale.toPixelY(meanY)],
        [scale.toPixelX(900), scale.toPixelY(meanY)],
        [scale.toPixelX(meanX), scale.toPixelY(10)],
        [scale.toPixelX(meanX), scale.toPixelY(meanY)],
      ]);
    });

    test("the fitted line crosses the custom window edge to edge", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, data, { xlim: XLIM, ylim: YLIM });
      const scale = customScale();
      const fit = plotRegression(makeTarget().target, data)!;
      const line = ctx.calls.filter(
        (call) =>
          (call.method === "moveTo" || call.method === "lineTo") &&
          call.style.strokeStyle === "cornflowerblue",
      );
      expect(line.map((call) => call.args)).toEqual([
        [scale.toPixelX(100), scale.toPixelY(fit.intercept! + fit.slope! * 100)],
        [scale.toPixelX(900), scale.toPixelY(fit.intercept! + fit.slope! * 900)],
      ]);
    });
  });

  describe("constant x", () => {
    // R fits an intercept-only model here and reports NA for the slope and the
    // correlation. There is no line to draw.
    const constantX: Point[] = [
      { x: 4, y: 1 },
      { x: 4, y: 2 },
      { x: 4, y: 3 },
      { x: 4, y: 4 },
    ];

    test("draws the points but no line", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, constantX);
      expect(ctx.callsTo("arc")).toHaveLength(4);
      expect(strokesIn(ctx, "cornflowerblue")).toHaveLength(0);
    });

    test("reports the undefined statistics as NA, as R does", () => {
      const { ctx, target } = makeTarget();
      plotRegression(target, constantX);
      expect(statLines(ctx)).toEqual([
        "Raw intercept: 2.5",
        "Raw slope    : NA",
        "Correlation  : NA",
        "SSR          : 0",
        "SSE          : 5",
        "SST          : 5",
        "R-squared    : 0",
      ]);
    });
  });

  describe("canvas targets", () => {
    test("reports a canvas that gives no 2D context", () => {
      const canvas = document.createElement("canvas");
      expect(() => plotRegression(canvas, fixture)).toThrow(/2D context/);
    });
  });
});
