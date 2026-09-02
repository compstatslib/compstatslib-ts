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

/**
 * R's `mean()` and `sd()` on a vector R's own arithmetic separates from the
 * naive one.
 *
 * The values come from `../compstatslib/conformance-fixtures/arith.R`,
 * captured in `.claude/plans/006-PLAN-mean-parity/arith-fixtures.md`. R prints
 * them at %.17g, so these are R's exact doubles and the assertions below are
 * `toBe`, not a tolerance.
 *
 * The vector is 97 draws from `runif(97, -500, 500)` under `set.seed(2026)`.
 * Its mean is near zero relative to its values, which is where the one-pass
 * sum's rounding shows most: R's mean and `sum(x) / n` are 46 units in the
 * last place apart here.
 */
const R_MIXED_97: readonly number[] = [
  198.67347087711096,
  56.530505884438753,
  -359.86004234291613,
  -214.27669376134872,
  55.369009962305427,
  -474.8688496183604,
  -33.769445028156042,
  361.01068509742618,
  -247.49882123433053,
  80.806337296962738,
  -494.06674318015575,
  191.86593987978995,
  -268.87495303526521,
  348.53246225975454,
  -346.1647592484951,
  -143.1906851939857,
  45.20450416021049,
  -498.80238622426987,
  -182.17551009729505,
  -482.71064623259008,
  -158.44197408296168,
  -156.5612000413239,
  -267.4373066984117,
  -438.63117229193449,
  -87.623748229816556,
  -314.48782281950116,
  -89.327936293557286,
  -359.91914430633187,
  -494.56548318266869,
  101.73881566151977,
  411.01012728177011,
  -324.63721605017781,
  231.18741321377456,
  -483.84279035963118,
  86.115716258063912,
  -74.18157160282135,
  -289.50902237556875,
  -22.799891652539372,
  254.82327491044998,
  -53.170720115303993,
  -128.79819795489311,
  374.77840459905565,
  -65.402692649513483,
  -59.863223461434245,
  -418.04316663183272,
  -465.38069657981396,
  428.65198175422847,
  -205.43370279483497,
  19.2242874763906,
  -263.60357506200671,
  471.80980863049626,
  132.51150120049715,
  458.26916582882404,
  386.35397888720036,
  23.183763725683093,
  215.91563429683447,
  240.64273294061422,
  -454.10367613658309,
  457.79291377402842,
  -298.863316886127,
  -201.58580178394914,
  395.57266817428172,
  66.075772047042847,
  -44.492015382274985,
  -100.53169471211731,
  -416.99496959336102,
  130.35071035847068,
  -34.90501013584435,
  72.378459153696895,
  162.23169327713549,
  377.90826614946127,
  -121.06301286257803,
  223.57431263662875,
  357.85794351249933,
  -313.74449701979756,
  132.69812217913568,
  218.11582450754941,
  41.806604014709592,
  -295.2874016482383,
  399.98898864723742,
  -376.41567084938288,
  451.54694630764425,
  281.71512600965798,
  462.13596477173269,
  -385.74807229451835,
  477.55213920027018,
  120.46950170770288,
  427.42726556025445,
  -297.76328708976507,
  -284.47081823833287,
  421.92522273398936,
  222.11555088870227,
  261.70138828456402,
  -214.72254930995405,
  -156.34111920371652,
  -158.60658348537982,
  287.95979684218764,
];

/** R: `mean(x)` on R_MIXED_97. */
const R_MIXED_97_MEAN = -15.44794416746366;

/** R: `sum(x) / length(x)` on R_MIXED_97. Not R's mean; 46 ulps away. */
const R_MIXED_97_NAIVE_MEAN = -15.447944167463742;

/** R: `sd(x)` on R_MIXED_97. */
const R_MIXED_97_SD = 295.76656192026246;

/** R: `sd(x)` centered on the naive mean. Not R's sd; one ulp away. */
const R_MIXED_97_NAIVE_SD = 295.76656192026252;

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

  // R's `mean.default` on a double vector is C `do_mean`
  // (`src/main/summary.c`), which sums, divides, and then adds the mean of
  // the residuals back. The correction is not a refinement a port may skip:
  // it moves the result on 18053 of 20000 random vectors, by a median of 6
  // units in the last place. See `MEAN-PARITY.html` in
  // `.claude/plans/006-PLAN-mean-parity/`.
  test("is R's corrected mean, not the naive sum over the count", () => {
    expect(mean(R_MIXED_97)).toBe(R_MIXED_97_MEAN);
  });

  test("differs from the naive mean, which is why the correction is there", () => {
    // The naive form is pinned too, so a failure here says which half moved:
    // if `sum` still matches R, the defect is in the correction alone.
    expect(sum(R_MIXED_97) / R_MIXED_97.length).toBe(R_MIXED_97_NAIVE_MEAN);
    expect(mean(R_MIXED_97)).not.toBe(R_MIXED_97_NAIVE_MEAN);
  });

  test("returns one value unchanged, its own mean", () => {
    expect(mean([7])).toBe(7);
  });

  // `do_mean` guards the second pass with `R_FINITE`, so a non-finite first
  // pass is returned as it stands rather than turned into NaN by a residual
  // of Inf - Inf.
  test("returns a non-finite first pass unchanged, as R's guard does", () => {
    expect(mean([1, Number.POSITIVE_INFINITY])).toBe(Number.POSITIVE_INFINITY);
    expect(mean([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])).toBeNaN();
    expect(mean([1, Number.NaN])).toBeNaN();
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

  // R's `sd()` is `sqrt(var())`, and `var()` goes to
  // `src/library/stats/src/cov.c`, whose `MEAN` macro is the same corrected
  // two-pass computation as `do_mean`. So `sd` centers on the corrected mean
  // as well, and centering it on the naive one moves the last bit.
  test("centers on R's corrected mean, as cov.c does", () => {
    expect(sd(R_MIXED_97)).toBe(R_MIXED_97_SD);
    expect(sd(R_MIXED_97)).not.toBe(R_MIXED_97_NAIVE_SD);
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
