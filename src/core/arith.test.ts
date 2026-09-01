import { describe, expect, test } from "bun:test";

import {
  extent,
  mean,
  meanAbsoluteDeviation,
  median,
  quantile,
  quantiles,
  requireCount,
  resolveFma,
  sd,
  sum,
  withoutNegativeZero,
  zipWith,
} from "./arith.js";

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
  // Expected values from R 4.5.3, `.claude/plans/001-PLAN-port/sampling-fixtures.md`
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

describe("meanAbsoluteDeviation", () => {
  // R base has no function for this. R's `mad()` is the *median* absolute
  // deviation, scaled by 1.4826, and gives a different number. The expected
  // values below come from the definition, on the fixtures `sd` uses.
  test("returns the mean distance from the mean", () => {
    // mean 6.63; the ten distances add up to 23.76.
    expectCloseToR(
      meanAbsoluteDeviation([2.1, 4.5, 4.7, 5, 5.5, 6.1, 7.3, 8.8, 9.9, 12.4]),
      2.376,
    );
    // mean 2.5; the four distances are 1.5, 0.5, 0.5 and 1.5.
    expectCloseToR(meanAbsoluteDeviation([1, 2, 3, 4]), 1);
  });

  test("stays below the standard deviation of the same values", () => {
    const values = [2.1, 4.5, 4.7, 5, 5.5, 6.1, 7.3, 8.8, 9.9, 12.4];
    expect(meanAbsoluteDeviation(values)).toBeLessThan(sd(values));
  });

  test("returns 0 for constant values", () => {
    expect(meanAbsoluteDeviation([5, 5, 5, 5])).toBe(0);
  });

  test("returns 0 for one value, which sits at its own mean", () => {
    expect(meanAbsoluteDeviation([7])).toBe(0);
  });

  test("returns NaN for no values, as the mean of nothing does", () => {
    expect(meanAbsoluteDeviation([])).toBeNaN();
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

describe("median", () => {
  // Every expected value below comes from R 4.5.3's own `median()`.
  test("returns the middle value of an odd count", () => {
    expectCloseToR(median([1, 3, 2, 7, 5]), 3);
  });

  test("does not need the values sorted", () => {
    expectCloseToR(median([9, 1, 5, 3, 7]), 5);
  });

  test("averages the two middle values of an even count, as R does", () => {
    expectCloseToR(median([1, 3, 2, 7, 5, 9]), 4);
    expectCloseToR(median([1, 2, 3, 4]), 2.5);
  });

  test("keeps R's last bits on an even count that does not divide", () => {
    // R's median averages the two middle values, and the type-7 quantile
    // weights each by a half. Both land on the same double.
    expect(median([0.1, 0.2])).toBe(0.15000000000000002);
  });

  test("handles negative values", () => {
    expectCloseToR(median([-5, -1, -3, -2]), -2.5);
  });

  test("returns the value itself for one value", () => {
    expect(median([4])).toBe(4);
  });

  test("returns NaN for no values, where R returns NA", () => {
    expect(median([])).toBeNaN();
  });

  test("agrees with the type-7 quantile at 0.5", () => {
    const xSmall = [2.1, 4.5, 4.7, 5, 5.5, 6.1, 7.3, 8.8, 9.9, 12.4];
    expect(median(xSmall)).toBe(quantile(xSmall, 0.5));
    expectCloseToR(median(xSmall), 5.7999999999999998);
  });

  test("does not modify the values", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
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

describe("extent", () => {
  test("returns the lowest and the highest value", () => {
    expect(extent([3, 1, 4, 1, 5])).toEqual([1, 5]);
  });

  test("returns a single value as both ends", () => {
    expect(extent([7])).toEqual([7, 7]);
  });

  test("handles negative values", () => {
    expect(extent([-2.5, -9, -0.5])).toEqual([-9, -0.5]);
  });

  test("returns R's range(numeric(0)) shape for no values", () => {
    expect(extent([])).toEqual([
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
  });

  test("does not overflow the call stack on a long column", () => {
    const long = Array.from({ length: 500000 }, (_, index) => index);
    expect(extent(long)).toEqual([0, 499999]);
  });
});

describe("withoutNegativeZero", () => {
  test("maps a negative zero to a positive one", () => {
    expect(Object.is(withoutNegativeZero(-0), 0)).toBe(true);
  });

  test("leaves a positive zero alone", () => {
    expect(Object.is(withoutNegativeZero(0), 0)).toBe(true);
  });

  test("returns every other value unchanged", () => {
    expect(withoutNegativeZero(-2.5)).toBe(-2.5);
    expect(withoutNegativeZero(3)).toBe(3);
  });
});

describe("requireCount", () => {
  test("accepts a non-negative integer", () => {
    expect(() => requireCount(0, "reps")).not.toThrow();
    expect(() => requireCount(10, "reps")).not.toThrow();
  });

  test("rejects a negative count, naming it", () => {
    expect(() => requireCount(-1, "reps")).toThrow(
      "reps must be a non-negative integer, got -1",
    );
  });

  test("rejects a fractional count", () => {
    expect(() => requireCount(2.5, "n")).toThrow(RangeError);
  });

  test("rejects a non-finite count", () => {
    expect(() => requireCount(Number.NaN, "n")).toThrow(RangeError);
  });
});

describe("resolveFma()", () => {
  test("the default and true select the fused form, false the plain one", () => {
    expect(resolveFma(undefined)).toBe(true);
    expect(resolveFma(true)).toBe(true);
    expect(resolveFma(false)).toBe(false);
  });

  test("refuses anything that is not a boolean, so a truthy 1 cannot pass as true", () => {
    expect(() => resolveFma(1 as unknown as boolean)).toThrow(TypeError);
    expect(() => resolveFma("yes" as unknown as boolean)).toThrow(TypeError);
    expect(() => resolveFma(null as unknown as boolean)).toThrow(/fma must be true or false/);
  });
});
