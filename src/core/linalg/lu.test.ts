/**
 * Tests for the LU factorization and what R reads off it: `solve()`,
 * `det()`, `determinant()`, `rcond()` and `norm()`.
 *
 * Expected values come from R 4.5.3 with LAPACK 3.12.1,
 * `../compstatslib/conformance-fixtures/linalg.R` section 3, captured in
 * `.claude/plans/003-PLAN-linalg/linalg-fixtures.md`. The compact
 * factorization, the pivots, the determinant and the solves pin exactly:
 * they follow `dgetrf`, `dgetrs` and R's `det_ge_real` step for step, with
 * the contracted arithmetic of the reference BLAS the fixtures come from.
 * `rcond` is compared at a tolerance, because R's is `dgecon`'s estimate
 * and the port's is the exact one-norm ratio (plan Q1; see `rcond` below).
 * R prints `ipiv` 1-based; the port stores it 0-based.
 */

import { describe, expect, test } from "bun:test";
import { determinant as determinant2, invertMatrix } from "../matrix";
import { matrix, type Matrix } from "./matrix";
import { matmul } from "./ops";
import { det, determinant, lu, matrixNorm, rcond, solve } from "./lu";

function columnMajor(m: Matrix): number[] {
  return Array.from(m.data);
}

function closeTo(actual: readonly number[], expected: readonly number[], tolerance = 1e-12): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    expect(Math.abs(value - (expected[index] as number))).toBeLessThanOrEqual(tolerance);
  });
}

const S = matrix([2, 1, -1, 1, 3, 2, 1, -1, 4], { nrow: 3 });
const P = matrix([0, 1, 2, 3, 1, 0, 1, 4, 2], { nrow: 3 });
const M4 = matrix(
  [1.3, -0.7, 0.4, 1.9, 2.2, 0.5, -1.1, 0.8, -0.3, 1.6, 2.4, -0.9, 0.7, -1.2, 0.6, 1.5],
  { nrow: 4 },
);
const X = matrix([1, 2, 3, 4], {
  nrow: 2,
  dimnames: [
    ["r1", "r2"],
    ["a", "b"],
  ],
});

describe("lu() — fixture 3a, no interchange", () => {
  const f = lu(S);

  test("compact factorization and pivots pin exactly", () => {
    expect(columnMajor(f.lu)).toEqual([2, 0.5, -0.5, 1, 2.5, 1, 1, -1.5, 6]);
    expect(f.pivots).toEqual([0, 1, 2]);
    expect(f.zeroPivot).toBeNull();
  });

  test("does not modify its input", () => {
    expect(columnMajor(S)).toEqual([2, 1, -1, 1, 3, 2, 1, -1, 4]);
  });
});

describe("solve(), det(), rcond() — fixture 3a", () => {
  test("det() is R's det(), through the logarithms", () => {
    expect(det(S)).toBe(30.000000000000004);
    expect(determinant(S)).toEqual({ modulus: 3.4011973816621555, sign: 1 });
  });

  test("solve(A) is the inverse", () => {
    expect(columnMajor(solve(S))).toEqual([
      0.46666666666666667, -0.10000000000000001, 0.16666666666666666,
      -0.066666666666666666, 0.29999999999999999, -0.16666666666666666,
      -0.13333333333333333, 0.10000000000000001, 0.16666666666666666,
    ]);
  });

  test("solve(A, b) with a vector", () => {
    expect(solve(S, [1, 2, 3])).toEqual([
      -0.066666666666666652, 0.80000000000000004, 0.33333333333333331,
    ]);
  });

  test("solve(A, B) with a matrix", () => {
    const B = matrix([1, 0, 0, 2, 1, 1], { nrow: 3 });
    const s = solve(S, B);
    expect([s.nrow, s.ncol]).toEqual([3, 2]);
    expect(columnMajor(s)).toEqual([
      0.46666666666666667, -0.10000000000000001, 0.16666666666666666,
      0.73333333333333339, 0.20000000000000001, 0.33333333333333331,
    ]);
  });

  test("matrixNorm(A, \"O\") and rcond()", () => {
    expect(matrixNorm(S, "O")).toBe(6);
    expect(matrixNorm(S, "I")).toBe(7);
    expect(matrixNorm(S, "M")).toBe(4);
    expect(matrixNorm(S, "F")).toBe(Math.sqrt(38));
    expect(Math.abs(rcond(S) - 0.22727272727272729)).toBeLessThanOrEqual(1e-15);
  });
});

describe("lu() — fixture 3b, a zero leading entry forces an interchange", () => {
  const f = lu(P);

  test("factorization", () => {
    expect(columnMajor(f.lu)).toEqual([
      2, 0, 0.5, 0, 3, 0.33333333333333331, 2, 1, 2.6666666666666665,
    ]);
    expect(f.pivots).toEqual([2, 2, 2]);
  });

  test("det, solve, rcond", () => {
    expect(det(P)).toBe(15.999999999999998);
    expect(columnMajor(solve(P))).toEqual([
      0.125, 0.375, -0.125, -0.375, -0.125, 0.375, 0.6875, 0.0625, -0.1875,
    ]);
    expect(solve(P, [1, 2, 3])).toEqual([1.4375, 0.3125, 0.062500000000000014]);
    // R's dgecon estimate is 0.15238095238095237; the exact ratio R also
    // prints is 0.15238095238095239. The port computes the exact one.
    expect(rcond(P)).toBe(0.15238095238095239);
  });
});

describe("lu() — fixture 3c, a 4 x 4 with non-integer entries", () => {
  const f = lu(M4);

  test("factorization pins exactly", () => {
    expect(columnMajor(f.lu)).toEqual([
      1.8999999999999999, 0.68421052631578949, 0.21052631578947367,
      -0.36842105263157893, 0.80000000000000004, 1.6526315789473685,
      -0.76751592356687903, 0.48089171974522293, -0.90000000000000002,
      0.31578947368421056, 2.8318471337579618, 0.3942869995501575, 1.5,
      -0.32631578947368428, 0.033757961783439414, -0.50375618533513267,
    ]);
    expect(f.pivots).toEqual([3, 3, 2, 3]);
  });

  test("det, determinant, solve", () => {
    expect(det(M4)).toBe(-4.4793999999999992);
    expect(determinant(M4)).toEqual({ modulus: 1.499489108886233, sign: -1 });
    expect(columnMajor(solve(M4))).toEqual([
      -1.472072152520427, 0.86395499397240705, 0.25248917265705234,
      1.5553422333348219, 1.7453230343349555, -0.39648167165245352,
      0.023663883555833317, -1.9850872884761352, -0.49247667098272102,
      0.088851185426619683, 0.34379604411305087, 0.78269411081841334,
      2.2802161003705859, -0.75590480867973409, -0.23641559137384477,
      -1.960307183997857,
    ]);
    expect(solve(M4, [1, -1, 0.5, 2])).toEqual([
      1.0967986783944277, -0.20694735902129749, -0.072107871589945083,
      0.011162209224449719,
    ]);
    expect(Math.abs(rcond(M4) - 0.036750131268049352)).toBeLessThanOrEqual(1e-15);
  });

  test("A %*% solve(A) is the identity to rounding", () => {
    const product = columnMajor(matmul(M4, solve(M4)));
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    closeTo(product, identity, 1e-14);
  });
});

describe("solve() — fixture 3d, dimnames travel as R's do", () => {
  test("the inverse swaps the names", () => {
    const inv = solve(X);
    expect(columnMajor(inv)).toEqual([-2, 1, 1.5, -0.5]);
    expect(inv.dimnames).toEqual([
      ["a", "b"],
      ["r1", "r2"],
    ]);
  });

  test("a matrix right-hand side takes the column names of A as rows", () => {
    const B = matrix([1, 0, 0, 1], { nrow: 2, dimnames: [null, ["p", "q"]] });
    const s = solve(X, B);
    expect(columnMajor(s)).toEqual([-2, 1, 1.5, -0.5]);
    expect(s.dimnames).toEqual([
      ["a", "b"],
      ["p", "q"],
    ]);
  });

  test("a vector right-hand side is a plain array", () => {
    expect(solve(X, [1, 2])).toEqual([1, 0]);
  });

  test("the factorization of X", () => {
    const f = lu(X);
    expect(columnMajor(f.lu)).toEqual([2, 0.5, 4, 1]);
    expect(f.pivots).toEqual([1, 1]);
    expect(det(X)).toBe(-2);
    expect(rcond(X)).toBe(0.047619047619047616);
  });
});

describe("lu() — fixture 3e, 1 x 1", () => {
  test("everything is the scalar", () => {
    const one = matrix([4], { nrow: 1 });
    expect(columnMajor(lu(one).lu)).toEqual([4]);
    expect(lu(one).pivots).toEqual([0]);
    expect(det(one)).toBe(4);
    expect(columnMajor(solve(one))).toEqual([0.25]);
    expect(solve(one, [2])).toEqual([0.5]);
    expect(rcond(one)).toBe(1);
  });
});

describe("singular matrices", () => {
  test("3f — a duplicated column is computationally, not exactly, singular in doubles", () => {
    const Z = matrix([1, 2, 3, 2, 4, 6, 1, 0, 1], { nrow: 3 });
    const f = lu(Z);
    expect(columnMajor(f.lu)).toEqual([
      3, 0.66666666666666663, 0.33333333333333331, 6, 2.2204460492503131e-16,
      0.5, 1, -0.66666666666666663, 1,
    ]);
    expect(f.pivots).toEqual([2, 1, 2]);
    expect(f.zeroPivot).toBeNull();
    expect(det(Z)).toBe(-6.6613381477509402e-16);
    expect(() => solve(Z)).toThrow(
      /system is computationally singular: reciprocal condition number = 9\.25186e-18/,
    );
  });

  test("3g — 1:9 is exactly singular: U[3,3] = 0", () => {
    const Z2 = matrix([1, 2, 3, 4, 5, 6, 7, 8, 9], { nrow: 3 });
    const f = lu(Z2);
    expect(columnMajor(f.lu)).toEqual([
      3, 0.33333333333333331, 0.66666666666666663, 6, 2, 0.50000000000000011, 9, 4, 0,
    ]);
    expect(f.pivots).toEqual([2, 2, 2]);
    expect(f.zeroPivot).toBe(2);
    expect(det(Z2)).toBe(0);
    expect(determinant(Z2)).toEqual({ modulus: Number.NEGATIVE_INFINITY, sign: 1 });
    expect(() => solve(Z2)).toThrow(
      /Lapack routine dgesv: system is exactly singular: U\[3,3\] = 0/,
    );
    expect(rcond(Z2)).toBe(0);
  });

  test("3h — near singular", () => {
    const N = matrix([1, 1, 1, 1, 1, 1 + 1e-15, 1, 1 + 1e-15, 1], { nrow: 3 });
    const f = lu(N);
    expect(columnMajor(f.lu)).toEqual([
      1, 1, 1, 1, 1.1102230246251565e-15, 0, 1, 0, 1.1102230246251565e-15,
    ]);
    expect(f.pivots).toEqual([0, 2, 2]);
    expect(det(N)).toBe(-1.2325951644078266e-30);
    expect(() => solve(N)).toThrow(
      /system is computationally singular: reciprocal condition number = 9\.25186e-17/,
    );
  });

  test("a caller can raise or drop the bar with the tolerance option", () => {
    const N = matrix([1, 1, 1, 1, 1, 1 + 1e-15, 1, 1 + 1e-15, 1], { nrow: 3 });
    expect(() => solve(N, undefined, { tolerance: 0 })).not.toThrow();
    expect(() => solve(S, undefined, { tolerance: 0.5 })).toThrow(/computationally singular/);
  });
});

describe("agreement with the 2 x 2 module — fixtures 3i, 3j and matrix.test.ts", () => {
  test("F1: det and inverse match R and the 2 x 2 path bit for bit", () => {
    const F1 = matrix([1, 2, 2, 1], { nrow: 2 });
    expect(det(F1)).toBe(-2.9999999999999996);
    expect(det(F1)).toBe(determinant2({ x1: 1, y1: 2, x2: 2, y2: 1 }));
    expect(columnMajor(solve(F1))).toEqual([
      -0.33333333333333331, 0.66666666666666663, 0.66666666666666663,
      -0.33333333333333331,
    ]);
    expect(rcond(F1)).toBe(0.33333333333333331);
  });

  test("F4a: computationally singular on both paths", () => {
    const F4a = matrix([-2, -1.6, -1.5, -1.2], { nrow: 2 });
    expect(columnMajor(lu(F4a).lu)).toEqual([
      -2, 0.80000000000000004, -1.5, 1.1102230246251565e-16,
    ]);
    expect(det(F4a)).toBe(-2.2204460492503185e-16);
    expect(() => solve(F4a)).toThrow(/reciprocal condition number = 1\.76226e-17/);
    expect(invertMatrix({ x1: -2, y1: -1.6, x2: -1.5, y2: -1.2 }).singularity).toBe(
      "computational",
    );
  });

  test("every 2 x 2 fixture of the interactive demo agrees on det, inverse and rcond", () => {
    const fixtures: [number, number, number, number][] = [
      [1, 2, 2, 1],
      [1.3, -0.7, 0.4, 1.9],
      [-1.5, 0.8, 0.6, 1.3],
      [2, 1.9, 1.9, 1.8],
      [1, 0, 0, 1],
      [0, 1, 1, 0],
    ];
    fixtures.forEach(([x1, y1, x2, y2]) => {
      const general = matrix([x1, y1, x2, y2], { nrow: 2 });
      const small = invertMatrix({ x1, y1, x2, y2 });
      expect(det(general)).toBe(small.determinant);
      expect(small.inverse).not.toBeNull();
      const inverse = small.inverse as { x1: number; y1: number; x2: number; y2: number };
      expect(columnMajor(solve(general))).toEqual([
        inverse.x1, inverse.y1, inverse.x2, inverse.y2,
      ]);
      expect(rcond(general)).toBe(small.rcond);
    });
  });

  test("F4a' (-2, -1.6, 1.5, 1.2) is singular on both paths", () => {
    const general = matrix([-2, -1.6, 1.5, 1.2], { nrow: 2 });
    const small = invertMatrix({ x1: -2, y1: -1.6, x2: 1.5, y2: 1.2 });
    expect(small.inverse).toBeNull();
    expect(det(general)).toBe(small.determinant);
    expect(() => solve(general)).toThrow(/singular/);
  });
});

describe("refusals — fixture 3k", () => {
  test("a non-square matrix, with R's wording", () => {
    const wide = matrix([1, 2, 3, 4, 5, 6], { nrow: 2 });
    expect(() => solve(wide)).toThrow(/'a' \(2 x 3\) must be square/);
    expect(() => det(wide)).toThrow(/'x' must be a square matrix/);
    expect(() => lu(wide)).toThrow(RangeError);
  });

  test("a right-hand side of the wrong length", () => {
    expect(() => solve(S, [1, 2])).toThrow(
      /'b' \(2 x 1\) must be compatible with 'a' \(3 x 3\)/,
    );
    expect(() => solve(S, matrix([1, 2, 3, 4], { nrow: 2 }))).toThrow(
      /'b' \(2 x 2\) must be compatible with 'a' \(3 x 3\)/,
    );
  });

  test("a tolerance that is not a non-negative number", () => {
    expect(() => solve(S, undefined, { tolerance: -1 })).toThrow(RangeError);
    expect(() => solve(S, undefined, { tolerance: Number.NaN })).toThrow(RangeError);
  });
});
