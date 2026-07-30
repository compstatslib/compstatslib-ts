import { describe, expect, test } from "bun:test";

import { mean, sum, zipWith } from "./arith";

describe("sum", () => {
  test("adds all values", () => {
    expect(sum([1, 2, 3.5])).toBe(6.5);
  });

  test("returns 0 for an empty array", () => {
    expect(sum([])).toBe(0);
  });
});

describe("mean", () => {
  test("averages the values", () => {
    expect(mean([1, 3, 5, 8])).toBe(4.25);
  });

  test("returns NaN for an empty array", () => {
    expect(mean([])).toBeNaN();
  });
});

describe("zipWith", () => {
  test("combines pairs in order", () => {
    expect(zipWith([1, 2, 3], [4, 5, 6], (a, b) => a * b)).toEqual([4, 10, 18]);
  });

  test("stops at the shorter array", () => {
    expect(zipWith([1, 2, 3], [10], (a, b) => a + b)).toEqual([11]);
  });
});
