/**
 * Tests for the seedable random layer.
 *
 * These numbers are NOT R-verified, and they cannot be: R draws from a
 * Mersenne Twister stream that no JavaScript generator reproduces. The port
 * plan states this — reproducibility across runs is the requirement, parity
 * with R's stream is not. Two kinds of expected value appear below:
 *
 * - **Derived values.** The tests drive the functions with a stub generator
 *   that returns a known sequence, then assert against the transform computed
 *   with `Math` in the test itself. These pin the algorithm and the exact
 *   order in which each function consumes the generator.
 * - **Regression pins.** The golden sequence for seed 42 comes from an
 *   independent implementation of mulberry32 (the canonical public-domain
 *   form), run once for this task. It pins the stream so that a later change
 *   to the generator cannot silently change every seeded demo.
 *
 * Statistical assertions use a fixed seed and stated tolerances. They test
 * that the distributions are the shape they claim to be, not that any
 * particular value is correct.
 */

import { describe, expect, test } from "bun:test";

import {
  rcauchy,
  rlnorm,
  rnorm,
  rt,
  runif,
  sampleWithoutReplacement,
  seededRng,
  type Rng,
} from "./rng";
import { mean, quantiles } from "./arith";

/**
 * A generator that returns the given values in order, then repeats from the
 * start. Repeating keeps a short sequence usable for a long draw.
 */
function stubRng(values: readonly number[]): Rng {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

/** Count the draws a generator makes. */
function countingRng(inner: Rng): { rng: Rng; count: () => number } {
  let count = 0;
  return {
    rng: () => {
      count += 1;
      return inner();
    },
    count: () => count,
  };
}

/** Sample standard deviation, R's `sd()`. */
function sd(values: readonly number[]): number {
  const average = mean(values);
  const squares = values.map((value) => (value - average) * (value - average));
  return Math.sqrt(
    squares.reduce((total, value) => total + value, 0) / (values.length - 1),
  );
}

describe("seededRng", () => {
  /**
   * Regression pins: mulberry32 seeded with 42, first five draws, from an
   * independent implementation of the published algorithm. Not R values.
   */
  const SEED_42_GOLDEN = [
    0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
    0.6697340414393693, 0.17481389874592423,
  ];

  test("reproduces the pinned stream for seed 42", () => {
    const rng = seededRng(42);
    const drawn = Array.from({ length: 5 }, () => rng());
    expect(drawn).toEqual(SEED_42_GOLDEN);
  });

  test("gives two generators of one seed the same stream", () => {
    const first = Array.from({ length: 20 }, seededRng(7));
    const second = Array.from({ length: 20 }, seededRng(7));
    expect(first).toEqual(second);
  });

  test("gives different seeds different streams", () => {
    const first = Array.from({ length: 20 }, seededRng(1));
    const second = Array.from({ length: 20 }, seededRng(2));
    expect(first).not.toEqual(second);
  });

  test("returns values in [0, 1)", () => {
    const rng = seededRng(2026);
    const drawn = Array.from({ length: 5000 }, () => rng());
    expect(drawn.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  test("truncates a fractional seed to its integer part", () => {
    expect(seededRng(42.9)()).toBe(seededRng(42)());
  });

  test("rejects a non-finite seed", () => {
    expect(() => seededRng(Number.NaN)).toThrow(RangeError);
    expect(() => seededRng(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("runif", () => {
  test("returns the raw draws with the default range", () => {
    const rng = stubRng([0.25, 0.5, 0.75]);
    expect(runif(rng, 3)).toEqual([0.25, 0.5, 0.75]);
  });

  test("scales each draw into [min, max)", () => {
    const rng = stubRng([0, 0.25, 0.5]);
    expect(runif(rng, 3, { min: 10, max: 20 })).toEqual([10, 12.5, 15]);
  });

  test("supports a negative range", () => {
    const rng = stubRng([0.5]);
    expect(runif(rng, 1, { min: -4, max: -2 })).toEqual([-3]);
  });

  test("draws exactly once per value", () => {
    const counter = countingRng(stubRng([0.5]));
    runif(counter.rng, 6);
    expect(counter.count()).toBe(6);
  });

  test("returns an empty array for n = 0 without drawing", () => {
    const counter = countingRng(stubRng([0.5]));
    expect(runif(counter.rng, 0)).toEqual([]);
    expect(counter.count()).toBe(0);
  });

  test("returns NaN when min is above max, like R", () => {
    const values = runif(stubRng([0.5]), 3, { min: 5, max: 1 });
    expect(values).toHaveLength(3);
    expect(values.every((value) => Number.isNaN(value))).toBe(true);
  });

  test("does not draw when the range is invalid", () => {
    const counter = countingRng(stubRng([0.5]));
    runif(counter.rng, 3, { min: 5, max: 1 });
    expect(counter.count()).toBe(0);
  });

  test("returns NaN for a non-finite bound, like R", () => {
    expect(runif(stubRng([0.5]), 1, { max: Number.POSITIVE_INFINITY })[0]).toBeNaN();
    expect(runif(stubRng([0.5]), 1, { min: Number.NaN })[0]).toBeNaN();
  });

  test("stays inside the range over many draws", () => {
    const values = runif(seededRng(11), 10000, { min: 17, max: 35 });
    expect(values.every((value) => value >= 17 && value < 35)).toBe(true);
  });

  // Tolerance: the mean of 10000 uniforms over a width-18 range has a
  // standard error of 18 / sqrt(12 * 10000) = 0.052. 0.3 is about 6 of those.
  test("centers on the middle of the range", () => {
    const values = runif(seededRng(12), 10000, { min: 17, max: 35 });
    expect(Math.abs(mean(values) - 26)).toBeLessThan(0.3);
  });

  test("rejects a negative or fractional count", () => {
    expect(() => runif(stubRng([0.5]), -1)).toThrow(RangeError);
    expect(() => runif(stubRng([0.5]), 2.5)).toThrow(RangeError);
  });
});

describe("rnorm", () => {
  /**
   * Box-Muller in pairs. Each pair takes two draws in order: u1 makes the
   * radius, u2 makes the angle. The radius uses `1 - u1` because a generator
   * over [0, 1) can return an exact 0, and `log(0)` is not finite.
   */
  function expectedPair(u1: number, u2: number): [number, number] {
    const radius = Math.sqrt(-2 * Math.log(1 - u1));
    const angle = 2 * Math.PI * u2;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  }

  test("transforms each pair of draws with Box-Muller", () => {
    const values = rnorm(stubRng([0.25, 0.5, 0.75, 0.125]), 4);
    const first = expectedPair(0.25, 0.5);
    const second = expectedPair(0.75, 0.125);
    expect(values).toEqual([first[0], first[1], second[0], second[1]]);
  });

  test("takes the radius from the first draw of a pair", () => {
    // u2 = 0 makes the angle 0, so the first value is the radius itself.
    const values = rnorm(stubRng([0.5, 0]), 1);
    expect(values[0]).toBe(Math.sqrt(-2 * Math.log(0.5)));
  });

  test("returns 0 rather than infinity when a draw is exactly 0", () => {
    const values = rnorm(stubRng([0, 0.3]), 2);
    expect(values[0]).toBe(0);
    expect(values[1]).toBe(0);
  });

  test("draws two values per pair and discards the spare of an odd count", () => {
    const counter = countingRng(stubRng([0.4, 0.6]));
    const values = rnorm(counter.rng, 3);
    expect(values).toHaveLength(3);
    expect(counter.count()).toBe(4);
  });

  test("shifts and scales by mean and sd", () => {
    const raw = rnorm(stubRng([0.25, 0.5]), 2);
    const scaled = rnorm(stubRng([0.25, 0.5]), 2, { mean: 50, sd: 10 });
    expect(scaled).toEqual([50 + 10 * raw[0], 50 + 10 * raw[1]]);
  });

  test("returns the mean when sd is 0", () => {
    expect(rnorm(stubRng([0.25, 0.5]), 2, { mean: 4, sd: 0 })).toEqual([4, 4]);
  });

  test("returns an empty array for n = 0 without drawing", () => {
    const counter = countingRng(stubRng([0.5]));
    expect(rnorm(counter.rng, 0)).toEqual([]);
    expect(counter.count()).toBe(0);
  });

  test("returns NaN for a negative sd, like R", () => {
    const values = rnorm(stubRng([0.5]), 2, { sd: -1 });
    expect(values).toHaveLength(2);
    expect(values.every((value) => Number.isNaN(value))).toBe(true);
  });

  test("does not draw when the parameters are invalid", () => {
    const counter = countingRng(stubRng([0.5]));
    rnorm(counter.rng, 4, { sd: -1 });
    rnorm(counter.rng, 4, { mean: Number.NaN });
    expect(counter.count()).toBe(0);
  });

  // Tolerance: the mean of 10000 draws at sd 10 has a standard error of 0.1,
  // and the sample sd has about sd / sqrt(2n) = 0.07. 0.5 covers both by 5x.
  test("has the requested mean and sd over many draws", () => {
    const values = rnorm(seededRng(13), 10000, { mean: 50, sd: 10 });
    expect(Math.abs(mean(values) - 50)).toBeLessThan(0.5);
    expect(Math.abs(sd(values) - 10)).toBeLessThan(0.5);
  });

  test("rejects a negative or fractional count", () => {
    expect(() => rnorm(stubRng([0.5]), -2)).toThrow(RangeError);
    expect(() => rnorm(stubRng([0.5]), 1.5)).toThrow(RangeError);
  });
});

describe("rt", () => {
  /** The probabilities of the qt fixtures below. */
  const QT_PROBS = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];

  /** R 4.5.3: `qt(p, df = 2)` at the probabilities above. */
  const QT_DF2 = [
    -6.96455673428327, -2.91998558035373, -1.88561808316413,
    -0.816496580927726, 0, 0.816496580927726, 1.88561808316413,
    2.91998558035372, 6.96455673428327,
  ];

  /** R 4.5.3: `qt(p, df = 3)` at the probabilities above. */
  const QT_DF3 = [
    -4.54070285856813, -2.35336343480183, -1.63774435369621,
    -0.764892328404345, 0, 0.764892328404345, 1.63774435369621,
    2.35336343480182, 4.54070285856813,
  ];

  /** R 4.5.3: `qt(p, df = 30)` at the probabilities above. */
  const QT_DF30 = [
    -2.45726154240059, -1.69726088659396, -1.3104150253914,
    -0.682755693321292, 0, 0.682755693321292, 1.3104150253914,
    1.69726088659396, 2.45726154240059,
  ];

  /** Assert each empirical quantile within its own absolute tolerance. */
  function expectQuantilesNear(
    values: readonly number[],
    expected: readonly number[],
    tolerance: readonly number[],
  ): void {
    const observed = quantiles(values, QT_PROBS);
    observed.forEach((value, index) => {
      expect(
        Math.abs(value - (expected[index] as number)),
      ).toBeLessThan(tolerance[index] as number);
    });
  }

  test("gives one seed one sequence", () => {
    const first = rt(seededRng(42), 10, 3);
    const second = rt(seededRng(42), 10, 3);
    expect(second).toEqual(first);
  });

  test("gives different seeds different sequences", () => {
    const first = rt(seededRng(1), 10, 3);
    const second = rt(seededRng(2), 10, 3);
    expect(second).not.toEqual(first);
  });

  /**
   * The construction, recomputed from `rnorm` itself: the first `rnorm`
   * batch gives the numerators, the next `df` batches give the chi-square
   * components, and each value is `z / sqrt(chiSquare / df)`. Driving both
   * sides with one stub sequence pins the exact consumption order.
   */
  test("builds each value as z over the root of a scaled chi-square", () => {
    const sequence = [
      0.3, 0.7, 0.15, 0.9, 0.45, 0.6, 0.2, 0.85, 0.05, 0.55, 0.35, 0.75,
    ];
    const drive = stubRng(sequence);
    const z = rnorm(drive, 4);
    const first = rnorm(drive, 4);
    const second = rnorm(drive, 4);
    const expected = z.map((numerator, index) => {
      const chiSquare =
        (first[index] as number) ** 2 + (second[index] as number) ** 2;
      return numerator / Math.sqrt(chiSquare / 2);
    });

    expect(rt(stubRng(sequence), 4, 2)).toEqual(expected);
  });

  test("draws df + 1 rnorm batches from the generator", () => {
    // Each rnorm batch takes 2 * ceil(n / 2), so (df + 1) * 2 * ceil(n / 2).
    const odd = countingRng(stubRng([0.4, 0.6]));
    rt(odd.rng, 3, 2);
    expect(odd.count()).toBe(3 * 4);

    const even = countingRng(stubRng([0.4, 0.6]));
    rt(even.rng, 4, 5);
    expect(even.count()).toBe(6 * 4);
  });

  /**
   * Tolerance: the standard error of a sample quantile is
   * `sqrt(p(1 - p) / N) / density(q)`. At N = 200000 and df = 2 that is
   * about 0.003 at the median, 0.004 at the quartiles, 0.017 at the 5% and
   * 95% points, and 0.08 at the 1% and 99% points, where the density is
   * thin. Each bound below is about 6 of those. The loosest, 0.5 in the far
   * tail, still separates the df = 2 tail (6.96) from the df = 3 tail
   * (4.54) by almost 5 bounds.
   */
  test("matches R's qt at df = 2 over 200000 draws", () => {
    const values = rt(seededRng(21), 200000, 2);
    expectQuantilesNear(values, QT_DF2, [
      0.5, 0.1, 0.05, 0.025, 0.02, 0.025, 0.05, 0.1, 0.5,
    ]);
  });

  /**
   * Tolerance: the same rule at df = 3, where the tail density is thicker:
   * about 0.037 standard error at the 1% point, 0.011 at the 5% point,
   * 0.004 at the quartiles. Each bound is about 6 of those.
   */
  test("matches R's qt at df = 3 over 200000 draws", () => {
    const values = rt(seededRng(22), 200000, 3);
    expectQuantilesNear(values, QT_DF3, [
      0.25, 0.07, 0.04, 0.025, 0.02, 0.025, 0.04, 0.07, 0.25,
    ]);
  });

  /**
   * A large df, where the t is close to the standard normal. This catches a
   * df that is mishandled in the chi-square sum, which the small-df tests
   * could miss by luck. Tolerance: the same rule; the density at the 1%
   * point is about 0.021, for a standard error near 0.01. Each bound is
   * about 6 of those.
   */
  test("matches R's qt at df = 30 over 200000 draws", () => {
    const values = rt(seededRng(23), 200000, 30);
    expectQuantilesNear(values, QT_DF30, [
      0.07, 0.04, 0.03, 0.02, 0.02, 0.02, 0.03, 0.04, 0.07,
    ]);
  });

  test("returns an empty array for n = 0 without drawing", () => {
    const counter = countingRng(stubRng([0.5]));
    expect(rt(counter.rng, 0, 3)).toEqual([]);
    expect(counter.count()).toBe(0);
  });

  test("rejects a negative or fractional count", () => {
    expect(() => rt(stubRng([0.5]), -1, 3)).toThrow(RangeError);
    expect(() => rt(stubRng([0.5]), 2.5, 3)).toThrow(RangeError);
  });

  test("returns NaN for a df that is not a positive integer", () => {
    for (const df of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const values = rt(stubRng([0.5]), 3, df);
      expect(values).toHaveLength(3);
      expect(values.every((value) => Number.isNaN(value))).toBe(true);
    }
  });

  test("does not draw when df is invalid", () => {
    const counter = countingRng(stubRng([0.5]));
    rt(counter.rng, 4, 0);
    rt(counter.rng, 4, 2.5);
    rt(counter.rng, 4, Number.NaN);
    expect(counter.count()).toBe(0);
  });
});

describe("rlnorm", () => {
  /** The probabilities of the qlnorm fixtures below. */
  const QLNORM_PROBS = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];

  /** R 4.5.3: `qlnorm(p, 0, 1)` at the probabilities above. */
  const QLNORM_STANDARD = [
    0.097651733070336, 0.193040816698737, 0.27760624185201, 0.509416283863278,
    1, 1.96303108415826, 3.60222447927916, 5.18025160223301, 10.2404736563121,
  ];

  /** R 4.5.3: `qlnorm(p, 1, 0.5)` at the probabilities above. */
  const QLNORM_SHIFTED = [
    0.84944342590576, 1.19431546250158, 1.43221789349868, 1.94013027891803,
    2.71828182845905, 3.80853604483271, 5.15917035562259, 6.18685458819545,
    8.69870302551546,
  ];

  /**
   * The tolerance of each empirical quantile, on the log scale, for a unit
   * `sdlog`. The logarithm of a lognormal draw is normal, and a logarithm is
   * increasing, so the log of an empirical lognormal quantile *is* the
   * empirical quantile of the underlying normal. Its standard error is
   * `sqrt(p(1 - p) / N) / density(z)`, which at N = 200000 is about 0.0028 at
   * the median, 0.0031 at the quartiles, 0.0047 at the 5% and 95% points, and
   * 0.0084 at the 1% and 99% points, where the normal density is thin. Each
   * bound below is about 7 of those. A caller with another `sdlog` scales the
   * whole array by it, because `sdlog` scales the normal quantiles.
   */
  const LOG_TOLERANCE = [0.06, 0.03, 0.025, 0.02, 0.02, 0.02, 0.025, 0.03, 0.06];

  /** Assert each empirical quantile within its own tolerance, on the log scale. */
  function expectQuantilesNearOnLogScale(
    values: readonly number[],
    expected: readonly number[],
    sdlog: number,
  ): void {
    const observed = quantiles(values, QLNORM_PROBS);
    observed.forEach((value, index) => {
      const gap = Math.abs(Math.log(value) - Math.log(expected[index] as number));
      expect(gap).toBeLessThan(sdlog * (LOG_TOLERANCE[index] as number));
    });
  }

  test("is the exponential of the matching normal draws", () => {
    const sequence = [0.3, 0.7, 0.15, 0.9, 0.45, 0.6];
    const expected = rnorm(stubRng(sequence), 4, { mean: 1, sd: 0.5 }).map(
      Math.exp,
    );
    expect(rlnorm(stubRng(sequence), 4, { meanlog: 1, sdlog: 0.5 })).toEqual(
      expected,
    );
  });

  test("defaults to meanlog 0 and sdlog 1, as R does", () => {
    const sequence = [0.3, 0.7, 0.15, 0.9];
    expect(rlnorm(stubRng(sequence), 4)).toEqual(
      rlnorm(stubRng(sequence), 4, { meanlog: 0, sdlog: 1 }),
    );
    expect(rlnorm(stubRng(sequence), 4)).toEqual(
      rnorm(stubRng(sequence), 4).map(Math.exp),
    );
  });

  test("gives one seed one sequence", () => {
    expect(rlnorm(seededRng(42), 10)).toEqual(rlnorm(seededRng(42), 10));
  });

  test("gives different seeds different sequences", () => {
    expect(rlnorm(seededRng(1), 10)).not.toEqual(rlnorm(seededRng(2), 10));
  });

  test("draws in pairs, as rnorm does", () => {
    const counter = countingRng(stubRng([0.4, 0.6]));
    const values = rlnorm(counter.rng, 3);
    expect(values).toHaveLength(3);
    expect(counter.count()).toBe(4);
  });

  test("returns only positive values", () => {
    const values = rlnorm(seededRng(31), 10000);
    expect(values.every((value) => value > 0)).toBe(true);
  });

  test("matches R's qlnorm at the standard parameters over 200000 draws", () => {
    const values = rlnorm(seededRng(32), 200000);
    expectQuantilesNearOnLogScale(values, QLNORM_STANDARD, 1);
  });

  test("matches R's qlnorm at meanlog 1 and sdlog 0.5 over 200000 draws", () => {
    const values = rlnorm(seededRng(33), 200000, { meanlog: 1, sdlog: 0.5 });
    expectQuantilesNearOnLogScale(values, QLNORM_SHIFTED, 0.5);
  });

  test("returns exp(meanlog) throughout when sdlog is 0", () => {
    const values = rlnorm(stubRng([0.25, 0.5]), 2, { meanlog: 1, sdlog: 0 });
    expect(values).toEqual([Math.E, Math.E]);
  });

  test("returns an empty array for n = 0 without drawing", () => {
    const counter = countingRng(stubRng([0.5]));
    expect(rlnorm(counter.rng, 0)).toEqual([]);
    expect(counter.count()).toBe(0);
  });

  test("returns NaN for a negative sdlog, like R", () => {
    const values = rlnorm(stubRng([0.5]), 2, { sdlog: -1 });
    expect(values).toHaveLength(2);
    expect(values.every((value) => Number.isNaN(value))).toBe(true);
  });

  test("does not draw when the parameters are invalid", () => {
    const counter = countingRng(stubRng([0.5]));
    rlnorm(counter.rng, 4, { sdlog: -1 });
    rlnorm(counter.rng, 4, { meanlog: Number.NaN });
    expect(counter.count()).toBe(0);
  });

  test("rejects a negative or fractional count", () => {
    expect(() => rlnorm(stubRng([0.5]), -2)).toThrow(RangeError);
    expect(() => rlnorm(stubRng([0.5]), 1.5)).toThrow(RangeError);
  });
});

describe("rcauchy", () => {
  /**
   * The probabilities of the qcauchy fixtures below. The Cauchy has no mean
   * and no variance, so the statistical tests below check robust quantiles
   * only: median, quartiles, and deciles. The 1% and 99% points sit near
   * ±32, where the density is so thin that a sample quantile is too noisy
   * to pin.
   */
  const QCAUCHY_PROBS = [0.1, 0.25, 0.5, 0.75, 0.9];

  /** R 4.5.3: `qcauchy(p)` at the probabilities above. */
  const QCAUCHY_STANDARD = [
    -3.07768353717525, -1, 0, 1, 3.07768353717525,
  ];

  /** R 4.5.3: `qcauchy(p, location = 5, scale = 2)` at the probabilities above. */
  const QCAUCHY_SHIFTED = [
    -1.15536707435051, 3, 5, 7, 11.15536707435051,
  ];

  /**
   * The tolerance of each empirical quantile at unit scale. The standard
   * error of a sample quantile is `sqrt(p(1 - p) / N) / density(q)`. At
   * N = 200000 the Cauchy density gives about 0.0035 at the median, 0.0061
   * at the quartiles, and 0.022 at the deciles, where the density has
   * thinned to 0.030. Each bound below is about 7 of those. A caller with
   * another `scale` multiplies the whole array by it, because `scale`
   * multiplies the quantiles.
   */
  const QCAUCHY_TOLERANCE = [0.16, 0.045, 0.025, 0.045, 0.16];

  /** Assert each empirical quantile within its own scaled tolerance. */
  function expectQuantilesNear(
    values: readonly number[],
    expected: readonly number[],
    scale: number,
  ): void {
    const observed = quantiles(values, QCAUCHY_PROBS);
    observed.forEach((value, index) => {
      const gap = Math.abs(value - (expected[index] as number));
      expect(gap).toBeLessThan(scale * (QCAUCHY_TOLERANCE[index] as number));
    });
  }

  test("transforms each draw with the inverse rule", () => {
    const sequence = [0.25, 0.5, 0.75, 0.9];
    const expected = sequence.map((u) => Math.tan(Math.PI * (u - 0.5)));
    expect(rcauchy(stubRng(sequence), 4)).toEqual(expected);
  });

  test("shifts and scales by location and scale", () => {
    const sequence = [0.25, 0.5, 0.75];
    const raw = rcauchy(stubRng(sequence), 3);
    const scaled = rcauchy(stubRng(sequence), 3, { location: 5, scale: 2 });
    expect(scaled).toEqual(raw.map((value) => 5 + 2 * value));
  });

  test("defaults to location 0 and scale 1, as R does", () => {
    const sequence = [0.3, 0.7, 0.15];
    expect(rcauchy(stubRng(sequence), 3)).toEqual(
      rcauchy(stubRng(sequence), 3, { location: 0, scale: 1 }),
    );
  });

  test("returns the location when scale is 0, as R does", () => {
    expect(rcauchy(stubRng([0.25, 0.9]), 2, { location: 7, scale: 0 })).toEqual(
      [7, 7],
    );
  });

  test("gives one seed one sequence", () => {
    expect(rcauchy(seededRng(42), 10)).toEqual(rcauchy(seededRng(42), 10));
  });

  test("gives different seeds different sequences", () => {
    expect(rcauchy(seededRng(1), 10)).not.toEqual(rcauchy(seededRng(2), 10));
  });

  test("draws exactly once per value", () => {
    const counter = countingRng(stubRng([0.4]));
    const values = rcauchy(counter.rng, 5);
    expect(values).toHaveLength(5);
    expect(counter.count()).toBe(5);
  });

  test("matches R's qcauchy at the standard parameters over 200000 draws", () => {
    const values = rcauchy(seededRng(51), 200000);
    expectQuantilesNear(values, QCAUCHY_STANDARD, 1);
  });

  test("matches R's qcauchy at location 5 and scale 2 over 200000 draws", () => {
    const values = rcauchy(seededRng(52), 200000, { location: 5, scale: 2 });
    expectQuantilesNear(values, QCAUCHY_SHIFTED, 2);
  });

  test("returns an empty array for n = 0 without drawing", () => {
    const counter = countingRng(stubRng([0.5]));
    expect(rcauchy(counter.rng, 0)).toEqual([]);
    expect(counter.count()).toBe(0);
  });

  test("returns NaN for a negative scale, like R", () => {
    const values = rcauchy(stubRng([0.5]), 2, { scale: -1 });
    expect(values).toHaveLength(2);
    expect(values.every((value) => Number.isNaN(value))).toBe(true);
  });

  test("returns NaN for a non-finite parameter, like R", () => {
    expect(rcauchy(stubRng([0.5]), 1, { location: Number.NaN })[0]).toBeNaN();
    expect(
      rcauchy(stubRng([0.5]), 1, { scale: Number.POSITIVE_INFINITY })[0],
    ).toBeNaN();
  });

  test("does not draw when the parameters are invalid", () => {
    const counter = countingRng(stubRng([0.5]));
    rcauchy(counter.rng, 4, { scale: -1 });
    rcauchy(counter.rng, 4, { location: Number.NaN });
    expect(counter.count()).toBe(0);
  });

  test("rejects a negative or fractional count", () => {
    expect(() => rcauchy(stubRng([0.5]), -2)).toThrow(RangeError);
    expect(() => rcauchy(stubRng([0.5]), 1.5)).toThrow(RangeError);
  });
});

describe("sampleWithoutReplacement", () => {
  const letters = ["a", "b", "c", "d"] as const;

  /**
   * Partial Fisher-Yates. Step i takes one draw and swaps position i with
   * position `i + floor(u * (n - i))`, so the draw at step i selects from the
   * values that no earlier step took.
   */
  test("follows the documented swap pattern", () => {
    // Step 0: u = 0   -> j = 0, no swap.        pool a b c d
    // Step 1: u = 0.5 -> j = 1 + 1 = 2, swap.   pool a c b d
    const drawn = sampleWithoutReplacement(stubRng([0, 0.5]), letters, 2);
    expect(drawn).toEqual(["a", "c"]);
  });

  test("can select the last value", () => {
    const drawn = sampleWithoutReplacement(stubRng([0.999]), letters, 1);
    expect(drawn).toEqual(["d"]);
  });

  test("draws exactly once per selected value", () => {
    const counter = countingRng(stubRng([0.5]));
    sampleWithoutReplacement(counter.rng, letters, 3);
    expect(counter.count()).toBe(3);
  });

  test("returns every value when k is the population size", () => {
    const drawn = sampleWithoutReplacement(seededRng(3), letters, 4);
    expect(drawn).toHaveLength(4);
    expect([...drawn].sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("takes no value twice", () => {
    const population = Array.from({ length: 200 }, (_unused, index) => index);
    const drawn = sampleWithoutReplacement(seededRng(4), population, 50);
    expect(new Set(drawn).size).toBe(50);
  });

  test("returns an empty array for k = 0 without drawing", () => {
    const counter = countingRng(stubRng([0.5]));
    expect(sampleWithoutReplacement(counter.rng, letters, 0)).toEqual([]);
    expect(counter.count()).toBe(0);
  });

  test("accepts an empty population when k is 0", () => {
    expect(sampleWithoutReplacement(stubRng([0.5]), [], 0)).toEqual([]);
  });

  test("rejects a sample larger than the population, like R", () => {
    expect(() => sampleWithoutReplacement(stubRng([0.5]), letters, 5)).toThrow(
      RangeError,
    );
  });

  test("rejects a negative or fractional k", () => {
    expect(() => sampleWithoutReplacement(stubRng([0.5]), letters, -1)).toThrow(
      RangeError,
    );
    expect(() => sampleWithoutReplacement(stubRng([0.5]), letters, 1.5)).toThrow(
      RangeError,
    );
  });

  test("does not modify the population", () => {
    const population = ["a", "b", "c", "d"];
    sampleWithoutReplacement(seededRng(5), population, 4);
    expect(population).toEqual(["a", "b", "c", "d"]);
  });

  test("keeps values of any type", () => {
    const points = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const drawn = sampleWithoutReplacement(seededRng(6), points, 2);
    expect(drawn.every((point) => points.includes(point))).toBe(true);
  });
});

describe("core purity", () => {
  test("the module does not use Math.random", async () => {
    const source = await Bun.file(`${import.meta.dir}/rng.ts`).text();
    expect(source).not.toInclude("Math.random");
  });
});
