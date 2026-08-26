/**
 * Tests for `cov()`, `cor()`, `variance()` and `fromFrame()`.
 *
 * Expected values come from R 4.5.3, `../compstatslib/conformance-fixtures/linalg.R`
 * section 5a and 5d, captured in `.claude/plans/003-PLAN-linalg/linalg-fixtures.md`.
 * R accumulates these sums in long double where the platform has one; the
 * fixtures come from arm64, where it does not, so the port's plain-double
 * two-pass sums are compared at a relative tolerance (plan Q1) rather than
 * pinned.
 */

import { describe, expect, test } from "bun:test";
import { moderationData } from "../../data/moderationData";
import { cor, cov, variance } from "./cov";
import { fromFrame, fromRows, type Matrix } from "./matrix";

function columnMajor(m: Matrix): number[] {
  return Array.from(m.data);
}

function relativelyClose(actual: readonly number[], expected: readonly number[], tolerance = 1e-12): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    const target = expected[index] as number;
    expect(Math.abs(value - target)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(target)));
  });
}

describe("fromFrame()", () => {
  test("takes the numeric columns in frame order, named", () => {
    const m = fromFrame(moderationData);
    expect([m.nrow, m.ncol]).toEqual([200, 4]);
    expect(m.dimnames).toEqual([null, ["y", "x", "z", "w"]]);
    expect(m.data[0]).toBe(moderationData.y[0] as number);
    expect(m.data[200]).toBe(moderationData.x[0] as number);
  });

  test("takes the columns asked for, in the order asked", () => {
    const m = fromFrame(moderationData, ["z", "x"]);
    expect(m.dimnames).toEqual([null, ["z", "x"]]);
    expect(m.data[0]).toBe(moderationData.z[0] as number);
  });

  test("refuses an absent or non-numeric column, through requireNumericColumn", () => {
    expect(() => fromFrame(moderationData, ["nope"])).toThrow(/"nope"/);
    expect(() => fromFrame({ a: [1], g: ["s"] }, ["g"])).toThrow(/not numeric/);
  });

  test("a frame with no numeric column gives a 0-column matrix", () => {
    const m = fromFrame({ g: ["a", "b"] });
    expect([m.nrow, m.ncol]).toEqual([2, 0]);
  });
});

describe("cov() and cor() of a matrix — fixture 5a", () => {
  const md = fromFrame(moderationData);

  test("cov(moderation_data)", () => {
    const c = cov(md);
    expect([c.nrow, c.ncol]).toEqual([4, 4]);
    expect(c.dimnames).toEqual([
      ["y", "x", "z", "w"],
      ["y", "x", "z", "w"],
    ]);
    relativelyClose(columnMajor(c), [
      13.130216870418792, 1.7335018707346275, 2.2355214934949488,
      -0.18660607788546715, 1.7335018707346275, 3.7992651038631635,
      -0.29671246468290619, -0.22101689324441653, 2.2355214934949488,
      -0.29671246468290619, 3.58784692080184, 0.021106295244526552,
      -0.18660607788546715, -0.22101689324441653, 0.021106295244526552,
      3.4526499928181971,
    ]);
  });

  test("cov is symmetric bit for bit", () => {
    const c = cov(md);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        expect(c.data[j * 4 + i]).toBe(c.data[i * 4 + j] as number);
      }
    }
  });

  test("cor(moderation_data)", () => {
    const c = cor(md);
    expect(c.dimnames).toEqual([
      ["y", "x", "z", "w"],
      ["y", "x", "z", "w"],
    ]);
    relativelyClose(columnMajor(c), [
      1, 0.24543617025382, 0.32570614137934573, -0.027714915442874466,
      0.24543617025382, 1, -0.080365386778947223, -0.061023820407620728,
      0.32570614137934573, -0.080365386778947223, 1, 0.005996789149513326,
      -0.027714915442874466, -0.061023820407620728, 0.005996789149513326, 1,
    ]);
    expect(c.data[0]).toBe(1);
    expect(c.data[15]).toBe(1);
  });

  test("cov of an unnamed matrix has no dimnames", () => {
    expect(cov(fromRows([[1, 2], [3, 4], [5, 7]])).dimnames).toBeNull();
  });
});

describe("cov(), cor(), variance() of vectors — fixture 5d", () => {
  test("cov(x, z), cor(x, z), var(x)", () => {
    relativelyClose([cov(moderationData.x, moderationData.z)], [-0.29671246468290619]);
    relativelyClose([cor(moderationData.x, moderationData.z)], [-0.080365386778947223]);
    relativelyClose([variance(moderationData.x)], [3.7992651038631635]);
  });

  test("a missing value gives NaN, as R gives NA", () => {
    expect(cov([1, 2, Number.NaN], [2, 4, 6])).toBeNaN();
    expect(cor([1, 2, Number.NaN], [2, 4, 6])).toBeNaN();
  });

  test("a constant gives NaN for cor, where R warns and gives NA", () => {
    expect(cor([1, 1, 1], [1, 2, 3])).toBeNaN();
  });

  test("one observation gives NaN, as R gives NA", () => {
    expect(variance([4])).toBeNaN();
    expect(cov([4], [5])).toBeNaN();
  });

  test("refuses a length mismatch", () => {
    expect(() => cov([1, 2], [1, 2, 3])).toThrow(RangeError);
    expect(() => cor([1, 2], [1, 2, 3])).toThrow(RangeError);
  });

  test("cor is clamped to [-1, 1]", () => {
    expect(Math.abs(cor([1, 2, 3], [2, 4, 6]))).toBeLessThanOrEqual(1);
    expect(cor([1, 2, 3], [2, 4, 6])).toBe(1);
  });
});
