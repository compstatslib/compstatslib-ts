/**
 * The t distribution: density, cumulative probability, and quantile.
 *
 * These are the port of R's `dt()`, `pt()`, and `qt()`. `plot_t_test()` in
 * `../compstatslib/R/t_statistic_plot.R` draws both hypothesis curves from
 * them. Verified against R in `tdist.test.ts`.
 *
 * All three take an optional non-centrality, as in R. Left out or given as 0,
 * they run the central path, which `plot_t_test()` draws the null hypothesis
 * from; given a non-zero value they run the non-central path behind the
 * alternative-hypothesis curve, where the non-centrality is the t statistic
 * itself.
 *
 * A note on how close this comes to R. The non-central routines follow R's
 * own `pnt.c` and `dnt.c` step for step, down to the iteration cap and the
 * error bound. That is on purpose. Both stop the series on an *absolute*
 * bound, so where they stop is part of the answer, and a tidier stopping rule
 * would move the last digits away from R rather than toward the truth. It
 * also means this port inherits R's limits: at a large non-centrality the
 * series terms are built by repeated subtraction and go to noise once they
 * fall below about 1e-16, which is what R's own "full precision may not have
 * been achieved" warning reports. Densities near 1e-50 there agree with R in
 * absolute terms only.
 */

import {
  incompleteBetaSplit,
  inverseIncompleteBeta,
  logBeta,
  normalCdf,
} from "./special";

/** True when a non-centrality was given and is not the central case. */
function isNonCentral(ncp: number | undefined): ncp is number {
  return ncp !== undefined && ncp !== 0;
}

/** True when any argument rules the answer out before any work starts. */
function isBadArgument(value: number, df: number, ncp: number | undefined): boolean {
  return (
    Number.isNaN(value) ||
    !(df > 0) ||
    (ncp !== undefined && Number.isNaN(ncp))
  );
}

/**
 * The density of the t distribution, R's `dt()`.
 *
 * @param x Where to evaluate the density.
 * @param df Degrees of freedom. Any positive number, whole or not.
 * @param ncp The non-centrality. Left out, or 0, gives the central density.
 * @returns The density, or NaN if df is zero or less.
 */
export function dt(x: number, df: number, ncp?: number): number {
  if (isBadArgument(x, df, ncp)) {
    return Number.NaN;
  }
  return isNonCentral(ncp)
    ? nonCentralDensity(x, df, ncp)
    : centralDensity(x, df);
}

/**
 * The share of the distribution below x, R's `pt()`.
 *
 * @param x Where to evaluate the distribution.
 * @param df Degrees of freedom. Any positive number, whole or not.
 * @param ncp The non-centrality. Left out, or 0, gives the central case.
 * @returns A probability between 0 and 1, or NaN if df is zero or less.
 */
export function pt(x: number, df: number, ncp?: number): number {
  if (isBadArgument(x, df, ncp)) {
    return Number.NaN;
  }
  return isNonCentral(ncp)
    ? nonCentralProbability(x, df, ncp)
    : centralProbability(x, df);
}

/**
 * The value with probability p below it, R's `qt()`.
 *
 * @param p A probability between 0 and 1. The ends give infinities, as in R.
 * @param df Degrees of freedom. Any positive number, whole or not.
 * @param ncp The non-centrality. Left out, or 0, gives the central case.
 * @returns The quantile, or NaN for a p outside 0 to 1 or a df of zero or
 *   less.
 */
export function qt(p: number, df: number, ncp?: number): number {
  if (isBadArgument(p, df, ncp) || p < 0 || p > 1) {
    return Number.NaN;
  }
  return isNonCentral(ncp)
    ? nonCentralQuantile(p, df, ncp)
    : centralQuantile(p, df);
}

/**
 * The density, computed in logs.
 *
 *     f(x) = (1 + x²/df)^−(df+1)/2 / (√df · B(½, df/2))
 *
 * `log1p` keeps the small-x end accurate, and the log form keeps the large-df
 * end from overflowing on the way to a modest answer.
 */
function centralDensity(x: number, df: number): number {
  if (!Number.isFinite(x)) {
    return 0;
  }
  const logDensity =
    -0.5 * Math.log(df) -
    logBeta(0.5, df / 2) -
    ((df + 1) / 2) * Math.log1p((x * x) / df);
  return Math.exp(logDensity);
}

/**
 * The cumulative probability, from the upper tail outward.
 *
 * Working from whichever tail holds the smaller mass avoids subtracting two
 * nearly equal numbers, which is what makes the far tails accurate.
 */
function centralProbability(x: number, df: number): number {
  if (x === 0) {
    return 0.5;
  }
  if (x === Number.POSITIVE_INFINITY) {
    return 1;
  }
  if (x === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  const tail = upperTail(Math.abs(x), df);
  return x < 0 ? tail : 1 - tail;
}

/**
 * The mass above t, for a t of zero or more.
 *
 *     P(T > t) = ½ · I_z(df/2, ½),  z = df / (df + t²)
 *
 * This is the incomplete-beta identity R's `pt()` uses. Both z and 1 − z come
 * straight out of t and df, each to full precision, so the pair goes to
 * `incompleteBetaSplit` rather than letting it subtract one from the other. A
 * small t drives z against 1, where a subtracted complement would keep only a
 * handful of digits; a large t makes the answer tiny, where building it as
 * ½ − something would cancel it away to nothing.
 */
function upperTail(t: number, df: number): number {
  const squared = t * t;
  if (!Number.isFinite(squared)) {
    // t is past 1e154. The mass above it is far below the smallest double.
    return 0;
  }
  const total = df + squared;
  return 0.5 * incompleteBetaSplit(df / total, squared / total, df / 2, 0.5);
}

/** How many Newton steps the quantile takes after the beta inverse. */
const POLISH_MAX_STEPS = 4;

/**
 * The quantile, by inverting the incomplete beta and then polishing.
 *
 * The symmetry of the distribution turns a one-sided probability into a
 * two-sided mass, which the beta inverse handles. Which shape goes first
 * depends on which side is small: taking the large side would compute the
 * answer as one minus something near one and throw away digits.
 */
function centralQuantile(p: number, df: number): number {
  if (p === 0.5) {
    return 0;
  }
  if (p <= 0) {
    return Number.NEGATIVE_INFINITY;
  }
  if (p >= 1) {
    return Number.POSITIVE_INFINITY;
  }

  const tail = p < 0.5 ? p : 1 - p;
  const sign = p < 0.5 ? -1 : 1;
  const twoSided = 2 * tail;

  let squared: number;
  if (twoSided > 0.5) {
    // Near the middle: the answer is small, so solve for x²/(df + x²).
    const near = inverseIncompleteBeta(1 - twoSided, 0.5, df / 2);
    squared = (df * near) / (1 - near);
  } else {
    // Out in a tail: the answer is large, so solve for df/(df + x²).
    const far = inverseIncompleteBeta(twoSided, df / 2, 0.5);
    squared = (df * (1 - far)) / far;
  }

  return sign * polish(Math.sqrt(squared), tail, df);
}

/**
 * Newton steps on the upper tail, to take the last digits home.
 *
 * The beta inverse lands close but loses a little precision on the way
 * through x² and the square root. Solving P(T > t) = tail directly, with the
 * density as the derivative, recovers it. The step is measured against the
 * tail rather than against p, so a p near 1 does not lose its digits to the
 * subtraction.
 */
function polish(start: number, tail: number, df: number): number {
  let t = start;

  // Index loop with a stated reason: this refines a single root and stops on
  // a convergence test.
  for (let step = 0; step < POLISH_MAX_STEPS; step += 1) {
    const density = centralDensity(t, df);
    if (!(density > 0) || !Number.isFinite(t)) {
      break;
    }

    const move = (upperTail(t, df) - tail) / density;
    const next = t + move;
    if (!(next > 0) || !Number.isFinite(next) || Math.abs(move) > 0.25 * t) {
      break;
    }
    if (next === t) {
      break;
    }

    t = next;
    if (Math.abs(move) <= Number.EPSILON * t) {
      break;
    }
  }

  return t;
}

/**
 * Iteration cap and error bound for the AS 243 series.
 *
 * These are R's own values from `pnt.c`. They are part of the answer, not a
 * detail: the series stops on an *absolute* bound, so where it stops decides
 * the last digits. Holding R's numbers here is what makes this port agree
 * with R rather than merely come close to the true value.
 */
const SERIES_MAX_STEPS = 1000;
const SERIES_ERROR_MAX = 1e-12;

/** Above this non-centrality R leaves the series for a normal fit. */
const SERIES_NCP_LIMIT_SQUARED = 2 * Math.LN2 * 1022;

/** Above this many degrees of freedom R does the same. */
const SERIES_DF_LIMIT = 4e5;

const SQRT_TWO_OVER_PI = Math.sqrt(2 / Math.PI);

/**
 * The share of the non-central distribution below x, R's `pt(x, df, ncp)`.
 *
 * The series only runs on values of zero or more, so a negative x is
 * reflected through the origin along with the non-centrality. That names the
 * other tail, which the caller flips back.
 */
function nonCentralProbability(x: number, df: number, ncp: number): number {
  if (x === Number.POSITIVE_INFINITY) {
    return 1;
  }
  if (x === Number.NEGATIVE_INFINITY) {
    return 0;
  }

  const reflected = x < 0;
  const t = reflected ? -x : x;
  const delta = reflected ? -ncp : ncp;
  const lower =
    df > SERIES_DF_LIMIT || delta * delta > SERIES_NCP_LIMIT_SQUARED
      ? normalApproximation(t, df, delta)
      : lenthSeries(t, df, delta);

  return reflected ? 1 - lower : lower;
}

/**
 * Abramowitz and Stegun 26.7.10, the fit R falls back on.
 *
 * Past a non-centrality of about 37.6 the leading Poisson weight
 * exp(−ncp²/2) drops below the smallest double and the series has nothing
 * left to sum. The sliders reach that: a difference of 4 with a standard
 * deviation of 1 over 500 observations puts the non-centrality near 89.
 */
function normalApproximation(t: number, df: number, delta: number): number {
  const shrink = 1 / (4 * df);
  const spread = Math.sqrt(1 + t * t * 2 * shrink);
  return normalCdf((t * (1 - shrink) - delta) / spread);
}

/**
 * The AS 243 twin series of Lenth (1989), as R's `pnt.c` runs it.
 *
 * The distribution is a Poisson mixture of incomplete beta terms. Both
 * families of terms step by recurrence rather than being evaluated afresh,
 * and `remaining` carries the Poisson mass still to come, which bounds the
 * error of stopping early.
 *
 * @param t Where to evaluate, zero or more.
 * @param df Degrees of freedom.
 * @param delta The non-centrality, of either sign.
 */
function lenthSeries(t: number, df: number, delta: number): number {
  const squared = t * t;
  const total = df + squared;
  const x = squared / total;
  const complement = df / total;

  let sum = 0;
  if (x > 0) {
    const lambda = delta * delta;
    let oddWeight = 0.5 * Math.exp(-0.5 * lambda);
    let evenWeight = SQRT_TWO_OVER_PI * oddWeight * delta;

    let remaining = 0.5 - oddWeight;
    if (remaining < 1e-7) {
      remaining = -0.5 * Math.expm1(-0.5 * lambda);
    }

    let a = 0.5;
    const b = 0.5 * df;
    const powered = Math.pow(complement, b);
    const logBetaValue = logBeta(0.5, b);

    let oddTerm = incompleteBetaSplit(x, complement, a, b);
    let oddStep = 2 * powered * Math.exp(a * Math.log(x) - logBetaValue);
    let evenTerm = 1 - powered;
    let evenStep = b * x * powered;
    sum = oddWeight * oddTerm + evenWeight * evenTerm;

    // Index loop with a stated reason: each pass advances one Poisson term by
    // recurrence and the loop stops on an error bound, not on a data length.
    for (let step = 1; step <= SERIES_MAX_STEPS; step += 1) {
      a += 1;
      oddTerm -= oddStep;
      evenTerm -= evenStep;
      oddStep *= (x * (a + b - 1)) / a;
      evenStep *= (x * (a + b - 0.5)) / (a + 0.5);
      oddWeight *= lambda / (2 * step);
      evenWeight *= lambda / (2 * step + 1);
      remaining -= oddWeight;
      if (remaining <= 0) {
        break;
      }
      sum += oddWeight * oddTerm + evenWeight * evenTerm;
      if (Math.abs(2 * remaining * (oddTerm - oddStep)) < SERIES_ERROR_MAX) {
        break;
      }
    }
  }

  return Math.min(Math.max(sum + normalCdf(-delta), 0), 1);
}

/**
 * The density of the non-central distribution, R's `dt(x, df, ncp)`.
 *
 * Away from zero the density is read off the distribution function, using
 * that its derivative can be written as a difference between two evaluations
 * two degrees of freedom apart. R notes in `dnt.c` that this still cancels,
 * and it does: at x = 1 the two probabilities agree to about two digits
 * before the difference is taken. Following R's route rather than a cleaner
 * one is deliberate, since the fixtures are R's own output.
 */
function nonCentralDensity(x: number, df: number, ncp: number): number {
  if (!Number.isFinite(x)) {
    return 0;
  }

  if (Math.abs(x) > Math.sqrt(df * Number.EPSILON)) {
    const stepped = x * Math.sqrt((df + 2) / df);
    const difference =
      nonCentralProbability(stepped, df + 2, ncp) -
      nonCentralProbability(x, df, ncp);
    return (df / Math.abs(x)) * Math.abs(difference);
  }

  // At zero that difference is 0/0. The density there is the central one
  // damped by the non-centrality, exp(−ncp²/2).
  return Math.exp(
    -0.5 * Math.log(df) - logBeta(0.5, df / 2) - 0.5 * ncp * ncp,
  );
}

/** Iteration cap for the non-central quantile search. */
const QUANTILE_MAX_STEPS = 200;

/**
 * The non-central quantile, R's `qt(p, df, ncp)`.
 *
 * There is no closed form to invert, so this brackets the root and then works
 * inward. R bisects to a relative 1e-13; Newton steps get there in a handful
 * of passes instead, with the bracket kept so that a step into the flat part
 * of a far tail cannot run away.
 */
function nonCentralQuantile(p: number, df: number, ncp: number): number {
  if (p <= 0) {
    return Number.NEGATIVE_INFINITY;
  }
  if (p >= 1) {
    return Number.POSITIVE_INFINITY;
  }

  // Widen outward from the non-centrality until the root is enclosed.
  let upper = Math.max(1, ncp);
  while (
    Number.isFinite(upper) &&
    nonCentralProbability(upper, df, ncp) < p
  ) {
    upper *= 2;
  }
  let lower = Math.min(-1, -ncp);
  while (
    Number.isFinite(lower) &&
    nonCentralProbability(lower, df, ncp) > p
  ) {
    lower *= 2;
  }

  let t = 0.5 * (lower + upper);

  // Index loop with a stated reason: this refines a single root and stops on
  // a convergence test.
  for (let step = 0; step < QUANTILE_MAX_STEPS; step += 1) {
    const residual = nonCentralProbability(t, df, ncp) - p;
    if (residual < 0) {
      lower = t;
    } else {
      upper = t;
    }

    const density = nonCentralDensity(t, df, ncp);
    let next =
      density > 0 && Number.isFinite(density) ? t - residual / density : Number.NaN;
    if (!(next > lower) || !(next < upper)) {
      next = 0.5 * (lower + upper);
    }
    if (next === t) {
      break;
    }

    const moved = Math.abs(next - t);
    t = next;
    if (moved <= Number.EPSILON * Math.abs(t)) {
      break;
    }
  }

  return t;
}
