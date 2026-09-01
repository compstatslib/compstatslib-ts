/**
 * Tests for the logistic-regression plot, ported from `plot_logit()` and
 * `plot_points_logit()` in `../compstatslib/R/logit_plot.R`.
 *
 * These are structural checks. The test counts the shapes that reach the
 * context, reads their colors and dash patterns, and reads the text of the
 * legend. It does not compare pixels with base R.
 *
 * The twelve-point fixture is the one in `src/core/logit.test.ts`, where R
 * gives intercept -1.8590563753429619, slope 0.069531921315973633 and AIC
 * 17.893152102357845 — which R's own legend rounds to -1.86, 0.07 and 17.89.
 *
 * Two R details the drawing order depends on:
 *
 * - `plot_points_logit()` calls `plot()` and then `abline(h = 0.5)`, so the
 *   dotted half line is drawn *over* the points, not under them.
 * - The empty case calls `plot_points_logit(NA, min_x, max_x)`, which still
 *   draws that half line. Blank axes here means axes and the half line.
 */

import { describe, expect, test } from "bun:test";

import type { Point } from "../core/regression.js";
import { RecordingContext } from "../../test/recording-context.js";
import { logitScale, plotLogit } from "./logit.js";
import type { RenderTarget } from "./target.js";

const WIDTH = 600;
const HEIGHT = 400;

/** R: `pch = 19, cex = 2, col = "gray"`, which is #BEBEBE. */
const POINT_COLOR = "#bebebe";
const CURVE_COLOR = "cornflowerblue";
const HALF_LINE_COLOR = "lightgray";
/** R: `len = 500` in the `seq()` that builds the curve. */
const CURVE_SAMPLES = 500;

const mainX = [2, 8, 11, 15, 20, 24, 29, 33, 38, 44, 47, 50];
const mainY = [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1];

function pointsFrom(xs: readonly number[], ys: readonly number[]): Point[] {
  return xs.map((x, index) => ({ x, y: ys[index] as number }));
}

const mainPoints = pointsFrom(mainX, mainY);
const separatedPoints = pointsFrom([-6, -3, 1, 3, 5, 8], [0, 0, 0, 1, 1, 1]);

function makeTarget(
  width = WIDTH,
  height = HEIGHT,
): { ctx: RecordingContext; target: RenderTarget } {
  const ctx = new RecordingContext();
  return { ctx, target: { ctx, width, height } };
}

/** Return the strokes drawn in one color. */
function strokesIn(ctx: RecordingContext, color: string) {
  return ctx
    .callsTo("stroke")
    .filter((call) => call.style.strokeStyle === color);
}

/** Return the legend lines, which are the only monospace text. */
function legendLines(ctx: RecordingContext): string[] {
  return ctx
    .callsTo("fillText")
    .filter((call) => call.style.font.includes("monospace"))
    .map((call) => String(call.args[0]));
}

/**
 * Return the calls that draw the fitted curve, in order.
 *
 * The curve is the path between the last `beginPath` and the cornflowerblue
 * `stroke`. Slicing from the start of the recording instead would also pick up
 * the axis ticks and the half line, which are drawn from moveTo and lineTo
 * too.
 */
function curveCalls(ctx: RecordingContext) {
  const stroke = ctx.calls.findIndex(
    (call) =>
      call.method === "stroke" && call.style.strokeStyle === CURVE_COLOR,
  );
  if (stroke === -1) {
    return [];
  }
  const start = ctx.calls
    .slice(0, stroke)
    .map((call) => call.method)
    .lastIndexOf("beginPath");
  return ctx.calls
    .slice(start, stroke)
    .filter((call) => call.method === "moveTo" || call.method === "lineTo");
}

describe("plotLogit", () => {
  describe("no points", () => {
    test("draws the axes and the dotted half line, and nothing else", () => {
      const { ctx, target } = makeTarget();
      plotLogit(target, []);
      expect(ctx.texts()).toContain("x");
      expect(ctx.texts()).toContain("y");
      expect(ctx.callsTo("arc")).toHaveLength(0);
      expect(strokesIn(ctx, CURVE_COLOR)).toHaveLength(0);
      expect(legendLines(ctx)).toHaveLength(0);
      // R's empty branch still calls plot_points_logit, which ablines at 0.5.
      expect(strokesIn(ctx, HALF_LINE_COLOR)).toHaveLength(1);
    });

    test("reports no fit", () => {
      const { target } = makeTarget();
      expect(plotLogit(target, [])).toBeNull();
    });

    test("keeps R's default window of 0 to 1", () => {
      const scale = logitScale(WIDTH, HEIGHT, []);
      expect(scale.world.x).toEqual({ min: 0, max: 1 });
      expect(scale.world.y).toEqual({ min: 0, max: 1 });
    });
  });

  describe("one point", () => {
    const single: Point[] = [{ x: 10, y: 1 }];

    test("draws the point but fits nothing", () => {
      const { ctx, target } = makeTarget();
      plotLogit(target, single);
      expect(ctx.callsTo("arc")).toHaveLength(1);
      expect(strokesIn(ctx, CURVE_COLOR)).toHaveLength(0);
      expect(legendLines(ctx)).toHaveLength(0);
    });

    test("reports no fit, because R returns before calling glm", () => {
      // plot_logit: `if (nrow(points) < 2) return()`. The core would fit a
      // degenerate saturated model here; the plot never asks it to.
      const { target } = makeTarget();
      expect(plotLogit(target, single)).toBeNull();
    });
  });

  describe("the twelve-point fixture", () => {
    test("draws one dot per point in R's gray", () => {
      const { ctx, target } = makeTarget();
      plotLogit(target, mainPoints);
      const dots = ctx
        .callsTo("arc")
        .filter((call) => call.style.fillStyle === POINT_COLOR);
      expect(dots).toHaveLength(mainPoints.length);
    });

    test("puts each dot where the scale says", () => {
      const { ctx, target } = makeTarget();
      plotLogit(target, mainPoints);
      const scale = logitScale(WIDTH, HEIGHT, mainPoints);
      const first = ctx.callsTo("arc")[0];
      expect(first?.args[0]).toBeCloseTo(scale.toPixelX(2), 10);
      expect(first?.args[1]).toBeCloseTo(scale.toPixelY(0), 10);
    });

    test("draws the curve from R's 500 samples in cornflowerblue", () => {
      const { ctx, target } = makeTarget();
      plotLogit(target, mainPoints);
      const calls = curveCalls(ctx);
      expect(calls).toHaveLength(CURVE_SAMPLES);
      expect(calls[0]?.method).toBe("moveTo");
      expect(calls.slice(1).every((call) => call.method === "lineTo")).toBe(
        true,
      );
      expect(strokesIn(ctx, CURVE_COLOR)[0]?.style.lineWidth).toBe(2);
    });

    test("spans the curve across the whole window", () => {
      const { ctx, target } = makeTarget();
      plotLogit(target, mainPoints);
      const scale = logitScale(WIDTH, HEIGHT, mainPoints);
      const calls = curveCalls(ctx);
      expect(calls[0]?.args[0]).toBeCloseTo(scale.toPixelX(0), 10);
      expect(calls[calls.length - 1]?.args[0]).toBeCloseTo(
        scale.toPixelX(50),
        10,
      );
    });

    test("draws the dotted half line over the points, as R's abline does", () => {
      const { ctx, target } = makeTarget();
      plotLogit(target, mainPoints);
      const lastDot = ctx.calls.map((call) => call.method).lastIndexOf("arc");
      const halfLine = ctx.calls.findIndex(
        (call) =>
          call.method === "stroke" &&
          call.style.strokeStyle === HALF_LINE_COLOR,
      );
      expect(halfLine).toBeGreaterThan(lastDot);
      expect(strokesIn(ctx, HALF_LINE_COLOR)[0]?.style.lineDash).toEqual([
        1, 3,
      ]);
    });

    test("writes R's three legend lines", () => {
      const { ctx, target } = makeTarget();
      plotLogit(target, mainPoints);
      expect(legendLines(ctx)).toEqual([
        "Intercept  : -1.86",
        "Coefficient: 0.07",
        "AIC        : 17.89",
      ]);
    });

    test("returns the fit it drew", () => {
      const { target } = makeTarget();
      const fit = plotLogit(target, mainPoints);
      expect(fit?.intercept).toBeCloseTo(-1.8590563753429619, 12);
      expect(fit?.slope).toBeCloseTo(0.069531921315973633, 12);
      expect(fit?.iterations).toBe(4);
    });
  });

  describe("the window", () => {
    test("expands past R's defaults to cover the data", () => {
      // R: max_x <- max(max_x, points$x); min_x <- min(min_x, points$x).
      const scale = logitScale(WIDTH, HEIGHT, mainPoints);
      expect(scale.world.x).toEqual({ min: 0, max: 50 });
    });

    test("expands below zero for negative predictors", () => {
      const scale = logitScale(WIDTH, HEIGHT, separatedPoints);
      expect(scale.world.x).toEqual({ min: -6, max: 8 });
    });

    test("takes wider bounds from the options", () => {
      const scale = logitScale(WIDTH, HEIGHT, mainPoints, {
        minX: -20,
        maxX: 80,
      });
      expect(scale.world.x).toEqual({ min: -20, max: 80 });
    });

    test("still expands to the data when the options are narrower", () => {
      // R takes min(min_x, data) and max(max_x, data), so a narrower option is
      // widened to the data rather than back to R's own 0 and 1 defaults.
      const scale = logitScale(WIDTH, HEIGHT, mainPoints, {
        minX: 10,
        maxX: 20,
      });
      expect(scale.world.x).toEqual({ min: 2, max: 50 });
    });

    test("ignores a non-finite predictor instead of poisoning the window", () => {
      // The core drops the missing row (na.omit); if the window still took
      // Math.min against its NaN, every pixel of the picture would go NaN
      // and the plot would silently draw nothing.
      const scale = logitScale(WIDTH, HEIGHT, [
        { x: -6, y: 0 },
        { x: Number.NaN, y: 1 },
        { x: 8, y: 1 },
      ]);
      expect(scale.world.x).toEqual({ min: -6, max: 8 });
    });

    test("holds y at 0 to 1 whatever the data", () => {
      expect(logitScale(WIDTH, HEIGHT, mainPoints).world.y).toEqual({
        min: 0,
        max: 1,
      });
    });

    test("is the window the plot draws through", () => {
      const { ctx, target } = makeTarget();
      plotLogit(target, separatedPoints, { minX: -20 });
      const scale = logitScale(WIDTH, HEIGHT, separatedPoints, { minX: -20 });
      expect(ctx.callsTo("arc")[0]?.args[0]).toBeCloseTo(
        scale.toPixelX(-6),
        10,
      );
    });
  });

  describe("options", () => {
    test("regression false draws the points alone and reports no fit", () => {
      // R skips the glm() call entirely under regression = FALSE.
      const { ctx, target } = makeTarget();
      const fit = plotLogit(target, mainPoints, { regression: false });
      expect(ctx.callsTo("arc")).toHaveLength(mainPoints.length);
      expect(strokesIn(ctx, CURVE_COLOR)).toHaveLength(0);
      expect(legendLines(ctx)).toHaveLength(0);
      expect(fit).toBeNull();
    });

    test("stats false keeps the curve and drops the legend", () => {
      const { ctx, target } = makeTarget();
      const fit = plotLogit(target, mainPoints, { stats: false });
      expect(strokesIn(ctx, CURVE_COLOR)).toHaveLength(1);
      expect(legendLines(ctx)).toHaveLength(0);
      expect(fit?.intercept).toBeCloseTo(-1.8590563753429619, 12);
    });

    test("does not let a drawing option reach the fit", () => {
      const { target: plain } = makeTarget();
      const { target: dressed } = makeTarget();
      const plainFit = plotLogit(plain, mainPoints);
      const dressedFit = plotLogit(dressed, mainPoints, {
        minX: -30,
        maxX: 90,
        legendLoc: "bottomright",
        stats: false,
      });
      expect(dressedFit?.intercept).toBe(plainFit?.intercept as number);
      expect(dressedFit?.aic).toBe(plainFit?.aic as number);
    });
  });

  describe("the legend position", () => {
    const corners = [
      ["topleft", false, false],
      ["topright", true, false],
      ["bottomleft", false, true],
      ["bottomright", true, true],
    ] as const;

    for (const [corner, onRight, atBottom] of corners) {
      test(`${corner} keeps the block in its corner`, () => {
        const { ctx, target } = makeTarget();
        plotLogit(target, mainPoints, { legendLoc: corner });
        const scale = logitScale(WIDTH, HEIGHT, mainPoints);
        const lines = ctx
          .callsTo("fillText")
          .filter((call) => call.style.font.includes("monospace"));
        expect(lines).toHaveLength(3);

        const midX = (scale.area.left + scale.area.right) / 2;
        const midY = (scale.area.top + scale.area.bottom) / 2;
        for (const line of lines) {
          const x = line.args[1] as number;
          const y = line.args[2] as number;
          expect(onRight ? x > midX : x < midX).toBe(true);
          expect(atBottom ? y > midY : y < midY).toBe(true);
          expect(x).toBeGreaterThanOrEqual(scale.area.left);
          expect(x).toBeLessThanOrEqual(scale.area.right);
        }
      });
    }

    test("defaults to R's topleft", () => {
      const { ctx: left, target: leftTarget } = makeTarget();
      const { ctx: explicit, target: explicitTarget } = makeTarget();
      plotLogit(leftTarget, mainPoints);
      plotLogit(explicitTarget, mainPoints, { legendLoc: "topleft" });
      expect(left.callsTo("fillText").map((call) => call.args)).toEqual(
        explicit.callsTo("fillText").map((call) => call.args),
      );
    });

    test("keeps the block inside the plot area on a short surface", () => {
      // The slice-2 lesson: base graphics clip text at the plot region and
      // canvas does not, so a block anchored to the bottom has to be held
      // inside the area rather than allowed to ride up past the top.
      const { ctx, target } = makeTarget(300, 150);
      plotLogit(target, mainPoints, { legendLoc: "bottomleft" });
      const scale = logitScale(300, 150, mainPoints);
      for (const line of ctx
        .callsTo("fillText")
        .filter((call) => call.style.font.includes("monospace"))) {
        expect(line.args[2] as number).toBeGreaterThanOrEqual(scale.area.top);
        expect(line.args[2] as number).toBeLessThanOrEqual(scale.area.bottom);
      }
    });
  });

  describe("an aliased slope", () => {
    const constantX = pointsFrom([20, 20, 20, 20], [0, 1, 0, 1]);

    test("reports the coefficient as NA, the way R prints an NA", () => {
      const { ctx, target } = makeTarget();
      plotLogit(target, constantX);
      expect(legendLines(ctx)[1]).toBe("Coefficient: NA");
    });

    test("still draws a flat curve", () => {
      const { ctx, target } = makeTarget();
      plotLogit(target, constantX);
      const calls = curveCalls(ctx);
      expect(calls).toHaveLength(CURVE_SAMPLES);
      const heights = new Set(calls.map((call) => call.args[1]));
      expect(heights.size).toBe(1);
    });
  });

  describe("a separated fit", () => {
    test("prints a whole-number AIC without decimals, as R does", () => {
      // R: as.character(round(4.00000000035, 2)) is "4", not "4.00".
      const { ctx, target } = makeTarget();
      plotLogit(target, separatedPoints);
      expect(legendLines(ctx)[2]).toBe("AIC        : 4");
    });
  });
});
