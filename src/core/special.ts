/**
 * Special functions that the statistics in `core/` build on.
 *
 * JavaScript has no `lgamma` and no incomplete beta, so the distribution
 * functions need them here. R gets the same quantities from its own C
 * routines; this module is the port's replacement.
 *
 * Every function is pure. None of them touch the DOM or hold state.
 */

import { sum } from "./arith.js";

/**
 * Lanczos parameter and coefficients, g = 607/128 with 15 terms.
 *
 * This set holds about 15 correct digits over the whole positive real line,
 * which is what the t quantiles need at 1e-12 relative tolerance.
 */
const LANCZOS_G = 607 / 128;

const LANCZOS_LEAD = 0.99999999999999709182;

const LANCZOS_TAIL: readonly number[] = [
  57.156235665862923517, -59.597960355475491248, 14.136097974741747174,
  -0.49191381609762019978, 0.33994649984811888699e-4,
  0.46523628927048575665e-4, -0.98374475304879564677e-4,
  0.15808870322491248884e-3, -0.21026444172410488319e-3,
  0.2174396181152126432e-3, -0.16431810653676389022e-3,
  0.84418223983852743293e-4, -0.2619083840158140867e-4,
  0.36899182659531622704e-5,
];

const LOG_SQRT_TWO_PI = 0.5 * Math.log(2 * Math.PI);

/**
 * The Lanczos series A(x), the slowly varying part of the approximation
 *
 *     Γ(x) = √(2π) · (x + g − ½)^(x − ½) · e^−(x + g − ½) · A(x)
 */
function lanczosSeries(x: number): number {
  return (
    LANCZOS_LEAD +
    sum(LANCZOS_TAIL.map((coefficient, index) => coefficient / (x + index)))
  );
}

/**
 * The natural log of the gamma function, R's `lgamma()`.
 *
 * @param x A positive number.
 * @returns log Γ(x), or NaN if x is zero or less.
 */
export function logGamma(x: number): number {
  if (!(x > 0)) {
    return Number.NaN;
  }
  const shifted = x + LANCZOS_G - 0.5;
  return (
    LOG_SQRT_TWO_PI +
    (x - 0.5) * Math.log(shifted) -
    shifted +
    Math.log(lanczosSeries(x))
  );
}

/**
 * The natural log of the beta function, R's `lbeta()`.
 *
 * The obvious route, `logGamma(a) + logGamma(b) - logGamma(a + b)`, subtracts
 * numbers near 600 for the degrees of freedom this package plots, and loses
 * about three digits doing so. Expanding the Lanczos form first cancels the
 * large terms by hand: the exponential parts collapse to the constant
 * −(g − ½), and the logarithmic parts become ratios that stay of order one.
 * What is left has no cancellation at all.
 *
 * Both ratios go through `log1p`. Each one sits just below 1, and taking the
 * quotient first would round away the small part that the log then reads —
 * a loss that grows with the larger argument, reaching 1e-13 by b = 2500.
 *
 * @param a A positive number.
 * @param b A positive number.
 * @returns log B(a, b), or NaN if either argument is zero or less.
 */
export function logBeta(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) {
    return Number.NaN;
  }
  const shiftedSum = a + b + LANCZOS_G - 0.5;
  return (
    LOG_SQRT_TWO_PI -
    (LANCZOS_G - 0.5) +
    Math.log(lanczosSeries(a)) +
    Math.log(lanczosSeries(b)) -
    Math.log(lanczosSeries(a + b)) +
    (a - 0.5) * Math.log1p(-b / shiftedSum) +
    (b - 0.5) * Math.log1p(-a / shiftedSum) -
    0.5 * Math.log(shiftedSum)
  );
}

/** Iteration caps and guards for the continued fraction. */
const FRACTION_MAX_STEPS = 400;
const FRACTION_EPSILON = 3e-16;
const FRACTION_FLOOR = 1e-300;

/**
 * The continued fraction of the incomplete beta function, by the modified
 * Lentz method.
 *
 * The loop is index based on purpose: it refines one running value step by
 * step and stops on a convergence test, so there is no array to map over.
 */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const total = a + b;
  const aPlus = a + 1;
  const aMinus = a - 1;

  let c = 1;
  let d = 1 - (total * x) / aPlus;
  if (Math.abs(d) < FRACTION_FLOOR) {
    d = FRACTION_FLOOR;
  }
  d = 1 / d;
  let value = d;

  for (let step = 1; step <= FRACTION_MAX_STEPS; step += 1) {
    const twice = 2 * step;

    const even = (step * (b - step) * x) / ((aMinus + twice) * (a + twice));
    d = 1 + even * d;
    if (Math.abs(d) < FRACTION_FLOOR) {
      d = FRACTION_FLOOR;
    }
    c = 1 + even / c;
    if (Math.abs(c) < FRACTION_FLOOR) {
      c = FRACTION_FLOOR;
    }
    d = 1 / d;
    value *= d * c;

    const odd = (-(a + step) * (total + step) * x) / ((a + twice) * (aPlus + twice));
    d = 1 + odd * d;
    if (Math.abs(d) < FRACTION_FLOOR) {
      d = FRACTION_FLOOR;
    }
    c = 1 + odd / c;
    if (Math.abs(c) < FRACTION_FLOOR) {
      c = FRACTION_FLOOR;
    }
    d = 1 / d;

    const delta = d * c;
    value *= delta;
    if (Math.abs(delta - 1) < FRACTION_EPSILON) {
      break;
    }
  }

  return value;
}

/**
 * The regularized incomplete beta function I_x(a, b), R's `pbeta()`.
 *
 * The continued fraction converges quickly only on one side of the
 * distribution, so the function evaluates the mirrored form when x sits above
 * the switch point and takes the complement.
 *
 * @param x A value between 0 and 1.
 * @param a A positive shape.
 * @param b A positive shape.
 * @returns The share of the beta density below x, or NaN for a bad shape.
 */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (Number.isNaN(x)) {
    return Number.NaN;
  }
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  return incompleteBetaSplit(x, 1 - x, a, b);
}

/**
 * The regularized incomplete beta function, told x and 1 − x separately.
 *
 * A caller that can write down both members of the pair should use this
 * instead of `incompleteBeta`. Once x is within 1e-16 of 1, the double
 * holding it has no room left for 1 − x, and rebuilding the complement by
 * subtraction throws away the very digits the answer rests on. `pt()` reads
 * both straight off t and df, so it gives up nothing.
 *
 * The two are treated as an exact pair, not as one value and a derived one:
 * each logarithm is taken from whichever member still carries its precision.
 *
 * @param x A value between 0 and 1.
 * @param complement The value of 1 − x, computed without subtracting.
 * @param a A positive shape.
 * @param b A positive shape.
 * @returns The share of the beta density below x, or NaN for a bad shape.
 */
export function incompleteBetaSplit(
  x: number,
  complement: number,
  a: number,
  b: number,
): number {
  if (Number.isNaN(x) || Number.isNaN(complement) || !(a > 0) || !(b > 0)) {
    return Number.NaN;
  }
  if (x <= 0) {
    return 0;
  }
  if (complement <= 0) {
    return 1;
  }

  const logX = complement < 0.5 ? Math.log1p(-complement) : Math.log(x);
  const logComplement = x < 0.5 ? Math.log1p(-x) : Math.log(complement);
  const front = Math.exp(a * logX + b * logComplement - logBeta(a, b));

  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (front * betaContinuedFraction(complement, b, a)) / b;
}

/** Iteration cap and tolerance for the incomplete gamma routines. */
const GAMMA_MAX_STEPS = 1000;
const GAMMA_EPSILON = 3e-16;

/**
 * The log of the common factor e^−x · x^a / Γ(a).
 *
 * Both incomplete-gamma routines carry it. Kept as a log so that a caller
 * working in the log scale never has to exponentiate a number that underflows
 * on the way, which is how the far lower tail of the chi-square keeps its
 * digits at 200 degrees of freedom.
 */
function logGammaFactor(a: number, x: number): number {
  return -x + a * Math.log(x) - logGamma(a);
}

/**
 * The power series behind P(a, x), without its leading factor.
 *
 * The series converges quickly while x stays below a + 1. Index loop with a
 * stated reason: it sums one term at a time and stops on a size test.
 */
function lowerGammaSeries(a: number, x: number): number {
  let term = 1 / a;
  let total = term;
  for (let step = 1; step <= GAMMA_MAX_STEPS; step += 1) {
    term *= x / (a + step);
    total += term;
    if (Math.abs(term) < Math.abs(total) * GAMMA_EPSILON) {
      break;
    }
  }
  return total;
}

/**
 * The continued fraction behind Q(a, x), without its leading factor, by the
 * modified Lentz method.
 *
 * This is the branch that carries the far normal tail, where the answer runs
 * to 1e-70 and below and must stay accurate relative to itself.
 */
function upperGammaFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / FRACTION_FLOOR;
  let d = 1 / b;
  let value = d;

  for (let step = 1; step <= GAMMA_MAX_STEPS; step += 1) {
    const numerator = -step * (step - a);
    b += 2;
    d = numerator * d + b;
    if (Math.abs(d) < FRACTION_FLOOR) {
      d = FRACTION_FLOOR;
    }
    c = b + numerator / c;
    if (Math.abs(c) < FRACTION_FLOOR) {
      c = FRACTION_FLOOR;
    }
    d = 1 / d;
    const delta = d * c;
    value *= delta;
    if (Math.abs(delta - 1) < GAMMA_EPSILON) {
      break;
    }
  }

  return value;
}

/**
 * P(a, x), the regularized lower incomplete gamma, R's `pgamma(x, a)`.
 *
 * The series carries the side where x sits below a + 1, and the complement of
 * the continued fraction carries the other side. Each route is taken where it
 * converges and where it holds the answer away from a cancellation.
 *
 * @param a A positive shape.
 * @param x A value of zero or more.
 * @returns The share of the gamma density below x, or NaN for a bad shape.
 */
export function regularizedGammaP(a: number, x: number): number {
  if (Number.isNaN(x) || !(a > 0)) {
    return Number.NaN;
  }
  if (x <= 0) {
    return 0;
  }
  if (!Number.isFinite(x)) {
    return 1;
  }
  return x < a + 1
    ? lowerGammaSeries(a, x) * Math.exp(logGammaFactor(a, x))
    : 1 - upperGammaFraction(a, x) * Math.exp(logGammaFactor(a, x));
}

/**
 * Q(a, x), the regularized upper incomplete gamma, R's
 * `pgamma(x, a, lower.tail = FALSE)`.
 *
 * @param a A positive shape.
 * @param x A value of zero or more.
 * @returns The share of the gamma density above x, or NaN for a bad shape.
 */
export function regularizedGammaQ(a: number, x: number): number {
  if (Number.isNaN(x) || !(a > 0)) {
    return Number.NaN;
  }
  if (x <= 0) {
    return 1;
  }
  if (!Number.isFinite(x)) {
    return 0;
  }
  return x < a + 1
    ? 1 - lowerGammaSeries(a, x) * Math.exp(logGammaFactor(a, x))
    : upperGammaFraction(a, x) * Math.exp(logGammaFactor(a, x));
}

/**
 * log P(a, x), R's `pgamma(x, a, log.p = TRUE)`.
 *
 * The series branch never exponentiates: it adds the log of the sum to the log
 * of the factor. That is what a caller needs where P itself is below the
 * smallest double, as it is for the chi-square at 200 degrees of freedom near
 * zero, and it is the scale R's own quantile search works in.
 *
 * @param a A positive shape.
 * @param x A value of zero or more.
 * @returns The log of the lower tail, or NaN for a bad shape.
 */
export function logRegularizedGammaP(a: number, x: number): number {
  if (Number.isNaN(x) || !(a > 0)) {
    return Number.NaN;
  }
  if (x <= 0) {
    return Number.NEGATIVE_INFINITY;
  }
  if (!Number.isFinite(x)) {
    return 0;
  }
  if (x < a + 1) {
    return Math.log(lowerGammaSeries(a, x)) + logGammaFactor(a, x);
  }
  return Math.log1p(-upperGammaFraction(a, x) * Math.exp(logGammaFactor(a, x)));
}

/**
 * log Q(a, x), R's `pgamma(x, a, lower.tail = FALSE, log.p = TRUE)`.
 *
 * @param a A positive shape.
 * @param x A value of zero or more.
 * @returns The log of the upper tail, or NaN for a bad shape.
 */
export function logRegularizedGammaQ(a: number, x: number): number {
  if (Number.isNaN(x) || !(a > 0)) {
    return Number.NaN;
  }
  if (x <= 0) {
    return 0;
  }
  if (!Number.isFinite(x)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (x < a + 1) {
    return Math.log1p(-lowerGammaSeries(a, x) * Math.exp(logGammaFactor(a, x)));
  }
  return Math.log(upperGammaFraction(a, x)) + logGammaFactor(a, x);
}

/**
 * The standard normal distribution function, R's `pnorm()`.
 *
 * Built on the identity Φ(−z) = ½ · Q(½, z²/2), which keeps the far tail
 * accurate relative to itself rather than losing it against 1. The
 * non-central t needs Φ(−ncp) down to 1e-72 at the widest slider settings.
 *
 * @param z Where to evaluate the distribution.
 * @returns A probability between 0 and 1, or NaN for a NaN input.
 */
export function normalCdf(z: number): number {
  if (Number.isNaN(z)) {
    return Number.NaN;
  }
  const lower = 0.5 * regularizedGammaQ(0.5, 0.5 * z * z);
  return z > 0 ? 1 - lower : lower;
}

/** The largest double below 1. The inverse never returns 1 itself. */
const BELOW_ONE = 1 - Number.EPSILON / 2;

/** Iteration cap for the inverse. Newton needs about 8 steps; 200 is slack. */
const INVERSE_MAX_STEPS = 200;

/**
 * A starting point for the inverse.
 *
 * Both branches are published approximations. Where both shapes are at least
 * one, the guess is the normal quantile of Abramowitz and Stegun 26.2.22 —
 * the rational function in `t = sqrt(-2 log p)` whose constants appear
 * below, good to about 3e-3 — carried onto the beta scale by the
 * Wilson-Hilferty transformation, the same starting value Algorithm AS 109
 * of Cran, Martin and Thomas (1977) uses. Where either shape is below one,
 * the guess inverts the leading term of the incomplete beta series instead,
 * which is the behavior that governs near an endpoint.
 *
 * Both branches are approximations only. The Newton loop that follows carries
 * the value the rest of the way, so the guess needs to be in the right
 * neighborhood, not accurate.
 */
function inverseGuess(p: number, a: number, b: number): number {
  if (a >= 1 && b >= 1) {
    const tail = p < 0.5 ? p : 1 - p;
    const t = Math.sqrt(-2 * Math.log(tail));
    const normal =
      (p < 0.5 ? -1 : 1) *
      ((2.30753 + t * 0.27061) / (1 + t * (0.99229 + t * 0.04481)) - t);
    const scale = (normal * normal - 3) / 6;
    const harmonic = 2 / (1 / (2 * a - 1) + 1 / (2 * b - 1));
    const w =
      (normal * Math.sqrt(scale + harmonic)) / harmonic -
      (1 / (2 * b - 1) - 1 / (2 * a - 1)) *
        (scale + 5 / 6 - 2 / (3 * harmonic));
    return a / (a + b * Math.exp(2 * w));
  }

  const lower = Math.exp(a * Math.log(a / (a + b))) / a;
  const upper = Math.exp(b * Math.log(b / (a + b))) / b;
  const total = lower + upper;
  if (p < lower / total) {
    return Math.pow(a * total * p, 1 / a);
  }
  return 1 - Math.pow(b * total * (1 - p), 1 / b);
}

/**
 * The inverse of the regularized incomplete beta function, R's `qbeta()`.
 *
 * Newton's method on I_x(a, b) − p, with the exact beta density as the
 * derivative. Every step keeps a bracket, and a step that leaves the bracket
 * falls back to bisection, so the loop cannot run away on a poor guess.
 *
 * @param p A probability between 0 and 1.
 * @param a A positive shape.
 * @param b A positive shape.
 * @returns The x where I_x(a, b) equals p, or NaN for a bad shape.
 */
export function inverseIncompleteBeta(
  p: number,
  a: number,
  b: number,
): number {
  if (Number.isNaN(p) || !(a > 0) || !(b > 0)) {
    return Number.NaN;
  }
  if (p <= 0) {
    return 0;
  }
  if (p >= 1) {
    return 1;
  }

  const logBetaValue = logBeta(a, b);
  let lower = 0;
  let upper = 1;
  let x = inverseGuess(p, a, b);
  if (!(x > 0) || !(x < 1)) {
    x = 0.5;
  }

  // Index loop with a stated reason: this refines a single root and stops on
  // a convergence test.
  for (let step = 0; step < INVERSE_MAX_STEPS; step += 1) {
    const residual = incompleteBeta(x, a, b) - p;
    if (residual < 0) {
      lower = x;
    } else {
      upper = x;
    }

    const density = Math.exp(
      (a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - logBetaValue,
    );
    let next =
      density > 0 && Number.isFinite(density) ? x - residual / density : Number.NaN;
    if (!(next > lower) || !(next < upper)) {
      next = 0.5 * (lower + upper);
    }
    if (next === x) {
      break;
    }

    const moved = Math.abs(next - x);
    x = next;
    if (moved <= Number.EPSILON * x) {
      break;
    }
  }

  return Math.min(x, BELOW_ONE);
}
