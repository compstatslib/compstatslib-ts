import { describe, expect, test } from "bun:test";

import { mean, quantile, quantiles, sd, sum, zipWith } from "./arith";

/**
 * Assert agreement with R, relative 1e-12 scaled by max(1, |expected|), the
 * tolerance the other core modules use.
 */
function expectCloseToR(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    1e-12 * Math.max(1, Math.abs(expected)),
  );
}

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

describe("sd", () => {
  // Expected values from R 4.5.3, `.claude/plans/sampling-fixtures.md`
  // Section 3. R divides by n - 1.
  test("matches R on the sampling fixtures", () => {
    expectCloseToR(
      sd([2.1, 4.5, 4.7, 5, 5.5, 6.1, 7.3, 8.8, 9.9, 12.4]),
      3.0210557389392503,
    );
    expectCloseToR(sd([49.8, 50.1, 50.4, 49.6, 50.0, 50.9, 49.2]),
      0.55075705472860903);
    expectCloseToR(sd([1, 2, 3, 4]), 1.2909944487358056);
  });

  test("returns 0 for constant values", () => {
    expect(sd([5, 5, 5, 5])).toBe(0);
  });

  test("returns NaN below two values, where R returns NA", () => {
    expect(sd([7])).toBeNaN();
    expect(sd([])).toBeNaN();
  });
});

describe("quantile", () => {
  // R's type 7, the default of `quantile()` and the one `IQR()` feeds
  // `bw.nrd0`. Expected values computed in session from R 4.5.3.
  const xSmall = [2.1, 4.5, 4.7, 5, 5.5, 6.1, 7.3, 8.8, 9.9, 12.4];

  test("matches R on an unsorted ten-value vector", () => {
    expectCloseToR(quantile(xSmall, 0.25), 4.7750000000000004);
    expectCloseToR(quantile(xSmall, 0.5), 5.7999999999999998);
    expectCloseToR(quantile(xSmall, 0.75), 8.4250000000000007);
  });

  test("matches R at the ends and the middle of a seven-value vector", () => {
    const th7 = [49.8, 50.1, 50.4, 49.6, 50.0, 50.9, 49.2];

    expectCloseToR(quantile(th7, 0), 49.200000000000003);
    expectCloseToR(quantile(th7, 0.25), 49.700000000000003);
    expectCloseToR(quantile(th7, 0.5), 50);
    expectCloseToR(quantile(th7, 0.75), 50.25);
    expectCloseToR(quantile(th7, 1), 50.899999999999999);
  });

  test("interpolates between neighbors", () => {
    expectCloseToR(quantile([1, 2, 3, 4], 0.25), 1.75);
    expectCloseToR(quantile([1, 2, 3, 4], 0.33), 1.99);
    expectCloseToR(quantile([1, 2, 3, 4], 0.75), 3.25);
  });

  test("handles a single value and constant values", () => {
    expect(quantile([7], 0.25)).toBe(7);
    expect(quantile([5, 5, 5, 5], 0.25)).toBe(5);
  });

  test("rejects a probability outside [0, 1], as R does", () => {
    // R: "'probs' outside [0,1]".
    expect(() => quantile([1, 2, 3], -0.1)).toThrow(RangeError);
    expect(() => quantile([1, 2, 3], 1.5)).toThrow(RangeError);
  });

  test("returns NaN with no values, where R returns NA", () => {
    expect(quantile([], 0.5)).toBeNaN();
  });

  test("does not modify the input", () => {
    const values = [3, 1, 2];
    quantile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("quantiles", () => {
  const xSmall = [2.1, 4.5, 4.7, 5, 5.5, 6.1, 7.3, 8.8, 9.9, 12.4];

  test("returns the quantiles of several probabilities at once", () => {
    const values = quantiles(xSmall, [0.25, 0.5, 0.75]);

    expect(values).toHaveLength(3);
    expectCloseToR(values[0] as number, 4.7750000000000004);
    expectCloseToR(values[1] as number, 5.7999999999999998);
    expectCloseToR(values[2] as number, 8.4250000000000007);
  });

  test("agrees with the single-probability form", () => {
    expect(quantiles(xSmall, [0.25, 0.75])).toEqual([
      quantile(xSmall, 0.25),
      quantile(xSmall, 0.75),
    ]);
  });

  test("returns nothing for no probabilities", () => {
    expect(quantiles(xSmall, [])).toEqual([]);
  });

  test("rejects a probability outside [0, 1]", () => {
    expect(() => quantiles(xSmall, [0.5, 2])).toThrow(RangeError);
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
