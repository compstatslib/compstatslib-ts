/**
 * The chi-square distribution: cumulative probability and quantile, central
 * and noncentral. These are the port of R's `pchisq()` and `qchisq()`.
 *
 * The central probability is the regularized incomplete gamma at half the
 * degrees of freedom and half the value, which is what R's own `pchisq()`
 * reduces to. The noncentral probability follows R's `nmath/pnchisq.c` step
 * for step: a Poisson-weighted sum of central terms below a noncentrality of
 * 80, and the AS 275 series of Ding (1992) at or above it. The quantile
 * follows R's `nmath/qgamma.c`: the AS 91 starting value of Best and Roberts,
 * the seven-term Taylor refinement, and R's closing Newton steps in the log
 * scale.
 *
 * Following R here is deliberate, as it is in `tdist.ts`. Both series stop on
 * bounds R chose, so where they stop is part of the answer, and a tidier rule
 * would move the last digits away from R rather than toward the truth.
 *
 * `lower.tail` is a real argument, not sugar. The upper tail of a fit measure
 * runs to 1e-100 and below, and rebuilding it as one minus the lower tail
 * would leave nothing of it. Measured by a consumer over a 64-point grid in
 * that regime, `pchisq(x, df, ncp, {lowerTail: false})` differs from
 * `1 - pchisq(x, df, ncp)` at **31 of the 64 points**, and taking the
 * argument rather than the subtraction improved the median error against R by
 * 5× (5.1e-14 to 1.1e-14).
 *
 * **Where "follows R" is distributional and not pointwise.** The rest of this
 * package pins R's double, so a value that differs from another
 * implementation's is the better one. That reasoning does not carry to the
 * **noncentral upper tail far from the mean**, where the answer is a series
 * whose own truncation error dominates: over a 40-point grid at df 24 to 300
 * and ncp 0 to 300, measured against R, this port's worst relative error is
 * 1.0e-5 against 3.8e-3 for the implementation a consumer retired for it, and
 * its median is 5.1e-14 against 2.0e-12 — **370× better at the worst case and
 * 40× at the median** — and yet it is the *further* of the two from R at 14
 * of the 40 points. A caller reading one such probability (an RMSEA close-fit
 * p-value, say) can therefore land further from R than a cruder routine would
 * have, by luck, and be right to expect better on the next point. Read the
 * agreement here as a distribution, not as a promise about any single value;
 * the central case and every other distribution in this package keep the
 * pointwise claim.
 *
 * Verified against R in `chisq.test.ts`.
 *
 * Provenance: the two series are AS 91 (Best and Roberts 1975) and AS 275
 * (Ding 1992), both copyright the Royal Statistical Society. The regime
 * split between them, the tolerances, and the closing Newton steps are R
 * Core's arrangement, followed here. See NOTICE.
 */

import {
  logGamma,
  logRegularizedGammaP,
  logRegularizedGammaQ,
  regularizedGammaP,
  regularizedGammaQ,
} from "./special.js";
import { qnorm } from "./norm.js";

/** R's `lower.tail` argument, shared by both functions here. */
export interface TailOptions {
  /** Read the lower tail. R's `lower.tail`, default true. */
  readonly lowerTail?: boolean;
}

/**
 * The share of the chi-square distribution below x, R's `pchisq()`.
 *
 * @param x Where to evaluate the distribution.
 * @param df Degrees of freedom. Zero gives R's point mass at zero.
 * @param ncp The noncentrality. Left out, or 0, gives the central case.
 * @param options R's `lower.tail`.
 * @returns A probability between 0 and 1, or NaN for a negative or infinite
 *   degrees of freedom or noncentrality, as R warns.
 */
export function pchisq(
  x: number,
  df: number,
  ncp?: number,
  options?: TailOptions,
): number {
  const lowerTail = options?.lowerTail ?? true;

  if (Number.isNaN(x) || Number.isNaN(df) || (ncp !== undefined && Number.isNaN(ncp))) {
    return Number.NaN;
  }
  if (!(df >= 0) || !Number.isFinite(df)) {
    return Number.NaN;
  }
  if (ncp !== undefined && (!(ncp >= 0) || !Number.isFinite(ncp))) {
    return Number.NaN;
  }

  return isNonCentral(ncp)
    ? nonCentralProbability(x, df, ncp, lowerTail)
    : centralProbability(x, df, lowerTail);
}

/**
 * The value with probability p below it, R's `qchisq()`.
 *
 * Central only. R's noncentral quantile is a root search over the noncentral
 * probability; it waits for a caller that needs it.
 *
 * @param p A probability between 0 and 1.
 * @param df Degrees of freedom.
 * @param options R's `lower.tail`.
 * @returns The quantile, or NaN for a p outside 0 to 1 or a negative degrees
 *   of freedom.
 */
export function qchisq(p: number, df: number, options?: TailOptions): number {
  const lowerTail = options?.lowerTail ?? true;

  if (Number.isNaN(p) || Number.isNaN(df)) {
    return Number.NaN;
  }
  if (p < 0 || p > 1) {
    return Number.NaN;
  }
  if (p === 0) {
    return lowerTail ? 0 : Number.POSITIVE_INFINITY;
  }
  if (p === 1) {
    return lowerTail ? Number.POSITIVE_INFINITY : 0;
  }
  return quantileGamma(p, 0.5 * df, 2, lowerTail);
}

/** True when a noncentrality was given and is not the central case. */
function isNonCentral(ncp: number | undefined): ncp is number {
  return ncp !== undefined && ncp !== 0;
}

/* ------------------------------------------------------------------ */
/* The central case                                                    */
/* ------------------------------------------------------------------ */

/**
 * The central probability, R's `pchisq(x, df)`.
 *
 * R reaches it as `pgamma(x, df/2, 2)`, so the shape is half the degrees of
 * freedom and the value is halved with it. Zero degrees of freedom is R's
 * point mass at zero, left open: all the mass sits above zero and none of it
 * at zero itself.
 */
function centralProbability(x: number, df: number, lowerTail: boolean): number {
  if (df === 0) {
    const above = x > 0;
    return lowerTail ? (above ? 1 : 0) : above ? 0 : 1;
  }
  if (!(x > 0)) {
    return lowerTail ? 0 : 1;
  }
  if (!Number.isFinite(x)) {
    return lowerTail ? 1 : 0;
  }
  return lowerTail
    ? regularizedGammaP(0.5 * df, 0.5 * x)
    : regularizedGammaQ(0.5 * df, 0.5 * x);
}

/**
 * The log of the central probability, for the noncentral sum in the regime
 * where every one of its terms underflows on its own.
 */
function logCentralProbability(x: number, df: number, lowerTail: boolean): number {
  return lowerTail
    ? logRegularizedGammaP(0.5 * df, 0.5 * x)
    : logRegularizedGammaQ(0.5 * df, 0.5 * x);
}

/* ------------------------------------------------------------------ */
/* The noncentral case, following R's pnchisq.c                        */
/* ------------------------------------------------------------------ */

/**
 * The log of the smallest normal double, R's `M_LN2 * DBL_MIN_EXP`.
 *
 * Both series in `pnchisq.c` compare a log against it to decide whether a
 * factor has underflowed and the work has to move into the log scale.
 */
const LOG_SMALLEST_NORMAL = Math.LN2 * -1021;

/** R's `M_LN_SQRT_2PI`. */
const LOG_SQRT_TWO_PI = 0.918938533204672741780329736406;

/** The absolute bound, relative bound and iteration cap R passes AS 275. */
const SERIES_ERROR_MAX = 1e-12;
const SERIES_RELATIVE_TOLERANCE = 8 * Number.EPSILON;
const SERIES_MAX_STEPS = 1000000;

/** How many Poisson terms R's mixture below a noncentrality of 80 may take. */
const MIXTURE_MAX_TERMS = 110;

/**
 * The noncentral probability, R's `pchisq(x, df, ncp)`.
 *
 * The clamps after the series are R's own. At a noncentrality of 80 or more
 * the series computes the lower tail and the upper tail comes from
 * subtraction, so R guards against a sum that has drifted outside 0 to 1.
 */
function nonCentralProbability(
  x: number,
  df: number,
  ncp: number,
  lowerTail: boolean,
): number {
  const answer = nonCentralRaw(x, df, ncp, lowerTail);
  if (x <= 0 || !Number.isFinite(x)) {
    return answer;
  }
  if (ncp >= 80) {
    if (lowerTail) {
      return Math.min(answer, 1);
    }
    return answer < 0 ? 0 : answer;
  }
  return answer;
}

/** R's `pnchisq_raw`, with its two regimes. */
function nonCentralRaw(
  x: number,
  df: number,
  ncp: number,
  lowerTail: boolean,
): number {
  if (!(x > 0)) {
    if (x === 0 && df === 0) {
      // The chi-square on zero degrees of freedom has a point mass at zero.
      return lowerTail ? Math.exp(-0.5 * ncp) : -Math.expm1(-0.5 * ncp);
    }
    return lowerTail ? 0 : 1;
  }
  if (!Number.isFinite(x)) {
    return lowerTail ? 1 : 0;
  }
  return ncp < 80
    ? poissonMixture(x, df, ncp, lowerTail)
    : dingSeries(x, df, ncp, lowerTail);
}

/**
 * The Poisson mixture R uses below a noncentrality of 80.
 *
 * The noncentral distribution is a Poisson-weighted mixture of central ones,
 * two degrees of freedom apart. R sums the weights alongside the terms and
 * divides by them at the end, which renormalizes a sum that the 110-term cap
 * would otherwise leave short of one.
 *
 * Index loop with a stated reason: each pass advances one Poisson weight by
 * recurrence and the loop stops on the mass already gathered, not on a length.
 */
function poissonMixture(
  x: number,
  df: number,
  ncp: number,
  lowerTail: boolean,
): number {
  const lambda = 0.5 * ncp;

  // Below this x every central term of the lower tail underflows on its own,
  // so the whole mixture has to be summed in the log scale. The test is R's:
  // pgamma(x, s) is under x^s / Γ(s + 1), which is under the smallest double.
  if (
    lowerTail &&
    df > 0 &&
    Math.log(x) <
      Math.LN2 + (2 / df) * (logGamma(df / 2 + 1) + LOG_SMALLEST_NORMAL)
  ) {
    const logLambda = Math.log(lambda);
    let logWeight = -lambda;
    let logSum = Number.NEGATIVE_INFINITY;
    let logWeightSum = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < MIXTURE_MAX_TERMS; ) {
      logWeightSum = logspaceAdd(logWeightSum, logWeight);
      logSum = logspaceAdd(
        logSum,
        logWeight + logCentralProbability(x, df + 2 * index, lowerTail),
      );
      if (logWeightSum >= -1e-15) {
        break;
      }
      index += 1;
      logWeight += logLambda - Math.log(index);
    }
    return Math.exp(logSum - logWeightSum);
  }

  let weight = Math.exp(-lambda);
  let sum = 0;
  let weightSum = 0;
  for (let index = 0; index < MIXTURE_MAX_TERMS; ) {
    weightSum += weight;
    sum += weight * centralProbability(x, df + 2 * index, lowerTail);
    if (weightSum >= 1 - 1e-15) {
      break;
    }
    index += 1;
    weight *= lambda / index;
  }
  return sum / weightSum;
}

/** log(e^a + e^b), R's `logspace_add`, with both ends at minus infinity. */
function logspaceAdd(a: number, b: number): number {
  if (a === Number.NEGATIVE_INFINITY) {
    return b;
  }
  if (b === Number.NEGATIVE_INFINITY) {
    return a;
  }
  return Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b)));
}

/**
 * The AS 275 series of Ding (1992), which R uses at a noncentrality of 80 or
 * more.
 *
 * The series builds the lower tail from two running factors: `poisson`, the
 * Poisson mass gathered so far, and `term`, the central chi-square density
 * term. Either can underflow well before the answer does, so each carries a
 * log twin that takes over while it is too small to hold as a double.
 *
 * Index loop with a stated reason: every quantity steps by recurrence and the
 * loop stops on R's paired absolute and relative bound.
 */
function dingSeries(
  x: number,
  df: number,
  ncp: number,
  lowerTail: boolean,
): number {
  const lambda = 0.5 * ncp;
  const halfX = 0.5 * x;
  const halfDf = 0.5 * df;

  let poissonSmall = -lambda < LOG_SMALLEST_NORMAL;
  let weight = poissonSmall ? 0 : Math.exp(-lambda);
  let logWeight = -lambda;
  const logLambda = Math.log(lambda);
  let poisson = weight;

  const offset = halfX - halfDf;
  let logTerm =
    halfDf * Number.EPSILON > 0.125 &&
    Math.abs(offset) < Math.sqrt(Number.EPSILON) * halfDf
      ? // Very large df with x near df: the plain form cancels, so R takes
        // the expansion of the same quantity instead.
        (1 - offset) * (2 - offset / (halfDf + 1)) -
        LOG_SQRT_TWO_PI -
        0.5 * Math.log(halfDf + 1)
      : halfDf * Math.log(halfX) - halfX - logGamma(halfDf + 1);

  let termSmall = logTerm < LOG_SMALLEST_NORMAL;
  let density = 0;
  let answer = 0;
  let term = 0;
  const logX = Math.log(x);
  if (termSmall) {
    if (x > df + ncp + 5 * Math.sqrt(2 * (df + 2 * ncp))) {
      // Past five standard deviations above the mean the lower tail is one.
      return lowerTail ? 1 : 0;
    }
  } else {
    density = Math.exp(logTerm);
    term = poisson * density;
    answer = term;
  }

  let shifted = df + 2;
  let gap = df - x + 2;
  for (let step = 1; step <= SERIES_MAX_STEPS; step += 1) {
    if (gap > 0) {
      const bound = (density * x) / gap;
      if (bound <= SERIES_ERROR_MAX && term <= SERIES_RELATIVE_TOLERANCE * answer) {
        break;
      }
    }

    if (poissonSmall) {
      logWeight += logLambda - Math.log(step);
      if (logWeight >= LOG_SMALLEST_NORMAL) {
        weight = Math.exp(logWeight);
        poisson = weight;
        poissonSmall = false;
      }
    } else {
      weight *= lambda / step;
      poisson += weight;
    }

    if (termSmall) {
      logTerm += logX - Math.log(shifted);
      if (logTerm >= LOG_SMALLEST_NORMAL) {
        density = Math.exp(logTerm);
        termSmall = false;
      }
    } else {
      density *= x / shifted;
    }

    if (!poissonSmall && !termSmall) {
      term = poisson * density;
      answer += term;
    }

    shifted += 2;
    gap += 2;
  }

  return lowerTail ? answer : 1 - answer;
}

/* ------------------------------------------------------------------ */
/* The quantile, following R's qgamma.c                                */
/* ------------------------------------------------------------------ */

/** The AS 91 rational-approximation constants for a small degrees of freedom. */
const AS91_C7 = 4.67;
const AS91_C8 = 6.66;
const AS91_C9 = 6.73;
const AS91_C10 = 13.32;

/** R's tolerances: the starting value, the AS 91 refinement, and Newton. */
const START_TOLERANCE = 1e-2;
const REFINE_TOLERANCE = 5e-7;
const NEWTON_TOLERANCE = 1e-15;

/** How many refinement passes R allows before it falls back on Newton. */
const REFINE_MAX_STEPS = 1000;

/** Outside this range of probability R skips the refinement and uses Newton. */
const PROBABILITY_MIN = 1e-100;
const PROBABILITY_MAX = 1 - 1e-14;

/** The smallest normal double, C's `DBL_MIN`, which R's Newton starts from. */
const SMALLEST_NORMAL = 2.2250738585072014e-308;

const I420 = 1 / 420;
const I2520 = 1 / 2520;
const I5040 = 1 / 5040;

/**
 * R's `qgamma()`, restricted to the plain probability scale.
 *
 * Three phases, as R runs them. The AS 91 starting value comes first. Where
 * it lands in the well-behaved middle, the seven-term Taylor series of AS 91
 * refines it. In every case R closes with Newton steps on the log of the
 * probability, which is what carries a tail that has no digits left on the
 * plain scale.
 */
function quantileGamma(
  p: number,
  alpha: number,
  scale: number,
  lowerTail: boolean,
): number {
  if (alpha < 0 || scale <= 0) {
    return Number.NaN;
  }
  if (alpha === 0) {
    // All the mass sits at zero.
    return 0;
  }

  let newtonSteps = alpha < 1e-10 ? 7 : 1;
  const lower = lowerTail ? p : 0.5 - p + 0.5;
  const logGammaAlpha = logGamma(alpha);

  let ch = startingValue(p, 2 * alpha, logGammaAlpha, lowerTail, START_TOLERANCE);
  let refine = true;
  if (!Number.isFinite(ch)) {
    newtonSteps = 0;
    refine = false;
  } else if (ch < REFINE_TOLERANCE) {
    newtonSteps = 20;
    refine = false;
  } else if (lower > PROBABILITY_MAX || lower < PROBABILITY_MIN) {
    newtonSteps = 20;
    refine = false;
  }

  if (refine) {
    const c = alpha - 1;
    const s6 = (120 + c * (346 + 127 * c)) * I5040;
    const start = ch;

    // Index loop with a stated reason: this refines a single value and stops
    // on a convergence test.
    for (let step = 1; step <= REFINE_MAX_STEPS; step += 1) {
      const previous = ch;
      const half = 0.5 * ch;
      const residual = lower - regularizedGammaP(alpha, half);
      if (!Number.isFinite(residual) || ch <= 0) {
        ch = start;
        newtonSteps = 27;
        break;
      }

      const t =
        residual *
        Math.exp(alpha * Math.LN2 + logGammaAlpha + half - c * Math.log(ch));
      const b = t / ch;
      const a = 0.5 * t - b * c;
      const s1 = (210 + a * (140 + a * (105 + a * (84 + a * (70 + 60 * a))))) * I420;
      const s2 = (420 + a * (735 + a * (966 + a * (1141 + 1278 * a)))) * I2520;
      const s3 = (210 + a * (462 + a * (707 + 932 * a))) * I2520;
      const s4 =
        (252 + a * (672 + 1182 * a) + c * (294 + a * (889 + 1740 * a))) * I5040;
      const s5 = (84 + 2264 * a + c * (1175 + 606 * a)) * I2520;

      ch +=
        t *
        (1 + 0.5 * t * s1 - b * c * (s1 - b * (s2 - b * (s3 - b * (s4 - b * (s5 - b * s6))))));
      if (Math.abs(previous - ch) < REFINE_TOLERANCE * ch) {
        break;
      }
      if (Math.abs(previous - ch) > 0.1 * ch) {
        // Diverging. Pull the step back, which also holds ch above zero.
        ch = ch < previous ? 0.9 * previous : 1.1 * previous;
      }
    }
  }

  return newtonPolish(0.5 * scale * ch, p, alpha, scale, lowerTail, newtonSteps);
}

/**
 * R's `qchisq_appr()`: the AS 91 starting value of Best and Roberts.
 *
 * Three cases, by how the degrees of freedom compare with the log of the
 * probability: a closed form for a chi-square driven small, the Wilson and
 * Hilferty cube-root fit through the normal quantile in the usual case, and a
 * short iteration for a degrees of freedom below 0.32.
 */
function startingValue(
  p: number,
  df: number,
  logGammaAlpha: number,
  lowerTail: boolean,
  tolerance: number,
): number {
  const alpha = 0.5 * df;
  const c = alpha - 1;
  const logP = lowerTail ? Math.log(p) : Math.log1p(-p);
  const logComplement = lowerTail ? Math.log1p(-p) : Math.log(p);

  if (df < -1.24 * logP) {
    // A small chi-square. Writing log(α · Γ(α)) as log Γ(α + 1) keeps the
    // cancellation out of the answer for an α well below one.
    const logAlphaGamma =
      alpha < 0.5 ? logGamma(1 + alpha) : Math.log(alpha) + logGammaAlpha;
    return Math.exp((logAlphaGamma + logP) / alpha + Math.LN2);
  }

  if (df > 0.32) {
    const z = qnorm(p, { lowerTail });
    const scaled = 2 / (9 * df);
    let ch = df * Math.pow(z * Math.sqrt(scaled) + 1 - scaled, 3);
    if (ch > 2.2 * df + 6) {
      // The cube-root fit runs out where p approaches one.
      ch = -2 * (logComplement - c * Math.log(0.5 * ch) + logGammaAlpha);
    }
    return ch;
  }

  let ch = 0.4;
  const a = logComplement + logGammaAlpha + c * Math.LN2;
  let previous = ch;

  // Index loop with a stated reason: this refines a single value and stops on
  // a convergence test.
  do {
    previous = ch;
    const q1 = 1 / (1 + ch * (AS91_C7 + ch));
    const q2 = ch * (AS91_C9 + ch * (AS91_C8 + ch));
    const slope =
      -0.5 + (AS91_C7 + 2 * ch) * q1 - (AS91_C9 + ch * (AS91_C10 + 3 * ch)) / q2;
    ch -= (1 - Math.exp(a + 0.5 * ch) * q2 * q1) / slope;
  } while (Math.abs(previous - ch) > tolerance * Math.abs(ch));

  return ch;
}

/**
 * R's closing Newton steps, taken on the log of the probability.
 *
 * The log scale is what makes the far tails work: a probability of 1e-300 has
 * no room to move on the plain scale, while its log does. R stops as soon as
 * a step stops improving, so a step that overshoots leaves the value alone
 * rather than replacing it with something worse.
 */
function newtonPolish(
  start: number,
  p: number,
  alpha: number,
  scale: number,
  lowerTail: boolean,
  maxSteps: number,
): number {
  let x = start;
  if (maxSteps === 0) {
    return x;
  }

  const logP = Math.log(p);
  if (x === 0) {
    // The starting value underflowed. Test the smallest normal double: if the
    // probability there already sits above the target, zero is the answer.
    x = SMALLEST_NORMAL;
    const atFloor = logProbability(x, alpha, scale, lowerTail);
    if (
      (lowerTail && atFloor > logP * (1 + 1e-7)) ||
      (!lowerTail && atFloor < logP * (1 - 1e-7))
    ) {
      return 0;
    }
  }

  let atX = logProbability(x, alpha, scale, lowerTail);
  if (atX === Number.NEGATIVE_INFINITY) {
    return 0;
  }

  // Index loop with a stated reason: this refines a single root and stops on
  // a convergence test.
  for (let step = 1; step <= maxSteps; step += 1) {
    const residual = atX - logP;
    if (Math.abs(residual) < Math.abs(NEWTON_TOLERANCE * logP)) {
      break;
    }

    const logDensity = logGammaDensity(x, alpha, scale);
    if (logDensity === Number.NEGATIVE_INFINITY) {
      break;
    }

    const move = residual * Math.exp(atX - logDensity);
    const next = lowerTail ? x - move : x + move;
    const atNext = logProbability(next, alpha, scale, lowerTail);
    const before = Math.abs(residual);
    const after = Math.abs(atNext - logP);
    if (after > before || (step > 1 && after === before)) {
      break;
    }

    x = next;
    atX = atNext;
  }

  return x;
}

/** The log of a gamma tail, R's `pgamma(x, alpha, scale, log.p = TRUE)`. */
function logProbability(
  x: number,
  alpha: number,
  scale: number,
  lowerTail: boolean,
): number {
  return lowerTail
    ? logRegularizedGammaP(alpha, x / scale)
    : logRegularizedGammaQ(alpha, x / scale);
}

/** The log of the gamma density, R's `dgamma(x, alpha, scale, log = TRUE)`. */
function logGammaDensity(x: number, alpha: number, scale: number): number {
  return (
    (alpha - 1) * Math.log(x) -
    x / scale -
    logGamma(alpha) -
    alpha * Math.log(scale)
  );
}
