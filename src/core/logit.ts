/**
 * Logistic regression, the statistics half of `plot_logit()` in the R package.
 *
 * R gets these numbers from `glm(formula, family = binomial)`, which fits by
 * iteratively reweighted least squares: each pass builds a working response
 * and a set of weights from the current fit, then solves an ordinary weighted
 * least-squares problem. This module follows `stats::glm.fit` step for step,
 * down to its starting values, its convergence test, and the two clamped link
 * functions R implements in C. Verified against R in `logit.test.ts`.
 *
 * The clamps are not a detail. R's `linkinv` pins a linear predictor beyond
 * ±30 to a probability one machine epsilon away from 0 or 1, which is what
 * keeps a perfectly separated fit — the classroom case where every low x is a
 * 0 and every high x is a 1 — producing finite numbers instead of dividing by
 * zero.
 */

import { mean, sum, zipWith } from "./arith";
import { leastSquares } from "./ols";
import { completePointRows } from "./regression";
import type { Point } from "./regression";

/** The convergence threshold and iteration cap of R's `glm.control()`. */
export const DEFAULT_LOGIT_EPSILON = 1e-8;
export const DEFAULT_LOGIT_MAX_ITERATIONS = 25;

export interface LogitOptions {
  /**
   * How small the relative change in deviance must be to stop. R's
   * `glm.control(epsilon =)`.
   */
  readonly epsilon?: number;
  /** How many IRLS passes to allow. R's `glm.control(maxit =)`. */
  readonly maxIterations?: number;
}

/**
 * The result of a fit.
 *
 * A `null` slope is the equivalent of R's `NA`: with no variation in x the
 * QR aliases the column and R reports "1 not defined because of
 * singularities". `linearRegression` uses the same convention.
 */
export interface LogitFit {
  /** The linear predictor at x = 0. */
  readonly intercept: number;
  /** The change in the log odds for each unit of x. Null if x is constant. */
  readonly slope: number | null;
  /**
   * The fitted probability of each point, in input order. NaN where the
   * point was dropped for a missing value.
   */
  readonly fitted: readonly number[];
  /**
   * The log odds of each point, in input order. NaN where the point was
   * dropped for a missing value.
   */
  readonly linearPredictors: readonly number[];
  /** Residual deviance of the fitted model. */
  readonly deviance: number;
  /** Deviance of the intercept-only model. */
  readonly nullDeviance: number;
  /** Akaike information criterion, the fit statistic `plot_logit` displays. */
  readonly aic: number;
  /** How many coefficients the fit could identify. */
  readonly rank: number;
  /** How many IRLS passes ran. */
  readonly iterations: number;
  /** Whether the deviance settled before the iteration cap. */
  readonly converged: boolean;
  /**
   * Whether any fitted probability landed within `10 * Number.EPSILON` of 0
   * or 1.
   *
   * This is the condition behind R's "fitted probabilities numerically 0 or 1
   * occurred" warning, which `plot_logit` suppresses. It reports separation:
   * the data admit no maximum likelihood estimate and only the iteration cap
   * stopped the coefficients from growing. A browser library cannot warn, so
   * the fit reports the condition and lets the caller decide.
   */
  readonly saturated: boolean;
}

/** Where R's C link functions stop computing and start clamping. */
const LINK_THRESHOLD = 30;
/** R's warning threshold for a probability that has reached 0 or 1. */
const BOUND = 10 * Number.EPSILON;

/**
 * Fit the log odds of y as a straight line in x.
 *
 * With no variation in x the fit reports an intercept and no slope, the way
 * R's aliasing does. A single point is that same case: R fits the intercept
 * and reports the slope as `NA`. `plot_logit` never reaches either — it draws
 * the points and returns before fitting fewer than two of them — so the guard
 * belongs to the plot layer and this function reports the honest degenerate
 * fit.
 *
 * A point with a non-finite coordinate is dropped before fitting, R's
 * `na.action = na.omit`; its fitted probability and linear predictor report
 * NaN, keeping input order (R's `na.exclude` padding, as `moderationSurface`
 * does). The 0-or-1 rule below applies to the rows that remain: R's
 * `na.omit` removes an incomplete row before `glm()` ever sees its outcome.
 *
 * @param points The observations. Each complete y must be 0 or 1. The
 *   function does not modify them.
 * @param options The convergence controls.
 * @returns The fit, or null if no point is complete.
 * @throws RangeError if a complete row's y is not 0 or 1. R accepts any y in
 *   [0, 1] for the binomial family; this port does not, because the points
 *   come from clicks and because the AIC below assumes a 0/1 outcome.
 */
export function logisticRegression(
  points: readonly Point[],
  options: LogitOptions = {},
): LogitFit | null {
  const {
    epsilon = DEFAULT_LOGIT_EPSILON,
    maxIterations = DEFAULT_LOGIT_MAX_ITERATIONS,
  } = options;

  const rows = completePointRows(points);
  if (rows.length === 0) {
    return null;
  }
  const complete = rows.map((row) => points[row] as Point);
  if (complete.some((point) => point.y !== 0 && point.y !== 1)) {
    throw new RangeError("every outcome must be 0 or 1");
  }

  const outcomes = complete.map((point) => point.y);
  const design = complete.map((point) => [1, point.x]);

  // R's binomial starting values: (weights * y + 0.5) / (weights + 1), which
  // at unit weights puts a 0 at 0.25 and a 1 at 0.75, then takes the link.
  let fitted = outcomes.map((outcome) => (outcome + 0.5) / 2);
  let predictors = fitted.map(logit);
  let previousDeviance = totalDeviance(outcomes, fitted);
  let deviance = previousDeviance;

  let coefficients: readonly (number | null)[] = [Number.NaN, null];
  let rank = 0;
  let iterations = 0;
  let converged = false;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterations = iteration;

    // One pass builds both IRLS quantities from the same row, so they are
    // computed together rather than in two walks over parallel arrays.
    const working = predictors.map((predictor, row) => {
      const probability = fitted[row] as number;
      const slope = linkSlope(predictor);
      return {
        weight: (slope * slope) / (probability * (1 - probability)),
        response: predictor + ((outcomes[row] as number) - probability) / slope,
      };
    });

    const step = leastSquares(
      design,
      working.map((row) => row.response),
      {
        weights: working.map((row) => row.weight),
        // R: min(1e-7, control$epsilon / 1000).
        tolerance: Math.min(1e-7, epsilon / 1000),
      },
    );

    // R abandons the fit rather than adopting coefficients it cannot use.
    if (
      step.coefficients.some(
        (coefficient) => coefficient !== null && !Number.isFinite(coefficient),
      )
    ) {
      break;
    }

    coefficients = step.coefficients;
    rank = step.rank;
    // An aliased coefficient counts as zero here. R's QR returns 0 for it
    // during the loop and only reports NA once the fit is over.
    predictors = design.map((row) =>
      sum(
        zipWith(row, coefficients, (value, coefficient) =>
          coefficient === null ? 0 : value * coefficient,
        ),
      ),
    );
    fitted = predictors.map(linkInverse);
    deviance = totalDeviance(outcomes, fitted);

    if (
      Math.abs(deviance - previousDeviance) / (0.1 + Math.abs(deviance)) <
      epsilon
    ) {
      converged = true;
      break;
    }
    previousDeviance = deviance;
  }

  const wholeMean = mean(outcomes);
  const nullDeviance = totalDeviance(
    outcomes,
    outcomes.map(() => wholeMean),
  );

  // R's na.exclude padding: report the fit in input order, NaN where a
  // point was dropped.
  const paddedFitted = new Array<number>(points.length).fill(Number.NaN);
  const paddedPredictors = new Array<number>(points.length).fill(Number.NaN);
  rows.forEach((row, survivor) => {
    paddedFitted[row] = fitted[survivor] as number;
    paddedPredictors[row] = predictors[survivor] as number;
  });

  return {
    // The leading column of ones always carries norm, so the QR cannot alias
    // the intercept.
    intercept: coefficients[0] ?? Number.NaN,
    slope: coefficients[1] ?? null,
    fitted: paddedFitted,
    linearPredictors: paddedPredictors,
    deviance,
    nullDeviance,
    // R evaluates the binomial log likelihood and adds 2 * rank. For a 0/1
    // outcome at unit weights the saturated log likelihood is 0, so that
    // evaluation is the deviance itself, term for term.
    aic: deviance + 2 * rank,
    rank,
    iterations,
    converged,
    saturated: fitted.some(
      (probability) => probability > 1 - BOUND || probability < BOUND,
    ),
  };
}

/**
 * The fitted probability at one x.
 *
 * `plot_logit` draws its curve from 500 of these. An aliased slope holds the
 * curve flat, which is what R's `predict()` does with an `NA` coefficient
 * dropped from the model.
 */
export function predictLogit(fit: LogitFit, x: number): number {
  return linkInverse(fit.intercept + (fit.slope ?? 0) * x);
}

/** The logit link: log odds of a probability. */
function logit(probability: number): number {
  return Math.log(probability / (1 - probability));
}

/**
 * The inverse link, with R's clamps.
 *
 * R's `C_logit_linkinv` never lets a probability reach 0 or 1: beyond a linear
 * predictor of ±30 it substitutes odds of `eps` or `1 / eps`. That is what
 * produces the saturated 2.2204460492503126e-16 and 0.99999999999999978 of a
 * separated fit, and what keeps the deviance finite there.
 */
function linkInverse(predictor: number): number {
  const odds =
    predictor < -LINK_THRESHOLD
      ? Number.EPSILON
      : predictor > LINK_THRESHOLD
        ? 1 / Number.EPSILON
        : Math.exp(predictor);
  return odds / (1 + odds);
}

/**
 * The derivative of the inverse link, with R's clamps.
 *
 * Algebraically this is the binomial variance `mu * (1 - mu)`, but R computes
 * it from the linear predictor as `exp(eta) / (1 + exp(eta))^2` and clamps it
 * to `eps` beyond ±30. The two differ in the last two digits — at
 * `eta = log(3)` R gives 0.18750000000000003 against 0.18749999999999994 —
 * and the IRLS weights carry that difference into every coefficient, so this
 * follows R rather than the tidier identity.
 */
function linkSlope(predictor: number): number {
  if (predictor > LINK_THRESHOLD || predictor < -LINK_THRESHOLD) {
    return Number.EPSILON;
  }
  const odds = Math.exp(predictor);
  return odds / ((1 + odds) * (1 + odds));
}

/** R's binomial `dev.resids`, summed. */
function totalDeviance(
  outcomes: readonly number[],
  probabilities: readonly number[],
): number {
  return sum(
    zipWith(
      outcomes,
      probabilities,
      (outcome, probability) =>
        2 *
        (surprise(outcome, probability) +
          surprise(1 - outcome, 1 - probability)),
    ),
  );
}

/** One side of a deviance residual. R writes this as `y_log_y`. */
function surprise(outcome: number, probability: number): number {
  return outcome !== 0 ? outcome * Math.log(outcome / probability) : 0;
}
