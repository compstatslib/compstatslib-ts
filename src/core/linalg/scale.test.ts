/**
 * Tests for R's `scale()`.
 *
 * Expected values come from R 4.5.3,
 * `../compstatslib/conformance-fixtures/linalg.R` section 6, captured in
 * `.claude/plans/004-PLAN-seminr-utilities/linalg-fixtures.md`. R centers
 * with a plain `colMeans` and then divides each column by
 * `sqrt(sum(v^2) / (n - 1))` of the column as it stands after centering.
 * That divisor is the standard deviation when the column was centered and
 * the root mean square when it was not. The port sums in the same order,
 * so the values are compared at 1e-15 relative rather than pinned: R's own
 * `sd` may differ from the port's in the last bit.
 *
 * R reports what it used in the attributes `scaled:center` and
 * `scaled:scale`, and leaves an attribute absent when its argument was
 * `FALSE`. The port returns those as the fields `center` and `scale`, null
 * where R leaves the attribute absent.
 *
 * A column of zero variance divides by zero and gives NaN, which is R's own
 * result with no warning. The fixture prints `NaN` as `NA`, so each case
 * also lists the column-major indices of its NaN entries, 1-based. The
 * indices below are 0-based.
 */

import { describe, expect, test } from "bun:test";

import { moderationData } from "../../data/moderationData.js";
import { at, fromFrame, matrix, type Matrix } from "./matrix.js";
import { scale } from "./scale.js";

/** The entries column by column, as the fixture prints them. */
function columnMajor(m: Matrix): number[] {
  return Array.from(m.data);
}

/**
 * The bar for every value below: `|a - b| <= 1e-15 * max(1, |b|)`, with R's
 * number as the reference. A NaN in the fixture must be a NaN in the port.
 */
function closeTo(actual: readonly number[], expected: readonly number[]): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    const target = expected[index] as number;
    if (Number.isNaN(target)) {
      expect(value).toBeNaN();
      return;
    }
    expect(Math.abs(value - target)).toBeLessThanOrEqual(
      1e-15 * Math.max(1, Math.abs(target)),
    );
  });
}

/** The column-major positions that hold NaN, as the fixture lists them. */
function nanIndices(values: readonly number[]): number[] {
  return values.flatMap((value, index) => (Number.isNaN(value) ? [index] : []));
}

/** Fixture 6e: a 5 x 3 matrix whose third column is constant. */
function m5(): Matrix {
  return matrix([1, 2, 3, 4, 5, 2, 4, 6, 8, 10, 1, 1, 1, 1, 1], {
    nrow: 5,
    dimnames: [null, ["a", "b", "c"]],
  });
}

describe("scale() with the defaults — fixture 6e", () => {
  test("centers on the column mean and divides by the standard deviation", () => {
    const result = scale(m5());
    expect([result.scaled.nrow, result.scaled.ncol]).toEqual([5, 3]);
    closeTo(columnMajor(result.scaled), [
      -1.2649110640673518, -0.63245553203367588, 0, 0.63245553203367588,
      1.2649110640673518, -1.2649110640673518, -0.63245553203367588, 0,
      0.63245553203367588, 1.2649110640673518, Number.NaN, Number.NaN,
      Number.NaN, Number.NaN, Number.NaN,
    ]);
  });

  test("reports the center and the scale it used, as plain arrays", () => {
    const result = scale(m5());
    expect(Array.isArray(result.center)).toBe(true);
    expect(Array.isArray(result.scale)).toBe(true);
    closeTo(result.center as number[], [3, 6, 1]);
    closeTo(result.scale as number[], [
      1.5811388300841898, 3.1622776601683795, 0,
    ]);
  });

  test("the constant column holds NaN, where R holds NA", () => {
    const result = scale(m5());
    expect(nanIndices(columnMajor(result.scaled))).toEqual([10, 11, 12, 13, 14]);
  });

  test("the scaled matrix carries the dimnames of x", () => {
    expect(scale(m5()).scaled.dimnames).toEqual([null, ["a", "b", "c"]]);
  });
});

describe("scale() with center = false — fixture 6e", () => {
  test("divides by the root mean square, not the standard deviation", () => {
    const result = scale(m5(), { center: false });
    closeTo(columnMajor(result.scaled), [
      0.26967994498529685, 0.5393598899705937, 0.80903983495589049,
      1.0787197799411874, 1.3483997249264841, 0.26967994498529685,
      0.5393598899705937, 0.80903983495589049, 1.0787197799411874,
      1.3483997249264841, 0.89442719099991586, 0.89442719099991586,
      0.89442719099991586, 0.89442719099991586, 0.89442719099991586,
    ]);
    closeTo(result.scale as number[], [
      3.7080992435478315, 7.416198487095663, 1.1180339887498949,
    ]);
  });

  test("center is null, where R leaves the attribute absent", () => {
    expect(scale(m5(), { center: false }).center).toBeNull();
  });

  test("no entry is NaN", () => {
    expect(nanIndices(columnMajor(scale(m5(), { center: false }).scaled))).toEqual([]);
  });
});

describe("scale() with scale = false — fixture 6e", () => {
  test("subtracts the column mean and divides by nothing", () => {
    const result = scale(m5(), { scale: false });
    closeTo(columnMajor(result.scaled), [
      -2, -1, 0, 1, 2, -4, -2, 0, 2, 4, 0, 0, 0, 0, 0,
    ]);
    closeTo(result.center as number[], [3, 6, 1]);
  });

  test("scale is null, where R leaves the attribute absent", () => {
    expect(scale(m5(), { scale: false }).scale).toBeNull();
  });
});

describe("scale() with numeric center and scale — fixture 6e", () => {
  test("uses the vectors given and reports them back", () => {
    const result = scale(m5(), { center: [1, 2, 3], scale: [2, 2, 2] });
    closeTo(columnMajor(result.scaled), [
      0, 0.5, 1, 1.5, 2, 0, 1, 2, 3, 4, -1, -1, -1, -1, -1,
    ]);
    closeTo(result.center as number[], [1, 2, 3]);
    closeTo(result.scale as number[], [2, 2, 2]);
  });

  test("center = true with a numeric scale centers first, then divides", () => {
    const result = scale(m5(), { center: true, scale: [1, 2, 4] });
    closeTo(columnMajor(result.scaled), [
      -2, -1, 0, 1, 2, -2, -1, 0, 1, 2, 0, 0, 0, 0, 0,
    ]);
    closeTo(result.center as number[], [3, 6, 1]);
    closeTo(result.scale as number[], [1, 2, 4]);
  });
});

describe("scale() of the moderation data — fixture 6f", () => {
  const md = fromFrame(moderationData);

  test("the center and the scale are R's", () => {
    const result = scale(md);
    closeTo(result.center as number[], [
      -0.31562302098439826, -0.054968891559236052, 0.02256829270178352,
      -0.25603872504820918,
    ]);
    closeTo(result.scale as number[], [
      3.6235641115369814, 1.9491703629655268, 1.8941612710648057,
      1.8581307792559159,
    ]);
  });

  test("rows 1 to 3 are R's, column by column", () => {
    const { scaled } = scale(md);
    expect([scaled.nrow, scaled.ncol]).toEqual([200, 4]);
    expect(scaled.dimnames).toEqual([null, ["y", "x", "z", "w"]]);
    const head = [0, 1, 2, 3].flatMap((j) => [0, 1, 2].map((i) => at(scaled, i, j)));
    closeTo(head, [
      -1.9200085785527279, -0.41981522687174894, 0.77220271582793476,
      1.4349108928566439, -0.55122295703197288, 0.40079909333596364,
      -2.1246484286432845, 0.34051277049011619, 1.2248597822462963,
      -0.12966102495117984, 0.59235846529261005, 1.2008548253105702,
    ]);
  });
});

describe("scale() refuses a vector of the wrong length — fixture 6g", () => {
  test("a short center, in R's words", () => {
    expect(() => scale(m5(), { center: [1, 2] })).toThrow(RangeError);
    expect(() => scale(m5(), { center: [1, 2] })).toThrow(
      "length of 'center' must equal the number of columns of 'x'",
    );
  });

  test("a short scale, in R's words", () => {
    expect(() => scale(m5(), { scale: [1, 2] })).toThrow(RangeError);
    expect(() => scale(m5(), { scale: [1, 2] })).toThrow(
      "length of 'scale' must equal the number of columns of 'x'",
    );
  });
});
