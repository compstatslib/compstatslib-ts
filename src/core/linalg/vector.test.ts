/**
 * Tests for the vector functions: R's operators over vectors, by name.
 *
 * Expected values come from R 4.5.3, `../compstatslib/conformance-fixtures/linalg.R`
 * section 1e and 1f, captured in
 * `.claude/plans/003-PLAN-linalg/linalg-fixtures.md`. The arithmetic runs in
 * the same order R runs it — a product per element, one left-to-right sum,
 * one correctly rounded `sqrt` — so the pins are exact (plan Q1).
 */

import { describe, expect, test } from "bun:test";
import { add, cosine, div, dot, mul, norm, square, sub } from "./vector";

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
