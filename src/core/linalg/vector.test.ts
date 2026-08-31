/**
 * Tests for the vector functions: R's operators over vectors, by name.
 *
 * Expected values come from R 4.5.3, `../compstatslib/conformance-fixtures/linalg.R`
 * section 1e and 1f, captured in
 * `.claude/plans/003-PLAN-linalg/linalg-fixtures.md`. The arithmetic runs in
 * the same order R runs it — a product per element, one left-to-right sum,
 * one correctly rounded `sqrt` — so the pins are exact (plan Q1).
 *
 * The last block covers the matrix overloads of plan 004, Slice 7: R's
 * elementwise `+ - * /` on two matrices, and on a matrix and a number.
 * Its values come from `linalg.R` section 9, captured in
 * `.claude/plans/004-PLAN-seminr-utilities/linalg-fixtures.md`. Every entry
 * is one operation on an exact binary fraction, so the pins are exact.
 */

import { describe, expect, test } from "bun:test";
import { matrix, type Matrix } from "./matrix";
import { add, cosine, div, dot, mul, norm, square, sub, type Vector } from "./vector";

const a = [1.5, -2, 3.25, 0.5];
const b = [2, 4, -1, 0.25];

describe("elementwise arithmetic", () => {
  test("a + 1 recycles a scalar — fixture 1e", () => {
    expect(add(a, 1)).toEqual([2.5, -1, 4.25, 1.5]);
  });

  test("a - b — fixture 1e", () => {
    expect(sub(a, b)).toEqual([-0.5, -6, 4.25, 0.25]);
  });

  test("a * b — fixture 1e", () => {
    expect(mul(a, b)).toEqual([3, -8, -3.25, 0.125]);
  });

  test("2 * a — fixture 1e", () => {
    expect(mul(a, 2)).toEqual([3, -4, 6.5, 1]);
  });

  test("a^2 — fixture 1e", () => {
    expect(square(a)).toEqual([2.25, 4, 10.5625, 0.25]);
  });

  test("a / b — fixture 1e", () => {
    expect(div(a, b)).toEqual([0.75, -0.5, -3.25, 2]);
  });

  test("do not modify their inputs", () => {
    const copy = [...a];
    add(a, 1);
    mul(a, b);
    expect(a).toEqual(copy);
  });

  test("refuse a length mismatch, where R warns and recycles — fixture 1f", () => {
    expect(() => add(a, [1, 2, 3])).toThrow(RangeError);
    expect(() => sub(a, [1, 2, 3])).toThrow(RangeError);
    expect(() => mul(a, [1, 2, 3])).toThrow(RangeError);
    expect(() => div(a, [1, 2, 3])).toThrow(RangeError);
  });

  test("an empty vector is fine", () => {
    expect(add([], 1)).toEqual([]);
    expect(mul([], [])).toEqual([]);
  });
});

describe("dot(), norm(), cosine()", () => {
  test("sum(a * b) — fixture 1e", () => {
    expect(dot(a, b)).toBe(-8.125);
  });

  test("sqrt(sum(a^2)) — fixture 1e", () => {
    expect(norm(a)).toBe(4.1306779104645761);
    expect(norm(b)).toBe(4.5893899376714549);
  });

  test("cosine is dot over the product of norms, in R's order — fixture 1e", () => {
    expect(cosine(a, b)).toBe(-0.42859497839305649);
    // R's own value carries the rounding of the two sqrt calls; the port
    // computes it the same way and lands on the same double.
    expect(cosine(a, a)).toBe(1.0000000000000002);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  test("norm() survives a long vector — fixture 1e", () => {
    const ones = new Array<number>(200000).fill(1);
    expect(norm(ones)).toBe(447.21359549995793);
  });

  test("dot() refuses a length mismatch", () => {
    expect(() => dot(a, [1, 2, 3])).toThrow(RangeError);
    expect(() => cosine(a, [1, 2, 3])).toThrow(RangeError);
  });

  test("dot() and norm() of nothing are 0", () => {
    expect(dot([], [])).toBe(0);
    expect(norm([])).toBe(0);
  });

  test("cosine of a zero vector is NaN, as 0/0 is in R", () => {
    expect(cosine([0, 0], [1, 2])).toBeNaN();
  });
});

describe("elementwise arithmetic on matrices — fixture 9", () => {
  /** The fixture matrices, exactly as `linalg.R` section 9 builds them. */
  const A = matrix([1, 2, 3, 4, 5, 6], { nrow: 3 });
  const B = matrix([0.5, -1, 2, 0.25, 4, -8], { nrow: 3 });
  const N1 = matrix([1, 2, 3, 4, 5, 6], {
    nrow: 3,
    dimnames: [
      ["r1", "r2", "r3"],
      ["a", "b"],
    ],
  });
  const N2 = matrix([0.5, -1, 2, 0.25, 4, -8], {
    nrow: 3,
    dimnames: [
      ["p", "q", "s"],
      ["u", "v"],
    ],
  });

  /** The entries column by column, as the fixture prints them. */
  function columnMajor(m: Matrix): number[] {
    return Array.from(m.data);
  }

  /** The extents the fixture prints as `dim`. */
  function shape(m: Matrix): [number, number] {
    return [m.nrow, m.ncol];
  }

  test("A + B, A - B, A * B and A / B work entry by entry — fixture 9a", () => {
    expect(shape(add(A, B))).toEqual([3, 2]);
    expect(columnMajor(add(A, B))).toEqual([1.5, 1, 5, 4.25, 9, -2]);
    expect(columnMajor(sub(A, B))).toEqual([0.5, 3, 1, 3.75, 1, 14]);
    // `mul` is R's `*`, the elementwise product, and not `%*%`.
    expect(columnMajor(mul(A, B))).toEqual([0.5, -2, 6, 1, 20, -48]);
    expect(columnMajor(div(A, B))).toEqual([2, -2, 1.5, 16, 1.25, -0.75]);
  });

  test("a number is recycled over every entry — fixture 9b", () => {
    expect(shape(add(A, 2))).toEqual([3, 2]);
    expect(columnMajor(add(A, 2))).toEqual([3, 4, 5, 6, 7, 8]);
    expect(columnMajor(mul(A, 0.5))).toEqual([0.5, 1, 1.5, 2, 2.5, 3]);
    expect(columnMajor(div(A, 4))).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5]);
  });

  test("R's `2 - A` is written with the matrix first — fixture 9b", () => {
    // The overloads take the matrix as the left operand, so R's `2 - A`
    // becomes `2 + (-1 * A)`. It lands on the fixture's own values.
    expect(columnMajor(add(mul(A, -1), 2))).toEqual([1, 0, -1, -2, -3, -4]);
  });

  test("dimnames come from the first operand that carries any — fixture 9c", () => {
    expect(add(N1, N2).dimnames).toEqual([
      ["r1", "r2", "r3"],
      ["a", "b"],
    ]);
    expect(add(N1, B).dimnames).toEqual([
      ["r1", "r2", "r3"],
      ["a", "b"],
    ]);
    expect(add(A, N2).dimnames).toEqual([
      ["p", "q", "s"],
      ["u", "v"],
    ]);
    // A number carries no names, so the matrix keeps its own.
    expect(add(N1, 2).dimnames).toEqual([
      ["r1", "r2", "r3"],
      ["a", "b"],
    ]);
    expect(columnMajor(add(N1, 2))).toEqual([3, 4, 5, 6, 7, 8]);
    expect(add(A, B).dimnames).toBeNull();
  });

  test("two matrices of different extents are non-conformable — fixture 9d", () => {
    const wide = matrix([1, 2, 3, 4, 5, 6], { nrow: 2 });
    expect(() => add(A, wide)).toThrow(RangeError);
    expect(() => add(A, wide)).toThrow("non-conformable arrays");
    expect(() => sub(A, wide)).toThrow("non-conformable arrays");
    expect(() => mul(A, wide)).toThrow("non-conformable arrays");
    expect(() => div(A, wide)).toThrow("non-conformable arrays");
    // Same entry count, different extents, so R refuses these too.
    expect(() => add(A, matrix([1, 2, 3, 4, 5, 6], { nrow: 6 }))).toThrow(RangeError);
  });

  test("a vector beside a matrix is refused, where R recycles — fixture 9e", () => {
    // R's `matrix(1:6, 3) + 1:3` is 2, 4, 6, 5, 7, 9 in silence, and
    // `+ 1:2` is 2, 4, 4, 6, 6, 8 in silence. `+ 1:4` warns with "longer
    // object length is not a multiple of shorter object length" and gives
    // 2, 4, 6, 8, 6, 8. The port refuses all three: a silent recycle lets a
    // typo fit the wrong model.
    const vectorAsMatrix = [1, 2, 3] as unknown as Matrix;
    expect(() => add(A, vectorAsMatrix)).toThrow(TypeError);
    expect(() => sub(A, vectorAsMatrix)).toThrow(TypeError);
    expect(() => mul(A, vectorAsMatrix)).toThrow(TypeError);
    expect(() => div(A, vectorAsMatrix)).toThrow(TypeError);
    expect(() => add(A, [1, 2] as unknown as Matrix)).toThrow(TypeError);
    expect(() => add(A, [1, 2, 3, 4] as unknown as Matrix)).toThrow(TypeError);

    // The other order is refused as well.
    const matrixAsVector = A as unknown as Vector;
    expect(() => add([1, 2, 3, 4, 5, 6], matrixAsVector)).toThrow(TypeError);
    expect(() => mul([1, 2, 3], matrixAsVector)).toThrow(TypeError);
  });

  test("do not modify their inputs", () => {
    const before = columnMajor(A);
    const names = A.dimnames;
    add(A, B);
    sub(A, B);
    mul(A, 0.5);
    div(A, B);
    expect(columnMajor(A)).toEqual(before);
    expect(A.dimnames).toBe(names);
    expect(columnMajor(B)).toEqual([0.5, -1, 2, 0.25, 4, -8]);
    expect(add(A, B).data).not.toBe(A.data);
  });
});
