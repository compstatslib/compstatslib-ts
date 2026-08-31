/**
 * Tests for `cov()`, `cor()`, `variance()` and `fromFrame()`.
 *
 * Expected values come from R 4.5.3, `../compstatslib/conformance-fixtures/linalg.R`
 * section 5a and 5d, captured in `.claude/plans/003-PLAN-linalg/linalg-fixtures.md`.
 * R accumulates these sums in long double where the platform has one; the
 * fixtures come from arm64, where it does not, so the port's plain-double
 * two-pass sums are compared at a relative tolerance (plan Q1) rather than
 * pinned.
 *
 * The two-matrix `cov(x, y)` and `cor(x, y)` values come from section 6 of
 * the same script, captured in
 * `.claude/plans/004-PLAN-seminr-utilities/linalg-fixtures.md`. R's `cov.c`
 * walks the two column sets with a plain double sum and no BLAS, so the
 * 200-row values pin bit for bit. Note that fixture 6a's `cor` differs from
 * fixture 5a's in the last bit: R reaches the two-matrix case by another
 * path, and takes each spread from its own sum of squares rather than from
 * the diagonal of the covariance matrix.
 *
 * The 5-row fixture 6d is compared at 1e-15 relative instead. The build the
 * fixtures come from runs a column of 200 as an unrolled loop of plain
 * multiply-adds and a column of 5 as the scalar tail of that loop, where the
 * compiler contracts the multiply and the add into one instruction. So R's
 * own arithmetic changes with the length of the column, and one entry of 6d
 * lands a unit in the last place from the plain sum the port takes at every
 * length. The port does not reproduce an unrolling factor.
 */

import { describe, expect, test } from "bun:test";
import { moderationData } from "../../data/moderationData";
import { cor, cov, variance } from "./cov";
import { fromFrame, fromRows, matrix, type Matrix } from "./matrix";

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

describe("cov() and cor() of two matrices — fixture 6a and 6d", () => {
  const xz = fromFrame(moderationData, ["x", "z"]);
  const yw = fromFrame(moderationData, ["y", "w"]);

  // Fixture 6d: E1 is 5 x 2 and E2 is 5 x 3, both with exact binary entries,
  // so the sums leave no doubt that a mismatch is the port's and not R's.
  const e1 = matrix(
    [0.5, -1.25, 2, 0.75, -0.5, 1.5, 0.25, -2, 3.25, 0.5],
    { nrow: 5, dimnames: [null, ["e1", "e2"]] },
  );
  const e2 = matrix(
    [
      -0.25, 1, 0.5, -1.5, 2.25, 4, -0.75, 1.25, 0.5, -2, 0.125, 0.375, -0.625,
      1.75, 0.25,
    ],
    { nrow: 5, dimnames: [null, ["f1", "f2", "f3"]] },
  );

  test("cov(md[, c('x', 'z')], md[, c('y', 'w')]) pins bit for bit", () => {
    const c = cov(xz, yw) as Matrix;
    expect([c.nrow, c.ncol]).toEqual([2, 2]);
    expect(columnMajor(c)).toEqual([
      1.7335018707346275, 2.2355214934949488, -0.22101689324441653,
      0.021106295244526552,
    ]);
  });

  test("cor(md[, c('x', 'z')], md[, c('y', 'w')]) pins bit for bit", () => {
    const c = cor(xz, yw) as Matrix;
    expect([c.nrow, c.ncol]).toEqual([2, 2]);
    expect(columnMajor(c)).toEqual([
      0.24543617025382, 0.32570614137934578, -0.061023820407620728,
      0.0059967891495133268,
    ]);
  });

  test("the column names of x are the row names and those of y the columns", () => {
    expect((cov(xz, yw) as Matrix).dimnames).toEqual([
      ["x", "z"],
      ["y", "w"],
    ]);
    expect((cor(xz, yw) as Matrix).dimnames).toEqual([
      ["x", "z"],
      ["y", "w"],
    ]);
  });

  test("cov(E1, E2) is R's, at 1e-15 relative", () => {
    const c = cov(e1, e2) as Matrix;
    expect([c.nrow, c.ncol]).toEqual([2, 3]);
    expect(c.dimnames).toEqual([
      ["e1", "e2"],
      ["f1", "f2", "f3"],
    ]);
    relativelyClose(
      columnMajor(c),
      [
        -0.80624999999999991, -1.5687499999999999, 1.4781249999999999,
        0.45937500000000003, -0.2578125, 1.5078125,
      ],
      1e-15,
    );
  });

  test("cor(E1, E2) is R's, at 1e-15 relative", () => {
    const c = cor(e1, e2) as Matrix;
    expect([c.nrow, c.ncol]).toEqual([2, 3]);
    expect(c.dimnames).toEqual([
      ["e1", "e2"],
      ["f1", "f2", "f3"],
    ]);
    relativelyClose(
      columnMajor(c),
      [
        -0.46394774147859702, -0.58557496630064121, 0.52454499900825757,
        0.10574707679547524, -0.24085666415042847, 0.91375856805993882,
      ],
      1e-15,
    );
  });
});

describe("cov() and cor() of a vector against a matrix — fixture 6b", () => {
  const yw = fromFrame(moderationData, ["y", "w"]);

  test("a vector on the left gives one row, with no row name", () => {
    const c = cor(moderationData.x, yw) as Matrix;
    expect([c.nrow, c.ncol]).toEqual([1, 2]);
    expect(c.dimnames).toEqual([null, ["y", "w"]]);
    expect(columnMajor(c)).toEqual([0.24543617025382, -0.061023820407620728]);
  });

  test("a vector on the right gives one column, with no column name", () => {
    const c = cor(yw, moderationData.x) as Matrix;
    expect([c.nrow, c.ncol]).toEqual([2, 1]);
    expect(c.dimnames).toEqual([["y", "w"], null]);
    expect(columnMajor(c)).toEqual([0.24543617025382, -0.061023820407620728]);
  });

  test("cov takes the vector as one column too", () => {
    const c = cov(moderationData.x, yw) as Matrix;
    expect([c.nrow, c.ncol]).toEqual([1, 2]);
    expect(c.dimnames).toEqual([null, ["y", "w"]]);
    expect(columnMajor(c)).toEqual([
      1.7335018707346275, -0.22101689324441653,
    ]);
  });
});

describe("cov() and cor() of two matrices, edge cases — fixture 6c", () => {
  test("row counts that differ are refused in R's words", () => {
    const a = matrix([1, 2, 3, 4, 5, 6], { nrow: 3 });
    const b = matrix([1, 2, 3, 4], { nrow: 2 });
    expect(() => cor(a, b)).toThrow(RangeError);
    expect(() => cor(a, b)).toThrow("incompatible dimensions");
    expect(() => cov(a, b)).toThrow("incompatible dimensions");
  });

  test("a constant column gives NaN in its row, where R gives NA", () => {
    const x = matrix([1, 1, 1, 1, 2, 3], {
      nrow: 3,
      dimnames: [null, ["a", "b"]],
    });
    const y = matrix([1, 2, 3, 3, 2, 1], {
      nrow: 3,
      dimnames: [null, ["c", "d"]],
    });
    const c = cor(x, y) as Matrix;
    expect(c.dimnames).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(columnMajor(c)).toEqual([Number.NaN, 1, Number.NaN, -1]);
  });
});

describe("cor() of two arguments — the fma option", () => {
  const md = fromFrame(moderationData);
  const xz = fromFrame(moderationData, ["x", "z"]);
  const yw = fromFrame(moderationData, ["y", "w"]);

  test("plain arithmetic agrees with the default at 1e-14 relative", () => {
    relativelyClose(columnMajor(cor(xz, yw, { fma: false })), columnMajor(cor(xz, yw)), 1e-14);
    relativelyClose(
      columnMajor(cor(moderationData.x, yw, { fma: false })),
      columnMajor(cor(moderationData.x, yw)),
      1e-14,
    );
    relativelyClose(
      [cor(moderationData.x, moderationData.z, { fma: false })],
      [cor(moderationData.x, moderationData.z)],
      1e-14,
    );
    expect(cor(xz, yw, { fma: true })).toEqual(cor(xz, yw));
    expect(cor(md).dimnames).toEqual(cor(xz, yw, { fma: false }).dimnames === null ? null : cor(md).dimnames);
  });

  test("refuses an fma that is not true or false", () => {
    const bad = { fma: 1 } as unknown as { fma?: boolean };
    expect(() => cor(xz, yw, bad)).toThrow(TypeError);
    expect(() => cor(moderationData.x, moderationData.z, bad)).toThrow(TypeError);
  });
});
