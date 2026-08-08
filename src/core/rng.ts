/**
 * Seedable random draws for the sampling demonstrations.
 *
 * R gets these from `runif()`, `rnorm()`, and `sample()`, which all read one
 * global Mersenne Twister stream. This port makes the generator an argument
 * instead. A pure core cannot hold a stream, and a demonstration that a
 * student reloads must show the same numbers.
 *
 * The generator does not reproduce R's stream. No JavaScript generator does,
 * and the port plan does not ask for it. The requirement is that one seed
 * always gives one sequence, in this run and in every later run.
 *
 * The generator is mulberry32 (Tommy Ettinger, public domain): 32 bits of
 * state, four integer operations per draw, a period of 2^32, and a published
 * result on the gjrand test suite. It is small enough to read in full below,
 * which matters more here than statistical strength — these draws teach the
 * sampling distribution, they do not protect anything. Do not use this module
 * for cryptography.
 */

import { requireCount, sum } from "./arith";

/** A source of uniform values in the interval [0, 1). */
export type Rng = () => number;

/** The parameters of `runif`. The defaults are the defaults of R's `runif`. */
export interface RunifOptions {
  /** The low end of the interval. */
  readonly min?: number;
  /** The high end of the interval. The generator never returns it. */
  readonly max?: number;
}

/** The parameters of `rnorm`. The defaults are the defaults of R's `rnorm`. */
export interface RnormOptions {
  /** The center of the distribution. */
  readonly mean?: number;
  /** The standard deviation. A negative value gives NaN, as in R. */
  readonly sd?: number;
}

/**
 * The parameters of `rlnorm`. The defaults are the defaults of R's `rlnorm`.
 *
 * Both name the normal distribution behind the exponential, not the lognormal
 * distribution itself.
 */
export interface RlnormOptions {
  /** The center of the normal behind the exponential. */
  readonly meanlog?: number;
  /**
   * The standard deviation of the normal behind the exponential. A negative
   * value gives NaN, as in R.
   */
  readonly sdlog?: number;
}

/**
 * Make a generator from a seed.
 *
 * Two generators of one seed give the same sequence. The seed keeps only its
 * integer part, and only the low 32 bits of that.
 *
 * @param seed The start state. It must be finite.
 * @returns A generator of uniform values in [0, 1).
 * @throws RangeError If the seed is not finite.
 */
export function seededRng(seed: number): Rng {
  if (!Number.isFinite(seed)) {
    throw new RangeError(`seed must be finite, got ${seed}`);
  }

  let state = Math.trunc(seed) | 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw uniform values.
 *
 * The function takes one value from the generator for each result, in order.
 *
 * An interval with `min` above `max`, or with a bound that is not finite,
 * gives NaN for every result and takes nothing from the generator. R does the
 * same, with a warning that a library cannot give.
 *
 * @param rng The source of randomness.
 * @param n How many values to draw. It must be a non-negative integer.
 * @param options The interval. The default is [0, 1).
 * @returns The drawn values.
 * @throws RangeError If n is negative or is not an integer.
 */
export function runif(
  rng: Rng,
  n: number,
  options: RunifOptions = {},
): number[] {
  requireCount(n, "n");
  const { min = 0, max = 1 } = options;

  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    return new Array<number>(n).fill(Number.NaN);
  }

  return Array.from({ length: n }, () => min + (max - min) * rng());
}

/**
 * Draw normal values.
 *
 * The function uses the Box-Muller transform, which makes two independent
 * standard normal values from two uniform values. It takes the values in
 * pairs: the first value of a pair gives the radius, the second gives the
 * angle. An odd count discards the second value of the last pair, so the
 * count of draws from the generator is always `2 * ceil(n / 2)`.
 *
 * The radius is `sqrt(-2 * log(1 - u))`, not `sqrt(-2 * log(u))`. The
 * generator can return an exact 0 but never returns 1, and `log(0)` is not
 * finite. The subtraction moves the open end of the interval to the point
 * where the logarithm needs it.
 *
 * A `mean` that is not finite, or an `sd` that is negative or not finite,
 * gives NaN for every result and takes nothing from the generator, as in R.
 *
 * @param rng The source of randomness.
 * @param n How many values to draw. It must be a non-negative integer.
 * @param options The center and the spread. The default is the standard
 *   normal distribution.
 * @returns The drawn values.
 * @throws RangeError If n is negative or is not an integer.
 */
export function rnorm(
  rng: Rng,
  n: number,
  options: RnormOptions = {},
): number[] {
  requireCount(n, "n");
  const { mean = 0, sd = 1 } = options;

  if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd < 0) {
    return new Array<number>(n).fill(Number.NaN);
  }

  const pairs = Array.from({ length: Math.ceil(n / 2) }, () =>
    standardNormalPair(rng),
  );
  return pairs
    .flat()
    .slice(0, n)
    .map((z) => mean + sd * z);
}

/**
 * Draw Student t values.
 *
 * Each value is `z / sqrt(chiSquare / df)`: a standard normal draw over the
 * square root of a scaled chi-square. The chi-square is the sum of `df`
 * squared standard normal draws. The draws come in bulk: one `rnorm` call of
 * length `n` for the numerators, then `df` further calls of length `n`, one
 * per chi-square component. Each `rnorm` call takes `2 * ceil(n / 2)` values
 * from the generator, so `rt` takes `(df + 1) * 2 * ceil(n / 2)`.
 *
 * R's `rt` accepts any `df > 0`, through a gamma sampler. A gamma sampler
 * rejects and redraws, so it cannot state a draw count. This port accepts a
 * positive integer `df` only, which the normal construction covers with a
 * fixed draw count. A `df` that is not a positive finite integer gives NaN
 * for every result and takes nothing from the generator, as `rnorm` does for
 * a bad `sd`.
 *
 * @param rng The source of randomness.
 * @param n How many values to draw. It must be a non-negative integer.
 * @param df The degrees of freedom. It must be a positive integer.
 * @returns The drawn values.
 * @throws RangeError If n is negative or is not an integer.
 */
export function rt(rng: Rng, n: number, df: number): number[] {
  requireCount(n, "n");

  if (!Number.isInteger(df) || df <= 0) {
    return new Array<number>(n).fill(Number.NaN);
  }

  const z = rnorm(rng, n);
  const components = Array.from({ length: df }, () => rnorm(rng, n));
  return z.map((numerator, index) => {
    // The index is inside every component: each rnorm call returns n values.
    const chiSquare = sum(
      components.map((draws) => (draws[index] as number) ** 2),
    );
    return numerator / Math.sqrt(chiSquare / df);
  });
}

/**
 * Draw lognormal values.
 *
 * A lognormal value is the exponential of a normal one, so this draws from
 * `rnorm` at `meanlog` and `sdlog` and exponentiates each value. The draw
 * count is therefore `rnorm`'s, `2 * ceil(n / 2)`.
 *
 * The parameters name the normal distribution behind the exponential, not the
 * distribution the function returns. R names them the same way. Every draw is
 * above zero, and the shape leans right: the median is `exp(meanlog)` and the
 * mean sits above it.
 *
 * A `meanlog` that is not finite, or an `sdlog` that is negative or not
 * finite, gives NaN for every result and takes nothing from the generator, as
 * `rnorm` does.
 *
 * @param rng The source of randomness.
 * @param n How many values to draw. It must be a non-negative integer.
 * @param options The center and the spread of the normal behind the
 *   exponential. The default is the standard normal, as in R.
 * @returns The drawn values.
 * @throws RangeError If n is negative or is not an integer.
 */
export function rlnorm(
  rng: Rng,
  n: number,
  options: RlnormOptions = {},
): number[] {
  const { meanlog = 0, sdlog = 1 } = options;
  return rnorm(rng, n, { mean: meanlog, sd: sdlog }).map(Math.exp);
}

/** Make two standard normal values from two uniform values. */
function standardNormalPair(rng: Rng): [number, number] {
  const radius = Math.sqrt(-2 * Math.log(1 - rng()));
  const angle = 2 * Math.PI * rng();
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

/**
 * Take values from a population, without replacement.
 *
 * This is R's `sample(values, k)`, which also samples without replacement by
 * default. The algorithm is a partial Fisher-Yates shuffle: step `i` takes one
 * value from the generator and swaps position `i` with position
 * `i + floor(u * (length - i))`, so each step selects from the values that no
 * earlier step took. The function takes exactly `k` values from the generator.
 *
 * The function copies the population. It does not modify the input.
 *
 * @param rng The source of randomness.
 * @param values The population. Any element type is permitted.
 * @param k How many values to take. It must be a non-negative integer.
 * @returns The taken values, in the order the algorithm found them.
 * @throws RangeError If k is negative, is not an integer, or is more than the
 *   size of the population. R gives the same error: "cannot take a sample
 *   larger than the population when 'replace = FALSE'".
 */
export function sampleWithoutReplacement<T>(
  rng: Rng,
  values: readonly T[],
  k: number,
): T[] {
  requireCount(k, "k");
  if (k > values.length) {
    throw new RangeError(
      `cannot take a sample of ${k} from a population of ${values.length}`,
    );
  }

  const pool = values.slice();
  // An index loop, against the map convention of CLAUDE.md: each step swaps
  // two positions of the pool, which a map over the values cannot express.
  for (let i = 0; i < k; i += 1) {
    const chosen = i + Math.floor(rng() * (pool.length - i));
    const held = pool[chosen];
    pool[chosen] = pool[i];
    pool[i] = held;
  }

  return pool.slice(0, k);
}
