/**
 * Tests for the sampling core: the per-draw sampling of `plot_sampling()` and
 * the confidence-interval arithmetic of `plot_sample_ci()`, both in
 * `../compstatslib/R/`.
 *
 * The confidence-interval expected values come from R 4.5.3 at full double
 * precision, `.claude/plans/001-PLAN-port/sampling-fixtures.md` Section 4, over a fixed
 * five-sample matrix. Nothing about the *drawn* values can be checked against
 * R — a seeded JavaScript generator does not reproduce R's Mersenne Twister,
 * and the port does not try to. What is checked instead is that the draws
 * come from the population, that one seed always gives one result, and that a
 * call takes an exactly known number of values from the generator, so a later
 * refactor cannot quietly reorder or repeat draws.
 *
 * The R code being ported:
 *
 * ```r
 * # plot_sampling(): one draw of `reps` samples, and their statistics
 * samples    <- replicate(reps, sample(population, sample_size))
 * reps_theta <- apply(samples, FUN = theta, MARGIN = 2)
 *
 * # plot_sample_ci(): the arithmetic pinned in Section 4
 * sample_stderrs <- sample_stdevs / sqrt(sample_size)
 * ci95_low  <- sample_means - sample_stderrs * 1.96
 * ci99_high <- sample_means + sample_stderrs * 2.58
 * bad <- which(((ci95_low > pop_mean) | (ci95_high < pop_mean)) |
 *              ((ci99_low > pop_mean) | (ci99_high < pop_mean)))
 * ```
 */

import { describe, expect, test } from "bun:test";

import { mean, quantile } from "./arith";
import { seededRng, type Rng } from "./rng";
import {
  drawSamples,
  sampleConfidenceIntervals,
  simulateSampleCi,
} from "./sampling";

/** Relative tolerance for comparisons against R, as in the other slices. */
const RELATIVE_TOLERANCE = 1e-12;

/** Assert that a value agrees with R to `RELATIVE_TOLERANCE`. */
function expectCloseToR(actual: number, expected: number): void {
  const bound = RELATIVE_TOLERANCE * Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(bound);
}

/** A generator that counts how many values were taken from it. */
function countingRng(source: Rng = () => 0): { rng: Rng; taken: () => number } {
  let taken = 0;
  return {
    rng: () => {
      taken += 1;
      return source();
    },
    taken: () => taken,
  };
}

/**
 * A generator that always returns 0.
 *
 * With it the partial shuffle of `sampleWithoutReplacement` swaps each
 * position with itself, so a sample is the first values of the population in
 * their original order. That makes a draw predictable without pinning the
 * generator's own arithmetic.
 */
const zeroRng: Rng = () => 0;

describe("drawSamples", () => {
  const population = [10, 20, 30, 40, 50, 60, 70, 80];

  test("draws the asked-for shape", () => {
    const draw = drawSamples(seededRng(1), population, {
      sampleSize: 3,
      reps: 4,
    });

    expect(draw.samples).toHaveLength(4);
    draw.samples.forEach((sample) => expect(sample).toHaveLength(3));
    expect(draw.thetas).toHaveLength(4);
  });

  test("draws without replacement, from the population only", () => {
    const draw = drawSamples(seededRng(7), population, {
      sampleSize: 5,
      reps: 6,
    });

    draw.samples.forEach((sample) => {
      sample.forEach((value) => expect(population).toContain(value));
      expect(new Set(sample).size).toBe(sample.length);
    });
  });

  test("defaults to one repetition and the mean", () => {
    const draw = drawSamples(zeroRng, population, { sampleSize: 4 });

    expect(draw.samples).toEqual([[10, 20, 30, 40]]);
    expect(draw.thetas).toEqual([25]);
  });

  test("takes any statistic as theta", () => {
    const median = (sample: readonly number[]) => quantile(sample, 0.5);
    const draw = drawSamples(seededRng(3), population, {
      sampleSize: 5,
      reps: 3,
      theta: median,
    });

    expect(draw.thetas).toEqual(draw.samples.map(median));
    // A statistic of the caller's own, to show theta is not special-cased.
    const widest = drawSamples(zeroRng, population, {
      sampleSize: 4,
      reps: 2,
      theta: (sample) => Math.max(...sample) - Math.min(...sample),
    });
    expect(widest.thetas).toEqual([30, 30]);
  });

  test("takes exactly sampleSize values from the generator per repetition", () => {
    // Pinned so a later change cannot reorder or repeat draws unnoticed.
    const { rng, taken } = countingRng();
    drawSamples(rng, population, { sampleSize: 3, reps: 5 });

    expect(taken()).toBe(15);
  });

  test("threads one generator through the whole draw", () => {
    // R draws every repetition from one stream; a port that restarted the
    // generator per repetition would return the same sample each time.
    const draw = drawSamples(seededRng(11), population, {
      sampleSize: 4,
      reps: 3,
    });
    const distinct = new Set(draw.samples.map((sample) => sample.join(",")));

    expect(distinct.size).toBeGreaterThan(1);
  });

  test("carries on from where the generator was left", () => {
    const rng = seededRng(5);
    const first = drawSamples(rng, population, { sampleSize: 4 });
    const second = drawSamples(rng, population, { sampleSize: 4 });

    expect(second.samples[0]).not.toEqual(first.samples[0] as number[]);
  });

  test("gives the same draw for the same seed", () => {
    const options = { sampleSize: 4, reps: 3 };

    expect(drawSamples(seededRng(42), population, options)).toEqual(
      drawSamples(seededRng(42), population, options),
    );
  });

  test("returns nothing for no repetitions", () => {
    const draw = drawSamples(zeroRng, population, { sampleSize: 3, reps: 0 });

    expect(draw.samples).toEqual([]);
    expect(draw.thetas).toEqual([]);
  });

  test("refuses a repetition count that is negative or fractional", () => {
    expect(() =>
      drawSamples(zeroRng, population, { sampleSize: 3, reps: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      drawSamples(zeroRng, population, { sampleSize: 3, reps: 2.5 }),
    ).toThrow(RangeError);
  });

  test("refuses a sample larger than the population", () => {
    // The refusal comes from sampleWithoutReplacement, as R's sample() does.
    expect(() =>
      drawSamples(zeroRng, population, { sampleSize: 9 }),
    ).toThrow(RangeError);
  });

  test("does not modify the population", () => {
    const held = [...population];
    drawSamples(seededRng(9), population, { sampleSize: 5, reps: 3 });

    expect(population).toEqual(held);
  });
});

describe("sampleConfidenceIntervals, the fixture of Section 4", () => {
  // R: matrix(c(48,51,50,49, 55,57,54,56, 50,50,51,49, 44,46,43,45,
  //             49,52,48,51), nrow = 4), one column per sample.
  const samples = [
    [48, 51, 50, 49],
    [55, 57, 54, 56],
    [50, 50, 51, 49],
    [44, 46, 43, 45],
    [49, 52, 48, 51],
  ];
  const populationMean = 50;
  const intervals = sampleConfidenceIntervals(samples, populationMean);

  interface Expected {
    readonly mean: number;
    readonly sd: number;
    readonly standardError: number;
    readonly ci95Low: number;
    readonly ci95High: number;
    readonly ci99Low: number;
    readonly ci99High: number;
    readonly excludes: boolean;
  }

  const expected: readonly Expected[] = [
    {
      mean: 49.5,
      sd: 1.2909944487358056,
      standardError: 0.6454972243679028,
      ci95Low: 48.234825440238907,
      ci95High: 50.765174559761093,
      ci99Low: 47.834617161130808,
      ci99High: 51.165382838869192,
      excludes: false,
    },
    {
      mean: 55.5,
      sd: 1.2909944487358056,
      standardError: 0.6454972243679028,
      ci95Low: 54.234825440238907,
      ci95High: 56.765174559761093,
      ci99Low: 53.834617161130808,
      ci99High: 57.165382838869192,
      excludes: true,
    },
    {
      mean: 50,
      sd: 0.81649658092772603,
      standardError: 0.40824829046386302,
      ci95Low: 49.199833350690831,
      ci95High: 50.800166649309169,
      ci99Low: 48.946719410603237,
      ci99High: 51.053280589396763,
      excludes: false,
    },
    {
      mean: 44.5,
      sd: 1.2909944487358056,
      standardError: 0.6454972243679028,
      ci95Low: 43.234825440238907,
      ci95High: 45.765174559761093,
      ci99Low: 42.834617161130808,
      ci99High: 46.165382838869192,
      excludes: true,
    },
    {
      mean: 50,
      sd: 1.8257418583505538,
      standardError: 0.9128709291752769,
      ci95Low: 48.210772978816458,
      ci95High: 51.789227021183542,
      ci99Low: 47.644793002727788,
      ci99High: 52.355206997272212,
      excludes: false,
    },
  ];

  test("returns one interval per sample", () => {
    expect(intervals).toHaveLength(5);
  });

  expected.forEach((want, index) => {
    test(`matches R on sample ${index + 1}`, () => {
      const got = intervals[index] as (typeof intervals)[number];

      expectCloseToR(got.mean, want.mean);
      expectCloseToR(got.sd, want.sd);
      expectCloseToR(got.standardError, want.standardError);
      expectCloseToR(got.ci95.low, want.ci95Low);
      expectCloseToR(got.ci95.high, want.ci95High);
      expectCloseToR(got.ci99.low, want.ci99Low);
      expectCloseToR(got.ci99.high, want.ci99High);
      expect(got.excludesPopulationMean).toBe(want.excludes);
    });
  });

  test("marks samples 2 and 4 as the ones that miss the mean", () => {
    // R: which(...) is 1-based and gives c(2, 4).
    const missed = intervals
      .map((interval, index) => (interval.excludesPopulationMean ? index + 1 : 0))
      .filter((position) => position > 0);

    expect(missed).toEqual([2, 4]);
  });

  test("uses R's hardcoded 1.96 and 2.58, not a t or normal quantile", () => {
    const first = intervals[0] as (typeof intervals)[number];

    expect(first.ci95.low).toBe(first.mean - first.standardError * 1.96);
    expect(first.ci95.high).toBe(first.mean + first.standardError * 1.96);
    expect(first.ci99.low).toBe(first.mean - first.standardError * 2.58);
    expect(first.ci99.high).toBe(first.mean + first.standardError * 2.58);
  });
});

describe("sampleConfidenceIntervals, edges", () => {
  test("returns nothing for no samples", () => {
    expect(sampleConfidenceIntervals([], 50)).toEqual([]);
  });

  test("reports NaN for a sample of one, where R reports NA", () => {
    // R's sd() of one value is NA, and every interval built on it is NA too.
    const [only] = sampleConfidenceIntervals([[50]], 50);
    const interval = only as NonNullable<typeof only>;

    expect(interval.mean).toBe(50);
    expect(interval.sd).toBeNaN();
    expect(interval.standardError).toBeNaN();
    expect(interval.ci95.low).toBeNaN();
    expect(interval.ci99.high).toBeNaN();
  });

  test("does not call a NaN interval a miss, matching R's which()", () => {
    // Every comparison against NaN is false, so the sample is not counted as
    // missing the mean. R's which() drops the NA the same way.
    const [only] = sampleConfidenceIntervals([[50]], 999);

    expect((only as NonNullable<typeof only>).excludesPopulationMean).toBe(false);
  });

  test("marks a sample whose wider interval alone misses the mean", () => {
    // The 99% interval contains the 95% one, so R's four-way OR can only fire
    // through the 95% pair. This pins that the OR is still read in full.
    const [only] = sampleConfidenceIntervals([[10, 12, 11, 13]], 50);

    expect((only as NonNullable<typeof only>).excludesPopulationMean).toBe(true);
  });
});

describe("simulateSampleCi", () => {
  test("uses R's defaults: 100 samples of 100 from a population of 10000", () => {
    const { rng, taken } = countingRng(seededRng(2));
    const result = simulateSampleCi(rng);

    expect(result.intervals).toHaveLength(100);
    expect(Number.isFinite(result.populationMean)).toBe(true);
    expect(Number.isFinite(result.populationSd)).toBe(true);
    // 10000 normal values take 10000 draws, then 100 samples of 100.
    expect(taken()).toBe(10000 + 100 * 100);
  });

  test("draws the population from the given distribution", () => {
    const result = simulateSampleCi(zeroRng, {
      popSize: 6,
      numSamples: 2,
      sampleSize: 3,
      distribution: (_rng, n) => Array.from({ length: n }, (_, i) => i + 1),
    });

    // The zero generator leaves the population in order, so each sample is
    // its first three values.
    expect(result.populationMean).toBe(3.5);
    expectCloseToR(result.populationSd, 1.8708286933869707);
    expect(result.intervals).toHaveLength(2);
    expect((result.intervals[0] as (typeof result.intervals)[number]).mean).toBe(2);
  });

  test("takes the population draws before the sample draws", () => {
    const { rng, taken } = countingRng();
    simulateSampleCi(rng, { popSize: 20, numSamples: 3, sampleSize: 4 });

    // 20 normal values take 20 draws, then 3 samples of 4.
    expect(taken()).toBe(20 + 3 * 4);
  });

  test("gives the same simulation for the same seed", () => {
    const options = { popSize: 200, numSamples: 5, sampleSize: 10 };

    expect(simulateSampleCi(seededRng(4), options)).toEqual(
      simulateSampleCi(seededRng(4), options),
    );
  });

  test("reports the population mean and spread it actually drew", () => {
    const population = [2, 4, 4, 4, 5, 5, 7, 9];
    const result = simulateSampleCi(zeroRng, {
      popSize: population.length,
      numSamples: 1,
      sampleSize: 4,
      distribution: () => [...population],
    });

    expect(result.populationMean).toBe(mean(population));
    expectCloseToR(result.populationSd, 2.1380899352993952);
  });

  test("returns nothing for no samples", () => {
    const result = simulateSampleCi(zeroRng, { numSamples: 0, popSize: 10 });

    expect(result.intervals).toEqual([]);
  });

  test("refuses counts that are negative or fractional", () => {
    expect(() => simulateSampleCi(zeroRng, { numSamples: -1 })).toThrow(RangeError);
    expect(() => simulateSampleCi(zeroRng, { numSamples: 1.5 })).toThrow(RangeError);
    expect(() => simulateSampleCi(zeroRng, { popSize: 2.5 })).toThrow(RangeError);
  });

  test("refuses a sample larger than the population", () => {
    expect(() =>
      simulateSampleCi(zeroRng, { popSize: 10, sampleSize: 20, numSamples: 1 }),
    ).toThrow(RangeError);
  });
});
