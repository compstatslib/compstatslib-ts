/**
 * Tests for `eigenSymmetric()`, R's `eigen(x, symmetric = TRUE)`.
 *
 * Expected values come from R 4.5.3, `../compstatslib/conformance-fixtures/linalg.R`
 * section 5b, captured in `.claude/plans/003-PLAN-linalg/linalg-fixtures.md`.
 * R goes through LAPACK's `dsyevr`; the port uses Jacobi rotations. The two
 * agree on the eigenvalues to a relative `1e-12` (plan Q1) and on the
 * eigenvectors up to sign, which LAPACK leaves arbitrary. The port's own
 * sign rule is tested on its own.
 */

import { describe, expect, test } from "bun:test";
import { moderationData } from "../../data/moderationData";
import { cov } from "./cov";
import { eigenSymmetric } from "./eigen";
import { column, fromFrame, matrix, type Matrix } from "./matrix";
import { matmul } from "./ops";
import { dot, mul, norm, sub } from "./vector";

function relativelyClose(actual: readonly number[], expected: readonly number[], tolerance = 1e-12): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    const target = expected[index] as number;
    expect(Math.abs(value - target)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(target)));
  });
}

/** Compare a vector with R's up to sign. */
function sameLine(actual: readonly number[], expected: readonly number[], tolerance = 1e-12): void {
  const flipped = dot(actual, expected) < 0 ? mul(actual, -1) : actual;
  relativelyClose(flipped, expected, tolerance);
}

/** Every column of `v` satisfies S v = λ v, and the columns are orthonormal. */
function checkDecomposition(s: Matrix, values: readonly number[], vectors: Matrix, tolerance = 1e-12): void {
  const n = s.nrow;
  for (let k = 0; k < n; k++) {
    const v = column(vectors, k);
    const sv = Array.from(matmul(s, v).data);
    const lv = mul(v, values[k] as number);
    expect(norm(sub(sv, lv))).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(values[k] as number)));
    expect(Math.abs(norm(v) - 1)).toBeLessThanOrEqual(1e-14);
    for (let j = 0; j < k; j++) {
      expect(Math.abs(dot(v, column(vectors, j)))).toBeLessThanOrEqual(1e-14);
    }
  }
}

describe("eigenSymmetric() — fixture 5b", () => {
  test("the covariance of moderation_data", () => {
    const s = cov(fromFrame(moderationData));
    const e = eigenSymmetric(s);
    relativelyClose(e.values, [
      13.895801097174543, 4.0656976129560558, 3.3952796911929362,
      2.6132004865784557,
    ]);
    const expected = [
      [0.96541314116466648, 0.16018097115698443, 0.2047202755242819, -0.020227014980942412],
      [-0.014989371094772344, 0.77261998608353222, -0.56282601537117871, -0.29336078858611503],
      [-0.036676630256110974, -0.19428298724338022, 0.23084398778525711, -0.95269092520305088],
      [0.25769674117809793, -0.58279887993309998, -0.76682953680336519, -0.076878583629307842],
    ];
    expected.forEach((v, k) => sameLine(column(e.vectors, k), v));
    checkDecomposition(s, e.values, e.vectors);
  });

  test("[[2, 1], [1, 2]] has eigenvalues 3 and 1", () => {
    const e = eigenSymmetric(matrix([2, 1, 1, 2], { nrow: 2 }));
    relativelyClose(e.values, [3, 1]);
    sameLine(column(e.vectors, 0), [0.70710678118654746, 0.70710678118654746]);
    sameLine(column(e.vectors, 1), [-0.70710678118654746, 0.70710678118654746]);
  });

  test("a diagonal matrix comes back sorted, with unit vectors", () => {
    const e = eigenSymmetric(matrix([1, 0, 0, 0, 3, 0, 0, 0, 2], { nrow: 3 }));
    expect(e.values).toEqual([3, 2, 1]);
    sameLine(column(e.vectors, 0), [0, 1, 0]);
    sameLine(column(e.vectors, 1), [0, 0, 1]);
    sameLine(column(e.vectors, 2), [1, 0, 0]);
  });

  test("1 x 1", () => {
    const e = eigenSymmetric(matrix([5], { nrow: 1 }));
    expect(e.values).toEqual([5]);
    expect(Array.from(e.vectors.data)).toEqual([1]);
  });

  test("a rank-one matrix has one non-zero eigenvalue", () => {
    const s = matrix([1, 2, 3, 2, 4, 6, 3, 6, 9], { nrow: 3 });
    const e = eigenSymmetric(s);
    relativelyClose([e.values[0] as number], [14]);
    expect(Math.abs(e.values[1] as number)).toBeLessThanOrEqual(1e-13);
    expect(Math.abs(e.values[2] as number)).toBeLessThanOrEqual(1e-13);
    sameLine(column(e.vectors, 0), [-0.26726124191242429, -0.53452248382484879, -0.80178372573727308]);
    checkDecomposition(s, e.values, e.vectors, 1e-13);
  });

  test("a repeated eigenvalue keeps an orthonormal basis", () => {
    const e = eigenSymmetric(matrix([1, 0, 0, 1], { nrow: 2 }));
    expect(e.values).toEqual([1, 1]);
    checkDecomposition(matrix([1, 0, 0, 1], { nrow: 2 }), e.values, e.vectors);
  });

  test("the port's sign rule: the largest entry of each vector is positive", () => {
    const e = eigenSymmetric(cov(fromFrame(moderationData)));
    for (let k = 0; k < 4; k++) {
      const v = column(e.vectors, k);
      const largest = v.reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), 0);
      expect(largest).toBeGreaterThan(0);
    }
  });

  test("carries the row names of the input as the row names of the vectors", () => {
    const e = eigenSymmetric(cov(fromFrame(moderationData)));
    expect(e.vectors.dimnames).toEqual([["y", "x", "z", "w"], null]);
  });

  test("refuses a non-symmetric or non-square matrix, where R silently reads the lower triangle", () => {
    expect(() => eigenSymmetric(matrix([1, 2, 9, 1], { nrow: 2 }))).toThrow(/symmetric/);
    expect(() => eigenSymmetric(matrix([1, 2, 3, 4, 5, 6], { nrow: 2 }))).toThrow(RangeError);
  });

  test("does not modify its input", () => {
    const s = matrix([2, 1, 1, 2], { nrow: 2 });
    eigenSymmetric(s);
    expect(Array.from(s.data)).toEqual([2, 1, 1, 2]);
  });
});
