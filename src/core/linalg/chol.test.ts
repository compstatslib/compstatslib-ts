/**
 * Tests for `chol()` and `chol2inv()`, R's Cholesky factorization of a
 * symmetric positive definite matrix and the inverse read off that factor.
 *
 * Expected values come from R 4.5.3 with LAPACK 3.12.1,
 * `../compstatslib/conformance-fixtures/linalg.R` section 7, captured in
 * `.claude/plans/004-PLAN-seminr-utilities/linalg-fixtures.md`. R's
 * `chol()` is LAPACK `dpotrf`, and below the block size that is the
 * recursive `dpotrf2`, whose products run through the contracted
 * arithmetic of the reference BLAS the fixtures come from. The factor is
 * therefore pinned bit for bit on the default `fma` path. `chol2inv()` is
 * `dpotri`, which R reaches through two more triangular passes, so it is
 * compared at 1e-14 relative.
 *
 * The 4 x 4 input of fixture 7b is `cor(moderation_data)`. The port's
 * `cor()` returns R's doubles bit for bit on that frame, so the test builds
 * the input with `cor(fromFrame(moderationData))` rather than restating it.
 */

import { describe, expect, test } from "bun:test";
import { moderationData } from "../../data/moderationData";
import { chol, chol2inv } from "./chol";
import { cor } from "./cov";
import { fromFrame, matrix, type Matrix } from "./matrix";
import { crossprod } from "./ops";

function columnMajor(m: Matrix): number[] {
  return Array.from(m.data);
}

/** R's doubles at a relative bar: |a − b| ≤ tolerance · max(1, |b|). */
function relativelyClose(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-14,
): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    const target = expected[index] as number;
    expect(Math.abs(value - target)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(target)));
  });
}

/** The bar the `fma` option promises, with the default path as reference. */
function agreesWithDefault(actual: readonly number[], expected: readonly number[]): void {
  relativelyClose(actual, expected, 1e-14);
}

/** Fixture 7a: the 3 x 3 symmetric positive definite matrix S3. */
const S3 = matrix([4, 2, 2, 2, 5, 3, 2, 3, 6], { nrow: 3 });

/** Fixture 7c: the 2 x 2 D2, carrying dimnames on both margins. */
const D2 = matrix([4, 2, 2, 3], {
  nrow: 2,
  dimnames: [
    ["p", "q"],
    ["p", "q"],
  ],
});

describe("chol() — fixture 7a, the 3 x 3", () => {
  test("the upper factor pins bit for bit", () => {
    expect(columnMajor(chol(S3))).toEqual([2, 0, 0, 1, 2, 0, 1, 1, 2]);
  });

  test("t(U) %*% U recovers the input, as R's max difference of 0 does", () => {
    expect(columnMajor(crossprod(chol(S3)))).toEqual(columnMajor(S3));
  });

  test("does not modify its input", () => {
    chol(S3);
    expect(columnMajor(S3)).toEqual([4, 2, 2, 2, 5, 3, 2, 3, 6]);
  });

  test("no dimnames on the input means none on the factor", () => {
    expect(chol(S3).dimnames).toBeNull();
  });
});

describe("chol2inv() — fixture 7a", () => {
  test("the inverse agrees with R at 1e-14 relative", () => {
    relativelyClose(columnMajor(chol2inv(chol(S3))), [
      0.328125, -0.09375, -0.0625, -0.09375, 0.3125, -0.125, -0.0625, -0.125, 0.25,
    ]);
  });

  test("the result carries no dimnames", () => {
    expect(chol2inv(chol(S3)).dimnames).toBeNull();
  });
});

describe("chol() — fixture 7b, cor(moderation_data)", () => {
  const A = cor(fromFrame(moderationData));

  test("the input is R's correlation matrix, bit for bit", () => {
    expect(columnMajor(A)).toEqual([
      1, 0.24543617025382, 0.32570614137934573, -0.027714915442874466, 0.24543617025382, 1,
      -0.080365386778947223, -0.061023820407620728, 0.32570614137934573, -0.080365386778947223, 1,
      0.005996789149513326, -0.027714915442874466, -0.061023820407620728, 0.005996789149513326, 1,
    ]);
  });

  test("the upper factor pins bit for bit", () => {
    expect(columnMajor(chol(A))).toEqual([
      1, 0, 0, 0, 0.24543617025382, 0.96941275333633703, 0, 0, 0.32570614137934573,
      -0.16536346792997597, 0.93089764901515859, 0, -0.027714915442874466, -0.05593239568574257,
      0.0062031872171445998, 0.99803054614735964,
    ]);
  });

  test("t(U) %*% U recovers the input to R's own 1.11e-16", () => {
    columnMajor(crossprod(chol(A))).forEach((value, index) => {
      expect(Math.abs(value - (columnMajor(A)[index] as number))).toBeLessThanOrEqual(
        1.1102230246251565e-16,
      );
    });
  });

  test("chol() keeps both dimnames", () => {
    expect(chol(A).dimnames).toEqual([
      ["y", "x", "z", "w"],
      ["y", "x", "z", "w"],
    ]);
  });

  test("chol2inv() agrees with R at 1e-14 relative and drops the dimnames", () => {
    const inverse = chol2inv(chol(A));
    relativelyClose(columnMajor(inverse), [
      1.2202706443306675, -0.33261527670045093, -0.42427674602279775, 0.016066541001787331,
      -0.33261527670045093, 1.1008902024387281, 0.19646778390767775, 0.056783945858602358,
      -0.42427674602279775, 0.19646778390767775, 1.1540188697101579, -0.0066899872155459089,
      0.016066541001787331, 0.056783945858602358, -0.0066899872155459089, 1.0039505745821797,
    ]);
    expect(inverse.dimnames).toBeNull();
  });
});

describe("chol() — fixture 7c, dimnames on a 2 x 2", () => {
  test("the factor pins and keeps the names", () => {
    const U = chol(D2);
    expect(columnMajor(U)).toEqual([2, 0, 1, 1.4142135623730951]);
    expect(U.dimnames).toEqual([
      ["p", "q"],
      ["p", "q"],
    ]);
  });

  test("chol2inv() agrees with R and has no names", () => {
    const inverse = chol2inv(chol(D2));
    relativelyClose(columnMajor(inverse), [
      0.375, -0.24999999999999994, -0.24999999999999994, 0.49999999999999989,
    ]);
    expect(inverse.dimnames).toBeNull();
  });
});

describe("chol() — fixture 7d, only the upper triangle is read", () => {
  test("a lower entry of 99 never reaches the factorization", () => {
    const asymmetric = matrix([4, 99, 2, 3], { nrow: 2 });
    const symmetric = matrix([4, 2, 2, 3], { nrow: 2 });
    expect(columnMajor(chol(asymmetric))).toEqual([2, 0, 1, 1.4142135623730951]);
    expect(columnMajor(chol(asymmetric))).toEqual(columnMajor(chol(symmetric)));
  });
});

describe("chol() — fixture 7e, the 1 x 1 case", () => {
  const one = matrix([9], { nrow: 1 });

  test("the factor is the square root", () => {
    expect(columnMajor(chol(one))).toEqual([3]);
  });

  test("chol2inv() is the reciprocal", () => {
    relativelyClose(columnMajor(chol2inv(chol(one))), [0.1111111111111111]);
  });
});

describe("chol() — fixture 7f, the errors in R's words", () => {
  test("a matrix that is not positive definite names the leading minor", () => {
    expect(() => chol(matrix([1, 2, 2, 1], { nrow: 2 }))).toThrow(
      new RangeError("the leading minor of order 2 is not positive"),
    );
  });

  test("a non-square input is refused", () => {
    expect(() => chol(matrix([1, 2, 3, 4, 5, 6], { nrow: 3 }))).toThrow(
      new RangeError("'a' must be a square matrix"),
    );
  });

  test("a NaN on the diagonal is a leading minor of order 1", () => {
    expect(() => chol(matrix([Number.NaN, 1, 1, 2], { nrow: 2 }))).toThrow(
      new RangeError("the leading minor of order 1 is not positive"),
    );
  });
});

describe("chol2inv() — fixture 7f, the shape rules", () => {
  /**
   * R's `chol2inv()` takes a `size` argument that defaults to the column
   * count, so R inverts the leading square block of a tall matrix and only
   * refuses a wide one. The port takes no `size` and refuses both shapes.
   * This is a stated narrowing, recorded in plan 004 Slice 2.
   */
  test("a tall matrix is refused, where R reads its leading square block", () => {
    expect(() => chol2inv(matrix([1, 2, 3, 4, 5, 6], { nrow: 3 }))).toThrow(
      new RangeError("'x' must be a square matrix"),
    );
  });

  test("a wide matrix is refused, as R refuses it", () => {
    expect(() => chol2inv(matrix([1, 2, 3, 4, 5, 6], { nrow: 2 }))).toThrow(
      new RangeError("'x' must be a square matrix"),
    );
  });

  test("a NaN entry passes through, as R's NA does", () => {
    const values = columnMajor(chol2inv(matrix([Number.NaN, 1, 1, 2], { nrow: 2 })));
    expect(values.slice(0, 3).every(Number.isNaN)).toBe(true);
    expect(values[3]).toBe(0.25);
  });
});

/**
 * The `fma` option, plan 004 Slice 0. The default rounds every product
 * through the software fused multiply-add, which is what pins the factors
 * above. `{ fma: false }` takes plain `a * b + c` for throughput. The two
 * paths differ by a few ulps, so the tests here compare the paths to each
 * other and never restate R's doubles.
 */
describe("chol() and chol2inv() — the fma option", () => {
  test("fixture 7a — the plain path agrees at 1e-14", () => {
    agreesWithDefault(columnMajor(chol(S3, { fma: false })), columnMajor(chol(S3)));
    agreesWithDefault(
      columnMajor(chol2inv(chol(S3), { fma: false })),
      columnMajor(chol2inv(chol(S3))),
    );
  });

  test("fixture 7b — the correlation matrix agrees at 1e-14", () => {
    const A = cor(fromFrame(moderationData));
    agreesWithDefault(columnMajor(chol(A, { fma: false })), columnMajor(chol(A)));
    agreesWithDefault(
      columnMajor(chol2inv(chol(A), { fma: false })),
      columnMajor(chol2inv(chol(A))),
    );
  });

  test("an fma that is not a boolean is refused with a TypeError", () => {
    expect(() => chol(S3, { fma: 1 } as never)).toThrow(TypeError);
    expect(() => chol2inv(chol(S3), { fma: "yes" } as never)).toThrow(TypeError);
  });
});
