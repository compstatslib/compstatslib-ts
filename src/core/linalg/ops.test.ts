/**
 * Tests for the elementary matrix operations.
 *
 * Expected values come from R 4.5.3, `../compstatslib/conformance-fixtures/linalg.R`
 * section 1 (1a–1d, 1f), captured in
 * `.claude/plans/003-PLAN-linalg/linalg-fixtures.md`. The fixtures hold exact
 * binary fractions and the operations are fixed-order arithmetic, so every
 * numeric assertion is exact (plan Q1).
 */

import { describe, expect, test } from "bun:test";
import { matrix, type Matrix } from "./matrix";
import {
  cbind,
  crossprod,
  diag,
  identity,
  matmul,
  rbind,
  t,
  tcrossprod,
  transpose,
} from "./ops";

function columnMajor(m: Matrix): number[] {
  return Array.from(m.data);
}

/** The fixture matrices, exactly as `linalg.R` builds them. */
const A = matrix([1, 2, 3, 4, 5, 6], { nrow: 3 });
const B = matrix([0.5, -1, 2, 3, 1.5, 0, -2.5, 4], { nrow: 2 });
const X = matrix([1, 2, 3, 4], {
  nrow: 2,
  dimnames: [
    ["r1", "r2"],
    ["a", "b"],
  ],
});
const Y = matrix([1, 0, 2, -1, 0.5, 3], {
  nrow: 2,
  dimnames: [null, ["u", "v", "w"]],
});

describe("t()", () => {
  test("transposes — fixture 1a", () => {
    const at = t(A);
    expect([at.nrow, at.ncol]).toEqual([2, 3]);
    expect(columnMajor(at)).toEqual([1, 4, 2, 5, 3, 6]);
    expect(at.dimnames).toBeNull();
  });

  test("transpose() is the same function under a name that does not collide with i18n's t", () => {
    expect(transpose).toBe(t);
  });

  test("does not share its dimnames arrays with the input", () => {
    const names: [string[], string[]] = [["r1", "r2"], ["a", "b"]];
    const x = matrix([1, 2, 3, 4], { nrow: 2, dimnames: names });
    const xt = t(x);
    names[0][0] = "changed";
    expect(x.dimnames?.[0]?.[0]).toBe("r1");
    expect(xt.dimnames?.[1]?.[0]).toBe("r1");
  });

  test("swaps dimnames — fixture 1c", () => {
    expect(t(X).dimnames).toEqual([
      ["a", "b"],
      ["r1", "r2"],
    ]);
    expect(t(Y).dimnames).toEqual([["u", "v", "w"], null]);
  });
});

describe("matmul()", () => {
  test("A %*% B — fixture 1b", () => {
    const ab = matmul(A, B);
    expect([ab.nrow, ab.ncol]).toEqual([3, 4]);
    expect(columnMajor(ab)).toEqual([
      -3.5, -4, -4.5, 14, 19, 24, 1.5, 3, 4.5, 13.5, 15, 16.5,
    ]);
  });

  test("a vector on the right is a column — fixture 1b", () => {
    const av = matmul(A, [2, -0.5]);
    expect([av.nrow, av.ncol]).toEqual([3, 1]);
    expect(columnMajor(av)).toEqual([0, 1.5, 3]);
  });

  test("keeps the row names of the left and the column names of the right — fixture 1c", () => {
    const xy = matmul(X, Y);
    expect(columnMajor(xy)).toEqual([1, 2, -1, 0, 9.5, 13]);
    expect(xy.dimnames).toEqual([
      ["r1", "r2"],
      ["u", "v", "w"],
    ]);
    expect(matmul(A, B).dimnames).toBeNull();
  });

  test("refuses non-conformable arguments with R's wording — fixture 1f", () => {
    expect(() => matmul(A, A)).toThrow(/non-conformable arguments/);
    expect(() => matmul(A, [1, 2, 3])).toThrow(/non-conformable arguments/);
  });

  test("a vector on the left is a row when its length matches the rows — fixture 1g", () => {
    const cb = matmul([1, 2], B);
    expect([cb.nrow, cb.ncol]).toEqual([1, 4]);
    expect(columnMajor(cb)).toEqual([-1.5, 8, 1.5, 5.5]);
    expect(columnMajor(matmul([1, 2, 3], A))).toEqual([14, 32]);
  });

  test("a vector on the left is a column against a one-row matrix: the outer product — fixture 1g", () => {
    const outer = matmul([1, 2, 3], matrix([1, 2, 3, 4], { nrow: 1 }));
    expect([outer.nrow, outer.ncol]).toEqual([3, 4]);
    expect(columnMajor(outer)).toEqual([1, 2, 3, 2, 4, 6, 3, 6, 9, 4, 8, 12]);
  });

  test("a vector on the right is a row against a one-column matrix — fixture 1g", () => {
    const outer = matmul(matrix([1, 2, 3], { nrow: 3 }), [10, 20]);
    expect([outer.nrow, outer.ncol]).toEqual([3, 2]);
    expect(columnMajor(outer)).toEqual([10, 20, 30, 20, 40, 60]);
    expect(columnMajor(matmul(matrix([2], { nrow: 1 }), [1, 2, 3]))).toEqual([2, 4, 6]);
  });

  test("two vectors: the inner product, or a scalar times a row — fixture 1g", () => {
    const inner = matmul([1, 2, 3], [1, 2, 3]);
    expect([inner.nrow, inner.ncol]).toEqual([1, 1]);
    expect(columnMajor(inner)).toEqual([14]);
    expect(columnMajor(matmul([2], [1, 2, 3]))).toEqual([2, 4, 6]);
  });

  test("refuses the vector shapes R refuses — fixture 1g", () => {
    expect(() => matmul([1, 2], A)).toThrow(/non-conformable arguments/);
    expect(() => matmul([1, 2, 3], [1, 2])).toThrow(/non-conformable arguments/);
    expect(() => matmul([1, 2, 3], [2])).toThrow(/non-conformable arguments/);
  });

  test("refuses a typed array or a non-matrix object at runtime", () => {
    const typed = new Float64Array([1, 2]) as unknown as readonly number[];
    expect(() => matmul(A, typed)).toThrow(TypeError);
    expect(() => matmul({} as unknown as Matrix, A)).toThrow(TypeError);
  });
});

describe("crossprod() and tcrossprod()", () => {
  test("crossprod(A) is t(A) %*% A — fixture 1b", () => {
    const c = crossprod(A);
    expect([c.nrow, c.ncol]).toEqual([2, 2]);
    expect(columnMajor(c)).toEqual([14, 32, 32, 77]);
  });

  test("tcrossprod(A) is A %*% t(A) — fixture 1b", () => {
    const c = tcrossprod(A);
    expect([c.nrow, c.ncol]).toEqual([3, 3]);
    expect(columnMajor(c)).toEqual([17, 22, 27, 22, 29, 36, 27, 36, 45]);
  });

  test("crossprod(A, y) takes a vector as a column — fixture 1b", () => {
    const c = crossprod(A, [1.25, -0.5, 2]);
    expect([c.nrow, c.ncol]).toEqual([2, 1]);
    expect(columnMajor(c)).toEqual([6.25, 14.5]);
  });

  test("crossprod carries the column names of both factors — fixture 1g", () => {
    const c = crossprod(X, Y);
    expect(columnMajor(c)).toEqual([1, 3, 0, 2, 6.5, 13.5]);
    expect(c.dimnames).toEqual([
      ["a", "b"],
      ["u", "v", "w"],
    ]);
  });

  test("a bare vector is a column in crossprod — fixture 1g", () => {
    expect(columnMajor(crossprod([1, 2, 3]))).toEqual([14]);
    expect([crossprod([1, 2, 3]).nrow, crossprod([1, 2, 3]).ncol]).toEqual([1, 1]);
    expect(columnMajor(crossprod([1, 2, 3], A))).toEqual([14, 32]);
    expect(() => crossprod([1, 2], A)).toThrow(/non-conformable arguments/);
    expect(() => crossprod(A, [1, 2])).toThrow(/non-conformable arguments/);
  });

  test("R's vector rules on the shapes that tell them apart — fixture 1h", () => {
    const m = (values: number[], nrow: number): Matrix => matrix(values, { nrow });
    const shape = (r: Matrix): [number, number, number[]] => [r.nrow, r.ncol, columnMajor(r)];
    // tcrossprod, vector y: a row only when x has one row.
    expect(() => tcrossprod(m([2], 1), [1, 2, 3])).toThrow(/non-conformable/);
    expect(shape(tcrossprod(m([1, 2], 2), [1, 2]))).toEqual([2, 2, [1, 2, 2, 4]]);
    expect(shape(tcrossprod(m([1, 2], 1), [1, 2]))).toEqual([1, 1, [5]]);
    expect(() => tcrossprod(m([1, 2, 3, 4, 5, 6], 3), [1, 2])).toThrow(/non-conformable/);
    expect(() => tcrossprod(m([1, 2, 3, 4, 5, 6], 2), [1, 2, 3])).toThrow(/non-conformable/);
    // tcrossprod, vector x: a row when its length matches the columns of y.
    expect(shape(tcrossprod([1, 2], m([1, 2], 2)))).toEqual([2, 2, [1, 2, 2, 4]]);
    expect(shape(tcrossprod([1, 2], m([1, 2], 1)))).toEqual([1, 1, [5]]);
    expect(shape(tcrossprod([1, 2, 3], m([1, 2, 3, 4, 5, 6], 2)))).toEqual([1, 2, [22, 28]]);
    expect(() => tcrossprod([1, 2], m([1, 2, 3, 4, 5, 6], 2))).toThrow(/non-conformable/);
    // tcrossprod, two vectors: both columns.
    expect(shape(tcrossprod([1, 2, 3], [1, 2]))).toEqual([3, 2, [1, 2, 3, 2, 4, 6]]);
    expect(shape(tcrossprod([2], [1, 2, 3]))).toEqual([1, 3, [2, 4, 6]]);
    // crossprod, vector y: a column when its length matches the rows of x.
    expect(shape(crossprod(m([1, 2, 3], 1), [1, 2, 3]))).toEqual([3, 3, [1, 2, 3, 2, 4, 6, 3, 6, 9]]);
    expect(shape(crossprod(m([1, 2, 3, 4, 5, 6], 2), [1, 2]))).toEqual([3, 1, [5, 11, 17]]);
    // crossprod, vector x: always a column.
    expect(() => crossprod([1, 2, 3], m([1, 2, 3], 1))).toThrow(/non-conformable/);
    expect(shape(crossprod([1, 2], m([1, 2, 3, 4, 5, 6], 2)))).toEqual([1, 3, [5, 11, 17]]);
    expect(() => crossprod([1, 2, 3], [1, 2])).toThrow(/non-conformable/);
    expect(shape(crossprod([2], [1, 2, 3]))).toEqual([1, 3, [2, 4, 6]]);
  });

  test("a bare vector is a row in tcrossprod when that conforms, else a column — fixture 1g", () => {
    expect(columnMajor(tcrossprod([1, 2, 3]))).toEqual([1, 2, 3, 2, 4, 6, 3, 6, 9]);
    expect(columnMajor(tcrossprod(matrix([1, 2, 3], { nrow: 1 }), [1, 2, 3]))).toEqual([14]);
    expect(columnMajor(tcrossprod(matrix([1, 2, 3], { nrow: 3 }), [1, 2, 3]))).toEqual([
      1, 2, 3, 2, 4, 6, 3, 6, 9,
    ]);
    expect(columnMajor(tcrossprod([1, 2], A))).toEqual([9, 12, 15]);
    expect(() => tcrossprod(A, [1, 2])).toThrow(/non-conformable arguments/);
  });

  test("refuse non-conformable arguments — fixture 1f", () => {
    expect(() => crossprod(A, B)).toThrow(/non-conformable arguments/);
    expect(() => tcrossprod(A, B)).toThrow(/non-conformable arguments/);
  });
});

describe("cbind() and rbind()", () => {
  test("cbind(X, c(9, 8)): an unnamed column gets \"\" — fixture 1c", () => {
    const c = cbind(X, [9, 8]);
    expect([c.nrow, c.ncol]).toEqual([2, 3]);
    expect(columnMajor(c)).toEqual([1, 2, 3, 4, 9, 8]);
    expect(c.dimnames).toEqual([
      ["r1", "r2"],
      ["a", "b", ""],
    ]);
  });

  test("cbind(X, X) repeats names — fixture 1c", () => {
    const c = cbind(X, X);
    expect(columnMajor(c)).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
    expect(c.dimnames).toEqual([
      ["r1", "r2"],
      ["a", "b", "a", "b"],
    ]);
  });

  test("rbind(X, c(7, 6)) — fixture 1c", () => {
    const r = rbind(X, [7, 6]);
    expect([r.nrow, r.ncol]).toEqual([3, 2]);
    expect(columnMajor(r)).toEqual([1, 2, 7, 3, 4, 6]);
    expect(r.dimnames).toEqual([
      ["r1", "r2", ""],
      ["a", "b"],
    ]);
  });

  test("rbind of two unnamed matrices — fixture 1c", () => {
    const bt = t(matrix([0.5, -1, 2, 3, 1.5, 0], { nrow: 2 }));
    const r = rbind(A, bt);
    expect([r.nrow, r.ncol]).toEqual([6, 2]);
    expect(columnMajor(r)).toEqual([1, 2, 3, 0.5, 2, 1.5, 4, 5, 6, -1, 3, 0]);
    expect(r.dimnames).toBeNull();
  });

  test("cbind of two vectors has no names at all — fixture 1c", () => {
    const c = cbind([1, 2], [3, 4]);
    expect(columnMajor(c)).toEqual([1, 2, 3, 4]);
    expect(c.dimnames).toBeNull();
  });

  test("refuse mismatched extents with R's wording — fixture 1f", () => {
    expect(() =>
      cbind(matrix([1, 2, 3, 4], { nrow: 2 }), matrix([1, 2, 3, 4, 5, 6], { nrow: 3 })),
    ).toThrow(/number of rows of matrices must match \(see arg 2\)/);
    expect(() =>
      rbind(matrix([1, 2, 3, 4], { nrow: 2 }), matrix([1, 2, 3, 4, 5, 6], { nrow: 2 })),
    ).toThrow(/number of columns of matrices must match \(see arg 2\)/);
    // R warns and recycles a short vector; the port refuses, in R's own
    // words for a vector part — fixture 1g.
    expect(() => cbind(X, [9, 8, 7])).toThrow(
      /number of rows of result is not a multiple of vector length \(arg 2\)/,
    );
    expect(() => rbind(X, [7])).toThrow(
      /number of columns of result is not a multiple of vector length \(arg 2\)/,
    );
  });

  test("refuse an empty call", () => {
    expect(() => cbind()).toThrow(RangeError);
    expect(() => rbind()).toThrow(RangeError);
  });
});

describe("diag() and identity()", () => {
  test("diag(c(1, 2, 3)) builds a diagonal matrix — fixture 1d", () => {
    const d = diag([1, 2, 3]);
    expect([d.nrow, d.ncol]).toEqual([3, 3]);
    expect(columnMajor(d)).toEqual([1, 0, 0, 0, 2, 0, 0, 0, 3]);
  });

  test("identity(3) is diag(3) — fixture 1d", () => {
    expect(columnMajor(identity(3))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(columnMajor(diag(3))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  test("diag(A) reads the diagonal of a 3 x 2 — fixture 1d", () => {
    expect(diag(A)).toEqual([1, 5]);
    expect(diag(X)).toEqual([1, 4]);
  });

  test("refuses a non-integer or negative order", () => {
    expect([identity(0).nrow, identity(0).ncol]).toEqual([0, 0]);
    expect(() => identity(-1)).toThrow(RangeError);
    expect(() => identity(2.5)).toThrow(RangeError);
  });

  test("dispatches on type, not on length: diag([5]) is 1 x 1 and diag(2.5) refuses — fixture 1g states R's gotcha", () => {
    // R's diag(c(5)) is the 5 x 5 identity and diag(2.5) truncates to 2 x 2.
    const one = diag([5]);
    expect([one.nrow, one.ncol]).toEqual([1, 1]);
    expect(columnMajor(one)).toEqual([5]);
    expect(() => diag(2.5)).toThrow(RangeError);
  });
});
