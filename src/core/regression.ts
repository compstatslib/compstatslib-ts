/**
 * Ordinary least-squares regression of y on x.
 *
 * This is the statistics half of `plot_regression()` in the R package. R gets these
 * numbers from `lm()`, `cor()`, and `summary()$r.squared`. Verified against R
 * in `regression.test.ts`.
 */

import { mean, sum, zipWith } from "./arith";

/** One observation. R holds these as rows of a data frame. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The result of a fit.
 *
 * A `null` field is the equivalent of R's `NA`. R drops a singular predictor
 * and reports `NA` for its coefficient. This port reports `null`, which makes
 * strict TypeScript force the caller to handle the degenerate fit.
 */
export interface RegressionFit {
  /** The y value where the line crosses x = 0. */
  readonly intercept: number;
  /** The change in y for each unit of x. Null if x has no variation. */
  readonly slope: number | null;
  /** Pearson r. Null if x or y has no variation. */
  readonly correlation: number | null;
  /** Sum of squares regression. */
  readonly ssr: number;
  /** Sum of squares error. */
  readonly sse: number;
  /** Sum of squares total. */
  readonly sst: number;
  /** The part of SST that the fit explains. Null if SST is 0. */
  readonly rSquared: number | null;
  /** The fitted y value of each point, in input order. */
  readonly fitted: readonly number[];
}

/**
 * Fit a line to the points.
 *
 * With no variation in x, the function fits the mean of y and reports no
 * slope. R does the same: it drops the singular predictor and fits an
 * intercept-only model. A single point is that same case.
 *
 * @param points The observations. The function does not modify them.
 * @returns The fit, or null if there are no points.
 */
export function linearRegression(
  points: readonly Point[],
): RegressionFit | null {
  if (points.length === 0) {
    return null;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const meanX = mean(xs);
  const meanY = mean(ys);

  const devX = xs.map((x) => x - meanX);
  const devY = ys.map((y) => y - meanY);
  const sumSquaresX = sum(devX.map((d) => d * d));
  const sumSquaresY = sum(devY.map((d) => d * d));
  const sumProducts = sum(zipWith(devX, devY, (dx, dy) => dx * dy));

  const slope = sumSquaresX === 0 ? null : sumProducts / sumSquaresX;
  const intercept = slope === null ? meanY : meanY - slope * meanX;
  const correlation =
    sumSquaresX === 0 || sumSquaresY === 0
      ? null
      : sumProducts / Math.sqrt(sumSquaresX * sumSquaresY);

  const fitted = xs.map((x) =>
    slope === null ? intercept : intercept + slope * x,
  );

  const ssr = sum(fitted.map((f) => (f - meanY) * (f - meanY)));
  const sse = sum(zipWith(ys, fitted, (y, f) => (y - f) * (y - f)));
  const sst = sumSquaresY;
  const rSquared = sst === 0 ? null : ssr / sst;

  return {
    intercept,
    slope,
    correlation,
    ssr,
    sse,
    sst,
    rSquared,
    fitted,
  };
}
