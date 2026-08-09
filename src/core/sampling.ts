/**
 * Drawing samples and reading confidence intervals off them — the statistics
 * of `plot_sampling()` and `plot_sample_ci()` in `../compstatslib/R/`.
 *
 * Both demonstrations rest on the same idea: a statistic computed from a
 * sample is itself a random quantity, and drawing many samples shows how it
 * scatters. `plot_sampling()` draws repeatedly and accumulates the statistic;
 * `plot_sample_ci()` draws once and asks how often an interval built from a
 * sample covers the mean it was drawn from.
 *
 * Two rules shape this module, both from the port plan:
 *
 * - **The generator is an argument, and one call threads one generator.** R
 *   reads a global stream, which a pure core cannot. `drawSamples` takes
 *   exactly `reps * sampleSize` values from the generator it is given, in
 *   draw order, so a caller who holds the generator can keep drawing where
 *   the last call stopped. Restarting the generator per repetition would
 *   return the same sample every time.
 * - **Accumulation belongs to the caller.** R's `plot_sampling()` returns a
 *   `vars` list holding every statistic drawn so far, and its interactive
 *   wrapper hands that back on the next call. This module takes one draw's
 *   inputs and returns one draw's outputs; nothing is kept between calls.
 *
 * Verified against R 4.5.3 in `sampling.test.ts` for the interval arithmetic.
 * The drawn values cannot be checked against R and are not meant to be: a
 * seeded JavaScript generator does not reproduce R's Mersenne Twister.
 */

import { mean, requireCount, sd } from "./arith";
import { rnorm, sampleWithoutReplacement, type Rng } from "./rng";

/** R's hardcoded 95% multiplier in `plot_sample_ci()`. Not `qnorm(0.975)`. */
const CI95_MULTIPLIER = 1.96;

/** R's hardcoded 99% multiplier. Not `qnorm(0.995)`, which is 2.5758. */
const CI99_MULTIPLIER = 2.58;

/** The defaults of R's `plot_sample_ci()`. */
const DEFAULT_POP_SIZE = 10000;
const DEFAULT_NUM_SAMPLES = 100;
const DEFAULT_SAMPLE_SIZE = 100;

/** What one call to `drawSamples` should do. */
export interface DrawSamplesOptions {
  /** How many values to take per sample. R's `sample_size`. */
  readonly sampleSize: number;
  /** How many samples to draw in this call. R's `reps`, default 1. */
  readonly reps?: number;
  /**
   * The statistic to compute from each sample. R's `theta`, default the mean.
   * Any function of a sample will do — the median, a trimmed mean, a range.
   */
  readonly theta?: (sample: readonly number[]) => number;
}

/** One draw: the samples themselves and the statistic of each. */
export interface SampleDraw {
  /**
   * The samples, in draw order. R holds these as the columns of a matrix, so
   * flattening this array gives the same order R's `as.vector()` does — which
   * is what to hand `kernelDensity` when pooling them.
   */
  readonly samples: readonly (readonly number[])[];
  /** The statistic of each sample, in the same order. */
  readonly thetas: readonly number[];
}

/** A pair of bounds. */
export interface Interval {
  readonly low: number;
  readonly high: number;
}

/** What one sample says about the mean it was drawn from. */
export interface SampleInterval {
  /** The sample mean. */
  readonly mean: number;
  /** The sample standard deviation, with R's n − 1 denominator. */
  readonly sd: number;
  /** The standard error, `sd / sqrt(sampleSize)`. */
  readonly standardError: number;
  /** The 95% interval, `mean ± 1.96 * standardError`. */
  readonly ci95: Interval;
  /** The 99% interval, `mean ± 2.58 * standardError`. */
  readonly ci99: Interval;
  /**
   * Whether either interval misses the population mean — R's `bad` set, one
   * sample at a time. R collects the positions where this holds.
   */
  readonly excludesPopulationMean: boolean;
}

/** How to simulate a population. R's `distr_func` with its `...` bound in. */
export type DistributionFn = (rng: Rng, n: number) => number[];

/** What one call to `simulateSampleCi` should do. R's own defaults. */
export interface SampleCiOptions {
  /** How many samples to draw. R's `num_samples`, default 100. */
  readonly numSamples?: number;
  /** How many values per sample. R's `sample_size`, default 100. */
  readonly sampleSize?: number;
  /** How many values in the simulated population. R's `pop_size`, 10000. */
  readonly popSize?: number;
  /**
   * How to draw the population. R's `distr_func`, default `rnorm` with its
   * own defaults, a standard normal. A caller who wants R's
   * `plot_sample_ci(distr_func = runif, min = 17, max = 35)` passes
   * `(rng, n) => runif(rng, n, { min: 17, max: 35 })`, which is what R's
   * `...` pass-through amounts to.
   */
  readonly distribution?: DistributionFn;
}

/** The simulated population's statistics and every sample's interval. */
export interface SampleCiSimulation {
  /** The mean of the drawn population. R draws its vertical line here. */
  readonly populationMean: number;
  /** The spread of the drawn population. R's window is this wide, halved. */
  readonly populationSd: number;
  /** One entry per sample, in draw order. */
  readonly intervals: readonly SampleInterval[];
}

/**
 * Draw samples from a population and compute a statistic from each.
 *
 * This is R's `replicate(reps, sample(population, sample_size))` followed by
 * `apply(samples, FUN = theta, MARGIN = 2)`. Sampling is without replacement,
 * as R's `sample()` is by default, so a value appears at most once within a
 * sample — though the same value can appear in several samples.
 *
 * @param rng The source of randomness. The call takes exactly
 *   `reps * sampleSize` values from it.
 * @param population The values to draw from. The function does not modify
 *   them.
 * @param options The sample size, how many samples, and the statistic.
 * @returns The samples in draw order and the statistic of each.
 * @throws RangeError If `reps` or `sampleSize` is negative or fractional, or
 *   if `sampleSize` is larger than the population — the last from
 *   `sampleWithoutReplacement`, which is where R's own refusal lives.
 */
export function drawSamples(
  rng: Rng,
  population: readonly number[],
  options: DrawSamplesOptions,
): SampleDraw {
  const { sampleSize, reps = 1, theta = mean } = options;
  requireCount(reps, "reps");

  // Array.from calls its builder once per index, in order, so the samples
  // come off the one generator in draw order.
  const samples = Array.from({ length: reps }, () =>
    sampleWithoutReplacement(rng, population, sampleSize),
  );

  return { samples, thetas: samples.map((sample) => theta(sample)) };
}

/**
 * Read a confidence interval off each sample.
 *
 * The multipliers are R's own literal 1.96 and 2.58, not quantiles of any
 * distribution. That matters: 2.58 is not `qnorm(0.995)` to more than three
 * digits, and a port that "corrected" it would draw slightly different bars
 * from the R original the demonstration is taught beside.
 *
 * A sample of one gives NaN throughout, because its standard deviation is
 * undefined — R reports NA there and drops it from the `bad` set, and NaN
 * comparisons being false does the same thing here.
 *
 * @param samples The samples, each already drawn.
 * @param populationMean The mean the samples were drawn from, which the
 *   intervals are asked to cover.
 * @returns One entry per sample, in the order given.
 */
export function sampleConfidenceIntervals(
  samples: readonly (readonly number[])[],
  populationMean: number,
): SampleInterval[] {
  return samples.map((sample) => {
    const center = mean(sample);
    const spread = sd(sample);
    const standardError = spread / Math.sqrt(sample.length);
    const ci95 = spreadAround(center, standardError, CI95_MULTIPLIER);
    const ci99 = spreadAround(center, standardError, CI99_MULTIPLIER);

    return {
      mean: center,
      sd: spread,
      standardError,
      ci95,
      ci99,
      // R's four-way test, kept whole. The 99% interval contains the 95% one,
      // so only the 95% pair can fire, but this is what R asks and reading it
      // back to R's source should not need an argument about which half is
      // redundant.
      excludesPopulationMean:
        ci95.low > populationMean ||
        ci95.high < populationMean ||
        ci99.low > populationMean ||
        ci99.high < populationMean,
    };
  });
}

/** Build an interval of so many standard errors around a center. */
function spreadAround(
  center: number,
  standardError: number,
  multiplier: number,
): Interval {
  return {
    low: center - standardError * multiplier,
    high: center + standardError * multiplier,
  };
}

/**
 * Simulate a population, sample it many times, and interval each sample.
 *
 * This is the whole of `plot_sample_ci()` except the drawing. The population
 * is simulated rather than given, which is the point of the demonstration:
 * the true mean is known, so a student can count how many intervals miss it.
 *
 * The call takes the population's draws from the generator first, then each
 * sample's, so a caller replaying one seed gets one simulation.
 *
 * @param rng The source of randomness, threaded through the whole call.
 * @param options The sizes and the population's distribution.
 * @returns The population's mean and spread, and every sample's interval.
 * @throws RangeError If a count is negative or fractional, or if the sample
 *   size is larger than the population.
 */
export function simulateSampleCi(
  rng: Rng,
  options: SampleCiOptions = {},
): SampleCiSimulation {
  const {
    numSamples = DEFAULT_NUM_SAMPLES,
    sampleSize = DEFAULT_SAMPLE_SIZE,
    popSize = DEFAULT_POP_SIZE,
    distribution = standardNormal,
  } = options;
  requireCount(numSamples, "numSamples");
  requireCount(popSize, "popSize");

  const population = distribution(rng, popSize);
  const populationMean = mean(population);
  const { samples } = drawSamples(rng, population, {
    sampleSize,
    reps: numSamples,
  });

  return {
    populationMean,
    populationSd: sd(population),
    intervals: sampleConfidenceIntervals(samples, populationMean),
  };
}

/** R's default `distr_func`, `rnorm` with its own defaults. */
function standardNormal(rng: Rng, n: number): number[] {
  return rnorm(rng, n);
}
