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

  test("crossprod carries the column names of both factors", () => {
    const c = crossprod(X, Y);
    expect(c.dimnames).toEqual([
      ["a", "b"],
      ["u", "v", "w"],
    ]);
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
    // R warns and recycles a short vector; the port refuses.
    expect(() => cbind(X, [9, 8, 7])).toThrow(RangeError);
    expect(() => rbind(X, [7])).toThrow(RangeError);
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
    expect(() => identity(0)).not.toThrow();
    expect(() => identity(-1)).toThrow(RangeError);
    expect(() => identity(2.5)).toThrow(RangeError);
  });
});
