/**
 * Tests for the t-test plot.
 *
 * These are structural, not pixel comparisons: they check that the right
 * shapes are drawn in the right colors at the right world coordinates. The
 * numbers behind the picture are already pinned against R in
 * `src/core/ttest.test.ts`, so nothing here re-tests the statistics.
 *
 * Drawing behavior comes from `../compstatslib/R/t_statistic_plot.R`.
 */

import { describe, expect, test } from "bun:test";

import { tTestStats } from "../core/ttest";
import { RecordingContext } from "../../test/recording-context";
import type { DrawCall } from "../../test/recording-context";
import { plotTTest, tTestScale } from "./tTest";
import type { PlotTTestOptions } from "./tTest";

const WIDTH = 640;
const HEIGHT = 400;

/** R: `rgb(0.75, 0.1, 0.1)`, the null curve. */
const NULL_COLOR = "#bf1a1a";
/** R: `rgb(1, 0.5, 0.5)`, the rejection region. */
const NULL_FILL = "#ff8080";
/** R: `rgb(0.1, 0.1, 0.75)`, the alternative curve. */
const ALT_COLOR = "#1a1abf";
/** R: `rgb(0.4, 0.4, 1, 0.3)`, the power region and the median segment. */
const ALT_FILL = "rgba(102, 102, 255, 0.3)";
/** R: `rgb(0.30, 0.50, 0.75, 0.5)`, the two "Correct!" cells. */
const CORRECT_FILL = "rgba(77, 128, 191, 0.5)";

function draw(options: PlotTTestOptions = {}): RecordingContext {
  const ctx = new RecordingContext();
  plotTTest({ ctx, width: WIDTH, height: HEIGHT }, options);
  return ctx;
}

/** Every `stroke` whose color was this one when it ran. */
function strokesIn(ctx: RecordingContext, color: string): DrawCall[] {
  return ctx.callsTo("stroke").filter((call) => call.style.strokeStyle === color);
}

/** Every `fill` whose color was this one when it ran. */
function fillsIn(ctx: RecordingContext, color: string): DrawCall[] {
  return ctx.callsTo("fill").filter((call) => call.style.fillStyle === color);
}

describe("plotTTest", () => {
  describe("the statistics it reports", () => {
    test("returns what it drew, for the defaults", () => {
      const ctx = new RecordingContext();
      const stats = plotTTest({ ctx, width: WIDTH, height: HEIGHT });
      expect(stats).toEqual(tTestStats());
    });

    test("forwards its options to the statistics", () => {
      const options = { diff: 2, sd: 2, n: 10, alpha: 0.01 };
      const ctx = new RecordingContext();
      const stats = plotTTest({ ctx, width: WIDTH, height: HEIGHT }, options);
      expect(stats).toEqual(tTestStats(options));
    });

    test("keeps the error-matrix switch out of the statistics", () => {
      const ctx = new RecordingContext();
      const stats = plotTTest(
        { ctx, width: WIDTH, height: HEIGHT },
        { errorMatrix: true },
      );
      expect(stats).toEqual(tTestStats());
    });
  });

  describe("the two curves", () => {
    test("draws the null curve solid, in R's red", () => {
      const strokes = strokesIn(draw(), NULL_COLOR);
      expect(strokes).toHaveLength(1);
      expect(strokes[0]?.style.lineDash).toEqual([]);
      expect(strokes[0]?.style.lineWidth).toBe(2);
    });

    test("draws the alternative curve dashed, in R's blue", () => {
      const strokes = strokesIn(draw(), ALT_COLOR);
      expect(strokes).toHaveLength(1);
      expect(strokes[0]?.style.lineDash.length).toBeGreaterThan(0);
      expect(strokes[0]?.style.lineWidth).toBe(2);
    });

    /**
     * R calls `t_alt_lines()` twice, once to draw and once to collect the
     * numbers it returns, so the alternative curve is stroked over itself.
     * That is an accident of how the R function is written, and a dashed line
     * drawn twice is not the same picture as one drawn once.
     */
    test("draws the alternative curve once, not twice as R does", () => {
      expect(strokesIn(draw(), ALT_COLOR)).toHaveLength(1);
      expect(fillsIn(draw(), ALT_FILL)).toHaveLength(1);
    });

    test("shades the rejection region under the null curve", () => {
      expect(fillsIn(draw(), NULL_FILL)).toHaveLength(1);
    });

    test("shades the power region under the alternative curve", () => {
      expect(fillsIn(draw(), ALT_FILL)).toHaveLength(1);
    });

    test("marks the alternative median with a segment", () => {
      expect(strokesIn(draw(), ALT_FILL)).toHaveLength(1);
    });

    test("paints a white background first", () => {
      const ctx = draw();
      const first = ctx.callsTo("fillRect")[0];
      expect(first?.args).toEqual([0, 0, WIDTH, HEIGHT]);
      expect(first?.style.fillStyle).toBe("#ffffff");
    });
  });

  /**
   * Once the difference is large enough, beta underflows to 0 and
   * `tTestStats` reports the power region as starting at −Infinity. R hands
   * that straight to `seq()` and stops with an error. These settings are
   * inside the slider ranges, so the plot has to clamp instead.
   */
  describe("a power region with no lower bound", () => {
    const runaway = { diff: 4, sd: 1, n: 100, alpha: 0.1 };

    test("still reports an unbounded region from the statistics", () => {
      expect(tTestStats(runaway).altFill.from).toBe(Number.NEGATIVE_INFINITY);
    });

    test("draws every coordinate as a real number", () => {
      const ctx = draw(runaway);
      const coordinates = ctx.calls
        .filter((call) => call.method !== "setLineDash")
        .flatMap((call) => call.args)
        .filter((arg): arg is number => typeof arg === "number");
      expect(coordinates.length).toBeGreaterThan(0);
      for (const value of coordinates) {
        expect(Number.isFinite(value)).toBe(true);
      }
    });

    test("still shades the region", () => {
      expect(fillsIn(draw(runaway), ALT_FILL)).toHaveLength(1);
    });
  });

  describe("the error matrix", () => {
    test("stays off unless asked for, as in R's signature", () => {
      expect(draw().texts()).not.toContain("Type I error");
    });

    test("names all four outcomes when asked for", () => {
      const texts = draw({ errorMatrix: true }).texts();
      expect(texts).toContain("Type I error");
      expect(texts).toContain("Type II error");
      expect(texts.filter((text) => text === "Correct!")).toHaveLength(2);
    });

    test("captions the rows and the columns as R does", () => {
      const texts = draw({ errorMatrix: true }).texts();
      expect(texts).toContain("REJECT");
      expect(texts).toContain("CANNOT REJECT");
      expect(texts).toContain("really TRUE");
      expect(texts).toContain("really FALSE");
    });

    test("prints the cell values R prints, for the defaults", () => {
      const texts = draw({ errorMatrix: true }).texts();
      // alpha and 1 - alpha go in raw; power and beta are rounded to two.
      expect(texts).toContain("0.05");
      expect(texts).toContain("0.34");
      expect(texts).toContain("0.95");
      expect(texts).toContain("0.66");
    });

    test("prints the cell values R prints, for a second parameter set", () => {
      const texts = draw({
        diff: 2,
        sd: 2,
        n: 10,
        alpha: 0.01,
        errorMatrix: true,
      }).texts();
      expect(texts).toContain("0.01");
      expect(texts).toContain("0.64");
      expect(texts).toContain("0.99");
      expect(texts).toContain("0.36");
    });

    test("puts the four cells at R's coordinates", () => {
      const options = { errorMatrix: true };
      const scale = tTestScale(WIDTH, HEIGHT, options);
      const cell = (xl: number, yb: number, xr: number, yt: number) => [
        scale.toPixelX(xl),
        scale.toPixelY(yt),
        scale.toPixelX(xr) - scale.toPixelX(xl),
        scale.toPixelY(yb) - scale.toPixelY(yt),
      ];

      const rects = draw(options).callsTo("rect");
      const drawn = rects.map((call) => call.args);
      expect(drawn).toContainEqual(cell(-5.5, 0.25, -4, 0.375));
      expect(drawn).toContainEqual(cell(-4, 0.25, -2.5, 0.375));
      expect(drawn).toContainEqual(cell(-5.5, 0.125, -4, 0.25));
      expect(drawn).toContainEqual(cell(-4, 0.125, -2.5, 0.25));
    });

    test("colors the cells as R does", () => {
      const fills = draw({ errorMatrix: true }).callsTo("fill");
      const colors = fills.map((call) => call.style.fillStyle);
      // Two error cells in red, two correct cells in the translucent blue.
      expect(colors.filter((color) => color === NULL_FILL).length).toBe(3);
      expect(colors.filter((color) => color === CORRECT_FILL).length).toBe(2);
    });
  });

  describe("the highlighted row", () => {
    test("rings the bottom row when rejection is the less likely outcome", () => {
      const options = { errorMatrix: true };
      // The switch is a drawing option, so the statistics come from defaults.
      expect(tTestStats().errorMatrix.highlightTopRow).toBe(false);

      const scale = tTestScale(WIDTH, HEIGHT, options);
      const expected = [
        scale.toPixelX(-5.5),
        scale.toPixelY(0.25),
        scale.toPixelX(-2.5) - scale.toPixelX(-5.5),
        scale.toPixelY(0.125) - scale.toPixelY(0.25),
      ];
      const ringed = draw(options)
        .callsTo("rect")
        .filter((call) => call.style.strokeStyle === ALT_COLOR);
      expect(ringed).toHaveLength(1);
      expect(ringed[0]?.args).toEqual(expected);
      expect(ringed[0]?.style.lineWidth).toBe(4);
    });

    test("rings the top row when rejection is the likely outcome", () => {
      const options = {
        diff: 2,
        sd: 2,
        n: 10,
        alpha: 0.01,
        errorMatrix: true,
      };
      expect(tTestStats(options).errorMatrix.highlightTopRow).toBe(true);

      const scale = tTestScale(WIDTH, HEIGHT, options);
      const expected = [
        scale.toPixelX(-5.5),
        scale.toPixelY(0.375),
        scale.toPixelX(-2.5) - scale.toPixelX(-5.5),
        scale.toPixelY(0.25) - scale.toPixelY(0.375),
      ];
      const ringed = draw(options)
        .callsTo("rect")
        .filter((call) => call.style.strokeStyle === ALT_COLOR);
      expect(ringed).toHaveLength(1);
      expect(ringed[0]?.args).toEqual(expected);
    });
  });

  describe("the drawing window", () => {
    test("spans R's x limits of −6 to 6", () => {
      const scale = tTestScale(WIDTH, HEIGHT);
      expect(scale.world.x).toEqual({ min: -6, max: 6 });
    });

    test("makes room for the error matrix when it is shown", () => {
      const plain = tTestScale(WIDTH, HEIGHT);
      const withMatrix = tTestScale(WIDTH, HEIGHT, { errorMatrix: true });
      expect(withMatrix.world.y.max).toBeGreaterThanOrEqual(0.375);
      expect(withMatrix.world.y.max).toBeGreaterThan(plain.world.y.max);
    });

    test("fits the tallest curve when the error matrix is off", () => {
      const stats = tTestStats();
      const scale = tTestScale(WIDTH, HEIGHT);
      expect(scale.world.y.max).toBeGreaterThan(stats.altMedianDensity);
      expect(scale.world.y.min).toBeLessThanOrEqual(0);
    });
  });
});

/**
 * R writes the raw cells through `as.character()`, which keeps 15 significant
 * digits. JavaScript's own `String()` keeps every digit that identifies the
 * double, so `1 - 0.07` would read as "0.9299999999999999". Alpha steps in
 * hundredths, so that setting is one slider notch away.
 */
describe("cell values across every alpha the slider offers", () => {
  for (const alpha of [
    0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1,
  ]) {
    test(`prints short values at alpha = ${alpha}`, () => {
      const texts = draw({ alpha, errorMatrix: true }).texts();
      for (const text of texts) {
        expect(text).not.toMatch(/\d{6,}/);
      }
      expect(texts).toContain(String(Number((1 - alpha).toPrecision(15))));
    });
  }
});

/**
 * Where a text draw actually lands on the surface.
 *
 * The recording context stores the coordinates a call was given, not the
 * transform in force, so a rotated caption records as x = 0. Replaying the
 * transform calls recovers the real position.
 */
interface PlacedText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /** The type size in force, in pixels. */
  readonly fontSize: number;
}

/** A 2D affine transform, as the canvas holds it. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function translated(m: Matrix, tx: number, ty: number): Matrix {
  const [a, b, c, d, e, f] = m;
  return [a, b, c, d, a * tx + c * ty + e, b * tx + d * ty + f];
}

function rotated(m: Matrix, angle: number): Matrix {
  const [a, b, c, d, e, f] = m;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    a * cos + c * sin,
    b * cos + d * sin,
    -a * sin + c * cos,
    -b * sin + d * cos,
    e,
    f,
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = m;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

/** Replay the recorded calls and report where each text really landed. */
function placedTexts(ctx: RecordingContext): PlacedText[] {
  let current: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  const placed: PlacedText[] = [];

  for (const call of ctx.calls) {
    if (call.method === "save") {
      stack.push(current);
    } else if (call.method === "restore") {
      current = stack.pop() ?? IDENTITY;
    } else if (call.method === "translate") {
      current = translated(current, call.args[0] as number, call.args[1] as number);
    } else if (call.method === "rotate") {
      current = rotated(current, call.args[0] as number);
    } else if (call.method === "fillText") {
      const point = apply(current, call.args[1] as number, call.args[2] as number);
      placed.push({
        text: String(call.args[0]),
        x: point.x,
        y: point.y,
        fontSize: Number.parseFloat(call.style.font),
      });
    }
  }

  return placed;
}

/**
 * The rotated captions beside the two rows of the error matrix.
 *
 * R anchors these at `xl - 0.45` and lets base graphics clip whatever falls
 * outside the plot region. Canvas does not clip text, so the same anchor puts
 * two of the three lines of each block left of the axis, on top of the tick
 * numbers. The port fits the block into the gap instead.
 */
describe("the rotated row captions", () => {
  const ROW_CAPTION_LINES = new Set([
    "If evidence says",
    "REJECT",
    "CANNOT REJECT",
    "null hypothesis",
  ]);

  const COLUMN_CAPTION_LINES = new Set([
    "If null is",
    "really TRUE",
    "really FALSE",
  ]);

  for (const [width, height] of [
    [760, 480],
    [600, 400],
    [400, 300],
  ] as const) {
    describe(`at ${width} by ${height}`, () => {
      const ctx = new RecordingContext();
      plotTTest({ ctx, width, height }, { errorMatrix: true });
      const scale = tTestScale(width, height, { errorMatrix: true });
      const placed = placedTexts(ctx);
      const captions = placed.filter((entry) =>
        ROW_CAPTION_LINES.has(entry.text),
      );

      test("keeps the column captions below the top of the plot", () => {
        const columnCaptions = placed.filter((entry) =>
          COLUMN_CAPTION_LINES.has(entry.text),
        );
        expect(columnCaptions.length).toBeGreaterThan(0);
        for (const caption of columnCaptions) {
          // Drawn on a "bottom" baseline, so the ink rises a line above y.
          expect(caption.y - caption.fontSize).toBeGreaterThanOrEqual(
            scale.area.top,
          );
        }
      });

      test("draws both blocks of three lines", () => {
        expect(captions).toHaveLength(6);
      });

      test("keeps every line inside the plot area", () => {
        for (const caption of captions) {
          expect(caption.x).toBeGreaterThanOrEqual(scale.area.left);
        }
      });

      test("keeps every line clear of the cells", () => {
        for (const caption of captions) {
          expect(caption.x).toBeLessThanOrEqual(scale.toPixelX(-5.5));
        }
      });

      test("stacks the lines of a block evenly", () => {
        const columns = [...new Set(captions.map((c) => Math.round(c.x * 100)))]
          .map((value) => value / 100)
          .sort((left, right) => left - right);
        expect(columns).toHaveLength(3);
      });

      if (width >= 600) {
        test("gives each line more room than the type it is set in", () => {
          const columns = [
            ...new Set(captions.map((c) => Math.round(c.x * 100))),
          ]
            .map((value) => value / 100)
            .sort((left, right) => left - right);
          const advance = (columns[1] as number) - (columns[0] as number);
          expect(advance).toBeGreaterThan(captions[0]?.fontSize ?? 0);
        });
      }

      if (width >= 760) {
        test("sets the captions large enough to read", () => {
          for (const caption of captions) {
            expect(caption.fontSize).toBeGreaterThanOrEqual(8);
          }
        });
      }
    });
  }
});
