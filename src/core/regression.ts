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
 * The indices of the rows a fit may use: both coordinates finite.
 *
 * This is R's `na.omit` for a set of points. NaN is this library's missing
 * value, and an infinity would poison a fit the same way, so "complete" means
 * finite everywhere — the rule `moderationSurface` set for frames. The point
 * cores (this module, `logit.ts`, `pca.ts`) share the rule through this
 * helper.
 */
export function completePointRows(points: readonly Point[]): readonly number[] {
  return points.flatMap((point, row) =>
    Number.isFinite(point.x) && Number.isFinite(point.y) ? [row] : [],
  );
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
  /**
   * The fitted y value of each point, in input order. NaN where the point
   * was dropped for a missing value.
   */
  readonly fitted: readonly number[];
}

/**
 * Fit a line to the points.
 *
 * With no variation in x, the function fits the mean of y and reports no
 * slope. R does the same: it drops the singular predictor and fits an
 * intercept-only model. A single point is that same case.
 *
 * A point with a non-finite coordinate is dropped before fitting, R's
 * `na.action = na.omit`; its fitted value reports NaN, keeping input order
 * (R's `na.exclude` padding, as `moderationSurface` does). R's `lm()` errors
 * when every row is missing ("0 (non-NA) cases"); this port already answers
 * null for "nothing to fit", and an all-missing input is that same answer.
 *
 * @param points The observations. The function does not modify them.
 * @returns The fit, or null if no point is complete.
 */
export function linearRegression(
  points: readonly Point[],
): RegressionFit | null {
  const rows = completePointRows(points);
  if (rows.length === 0) {
    return null;
  }

  const xs = rows.map((row) => (points[row] as Point).x);
  const ys = rows.map((row) => (points[row] as Point).y);
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

  const fittedComplete = xs.map((x) =>
    slope === null ? intercept : intercept + slope * x,
  );

  const ssr = sum(fittedComplete.map((f) => (f - meanY) * (f - meanY)));
  const sse = sum(zipWith(ys, fittedComplete, (y, f) => (y - f) * (y - f)));
  const sst = sumSquaresY;
  const rSquared = sst === 0 ? null : ssr / sst;

  // R's na.exclude padding: report the fit in input order, NaN where a
  // point was dropped.
  const fitted = new Array<number>(points.length).fill(Number.NaN);
  rows.forEach((row, survivor) => {
    fitted[row] = fittedComplete[survivor] as number;
  });

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
