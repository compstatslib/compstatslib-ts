/**
 * The normal distribution function and its quantile, R's `pnorm()` and
 * `qnorm()`.
 *
 * `pnorm` is `normalCdf` with R's location, scale and tail arguments around
 * it. The tail is a separate evaluation rather than one minus the other half,
 * because the upper tail runs to 1e-316 before it underflows and a
 * subtraction would leave nothing of it.
 *
 * `qnorm` is Wichura's Algorithm AS 241 (PPND16), as R's `qnorm.c` runs it:
 * three minimax rational approximations, chosen by how far the probability
 * sits from one half, plus the asymptotic branch R added for the part of the
 * far tail the third approximation no longer covers. That last branch is R
 * Core's own work rather than Wichura's; see `asymptoticTail` below and
 * NOTICE. Verified against R in `norm.test.ts`.
 */

import { normalCdf } from "./special.js";

/**
 * R's `mean`, `sd`, and `lower.tail` arguments.
 *
 * The tail is kept because `1 − p` throws away a far upper tail, which is
 * exactly what a fit measure reports as its p-value.
 */
export interface NormalOptions {
  /** The center of the distribution. R's `mean`, default 0. */
  readonly mean?: number;
  /** The spread of the distribution. R's `sd`, default 1. */
  readonly sd?: number;
  /** Read the lower tail. R's `lower.tail`, default true. */
  readonly lowerTail?: boolean;
}

/**
 * The share of the normal distribution below z, R's `pnorm()`.
 *
 * @param z Where to evaluate the distribution.
 * @param options R's `mean`, `sd`, and `lower.tail`.
 * @returns A probability between 0 and 1, or NaN for a NaN input or a
 *   negative standard deviation.
 */
export function pnorm(z: number, options?: NormalOptions): number {
  const mean = options?.mean ?? 0;
  const sd = options?.sd ?? 1;
  const lowerTail = options?.lowerTail ?? true;

  if (Number.isNaN(z) || Number.isNaN(mean) || Number.isNaN(sd)) {
    return Number.NaN;
  }
  if (sd < 0) {
    return Number.NaN;
  }
  if (sd === 0) {
    // A point mass at the mean, as R reports it.
    const below = z < mean;
    return lowerTail ? (below ? 0 : 1) : below ? 1 : 0;
  }

  const standard = (z - mean) / sd;
  return lowerTail ? normalCdf(standard) : normalCdf(-standard);
}

/**
 * The value with probability p below it, R's `qnorm()`.
 *
 * @param p A probability between 0 and 1. The ends give infinities, as in R.
 * @param options R's `mean`, `sd`, and `lower.tail`.
 * @returns The quantile, or NaN for a p outside 0 to 1, a NaN input, or a
 *   negative standard deviation.
 */
export function qnorm(p: number, options?: NormalOptions): number {
  const mean = options?.mean ?? 0;
  const sd = options?.sd ?? 1;
  const lowerTail = options?.lowerTail ?? true;

  if (Number.isNaN(p) || Number.isNaN(mean) || Number.isNaN(sd)) {
    return Number.NaN;
  }
  if (p < 0 || p > 1) {
    return Number.NaN;
  }
  if (p === 0) {
    return lowerTail ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  if (p === 1) {
    return lowerTail ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  if (sd < 0) {
    return Number.NaN;
  }
  if (sd === 0) {
    return mean;
  }

  return mean + sd * standardQuantile(p, lowerTail);
}

/** R's `M_SQRT2`, used by the outermost asymptotic branch. */
const SQRT_TWO = Math.SQRT2;

/** R's `M_2PI`. */
const TWO_PI = 2 * Math.PI;

/**
 * The standard normal quantile, Wichura's AS 241 as R's `qnorm.c` runs it.
 *
 * The three regions are the published ones: a central rational function in
 * `q = p − ½`, and two more in `r = √(−log min(p, 1 − p))`, one for r up to 5
 * and one for r up to 27. Past r = 27 the smaller tail has all but
 * underflowed, and R switches to the asymptotic expansion of Maechler (2022),
 * refined by how far out the value sits.
 */
function standardQuantile(p: number, lowerTail: boolean): number {
  const lower = lowerTail ? p : 0.5 - p + 0.5;
  const q = lower - 0.5;

  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (
      (q *
        (((((((r * 2509.0809287301226727 + 33430.575583588128105) * r +
          67265.770927008700853) *
          r +
          45921.953931549871457) *
          r +
          13731.693765509461125) *
          r +
          1971.5909503065514427) *
          r +
          133.14166789178437745) *
          r +
          3.387132872796366608)) /
      (((((((r * 5226.495278852854561 + 28729.085735721942674) * r +
        39307.89580009271061) *
        r +
        21213.794301586595867) *
        r +
        5394.1960214247511077) *
        r +
        687.1870074920579083) *
        r +
        42.313330701600911252) *
        r +
        1)
    );
  }

  // The smaller of p and 1 − p, taken from whichever argument still holds it.
  const smaller = q > 0 ? (lowerTail ? 0.5 - p + 0.5 : p) : lower;
  const logSmaller = Math.log(smaller);
  const r = Math.sqrt(-logSmaller);
  const magnitude =
    r <= 5
      ? nearTail(r - 1.6)
      : r <= 27
        ? farTail(r - 5)
        : asymptoticTail(r, logSmaller);

  return q < 0 ? -magnitude : magnitude;
}

/** AS 241's second region, for a smaller tail down to about 1.4e-11. */
function nearTail(r: number): number {
  return (
    (((((((r * 7.7454501427834140764e-4 + 0.0227238449892691845833) * r +
      0.24178072517745061177) *
      r +
      1.27045825245236838258) *
      r +
      3.64784832476320460504) *
      r +
      5.7694972214606914055) *
      r +
      4.6303378461565452959) *
      r +
      1.42343711074968357734) /
    (((((((r * 1.05075007164441684324e-9 + 5.475938084995344946e-4) * r +
      0.0151986665636164571966) *
      r +
      0.14810397642748007459) *
      r +
      0.68976733498510000455) *
      r +
      1.6763848301838038494) *
      r +
      2.05319162663775882187) *
      r +
      1)
  );
}

/** AS 241's third region, for a smaller tail down to about 2.5e-317. */
function farTail(r: number): number {
  return (
    (((((((r * 2.01033439929228813265e-7 + 2.71155556874348757815e-5) * r +
      0.0012426609473880784386) *
      r +
      0.026532189526576123093) *
      r +
      0.29656057182850489123) *
      r +
      1.7848265399172913358) *
      r +
      5.4637849111641143699) *
      r +
      6.6579046435011037772) /
    (((((((r * 2.04426310338993978564e-15 + 1.4215117583164458887e-7) * r +
      1.8463183175100546818e-5) *
      r +
      7.868691311456132591e-4) *
      r +
      0.0148753612908506148525) *
      r +
      0.13692988092273580531) *
      r +
      0.59983220655588793769) *
      r +
      1)
  );
}

/**
 * R's asymptotic branch, past the reach of AS 241's third region.
 *
 * The expansion refines x² = 2s − log(2π x²) − … by one more term for each
 * step inward, where s is minus the log of the smaller tail. The thresholds
 * choose how many terms to take.
 *
 * This branch is live. AS 241's third region runs out at a smaller tail of
 * about 2.5e-317, which is r = 27, and the subnormals carry an ordinary
 * probability four orders further, to 4.9406564584124654e-324 and r =
 * 27.284. Every value in that window reaches this function through the
 * plain arguments the port takes, and `norm.test.ts` pins all of them.
 *
 * Provenance: this expansion is not part of Wichura's published AS 241. It
 * is R Core's own addition to `nmath/qnorm.c`, due to Martin Maechler
 * (2022), and the port follows it including its thresholds, which is what
 * makes the values above pin exactly. See NOTICE.
 */
function asymptoticTail(r: number, logSmaller: number): number {
  if (r >= 6.4e8) {
    return r * SQRT_TWO;
  }

  const twiceS = -2 * logSmaller;
  let squared = twiceS - Math.log(TWO_PI * twiceS);
  if (r < 36000) {
    squared = twiceS - Math.log(TWO_PI * squared) - 2 / (2 + squared);
    if (r < 840) {
      squared =
        twiceS -
        Math.log(TWO_PI * squared) +
        2 * Math.log1p(-(1 - 1 / (4 + squared)) / (2 + squared));
      if (r < 109) {
        squared =
          twiceS -
          Math.log(TWO_PI * squared) +
          2 * Math.log1p(-(1 - (1 - 5 / (6 + squared)) / (4 + squared)) / (2 + squared));
        if (r < 55) {
          squared =
            twiceS -
            Math.log(TWO_PI * squared) +
            2 *
              Math.log1p(
                -(1 - (1 - (5 - 9 / (8 + squared)) / (6 + squared)) / (4 + squared)) /
                  (2 + squared),
              );
        }
      }
    }
  }
  return Math.sqrt(squared);
}
