/**
 * Dense (weighted) least squares for small designs.
 *
 * This is the equivalent of R's `lm.wfit()`, and of the solver R runs inside
 * every step of `glm.fit()`'s IRLS loop. R factors the design with `dqrdc2`,
 * a Householder QR with a limited column-pivoting rule: a column whose norm
 * has collapsed against the columns to its left is moved to the right edge
 * and its coefficient is reported as `NA`. That factorization lives in
 * `linalg/qr.ts` as R's `qr()`; this module is the `lm.wfit()` wrapper over
 * it — the square-root weighting, the row-array interface the fitting
 * functions use, and the fitted values as `X · β`. Verified against R in
 * `ols.test.ts`.
 */

import { sum, zipWith } from "./arith";
import { fromRows } from "./linalg/matrix";
import { qr, qrCoef } from "./linalg/qr";

/**
 * The result of a fit.
 *
 * A `null` coefficient is the equivalent of R's `NA`: the column carried no
 * information beyond the columns to its left, so R aliases it. `linearRegression`
 * uses the same convention.
 */
export interface LeastSquaresFit {
  /**
   * One coefficient per design column, in column order. An aliased column
   * reports null.
   */
  readonly coefficients: readonly (number | null)[];
  /** The fitted response of each row, in input order. */
  readonly fitted: readonly number[];
  /** Response minus fit, of each row, in input order. */
  readonly residuals: readonly number[];
  /** The number of columns the fit could identify. */
  readonly rank: number;
}

export interface LeastSquaresOptions {
  /**
   * One weight per row, on R's `lm.wfit()` scale: the solver applies the
   * square root itself.
   *
   * IRLS is the trap here. `glm.fit` carries square-root weights `w` and
   * hands `x * w` to its QR routine, so a caller porting that loop passes
   * `w * w` here, not `w`.
   *
   * A weight of zero drops the row from the fit. The row still gets a fitted
   * value, predicted from the other rows, as it does in R.
   */
  readonly weights?: readonly number[];
  /**
   * How far a column's norm may collapse before the fit aliases it.
   *
   * A column is aliased when its norm, after the columns to its left are
   * projected out, falls below this fraction of its original norm. The
   * default is the value `lm.fit()` uses. `glm.fit()` passes
   * `min(1e-7, epsilon / 1000)`, which is `1e-11` at R's default epsilon.
   */
  readonly tolerance?: number;
}

/** The rank tolerance of R's `lm.fit()`. */
export const DEFAULT_LEAST_SQUARES_TOLERANCE = 1e-7;

/**
 * Fit `y` on the columns of `design` by least squares.
 *
 * @param design One row per observation, each row one value per column. A
 *   model with an intercept carries a leading column of ones. The function
 *   does not modify it.
 * @param y The response, one value per row.
 * @param options Weights and the rank tolerance.
 * @returns The coefficients, the fit, and the rank.
 * @throws RangeError if there are no rows, if the shapes disagree, or if a
 *   weight is negative. R refuses the same inputs: "0 (non-NA) cases" and
 *   "missing or negative weights not allowed".
 */
export function leastSquares(
  design: readonly (readonly number[])[],
  y: readonly number[],
  options: LeastSquaresOptions = {},
): LeastSquaresFit {
  const { weights, tolerance = DEFAULT_LEAST_SQUARES_TOLERANCE } = options;
  const rows = design.length;

  if (rows === 0) {
    throw new RangeError("least squares needs at least one row");
  }
  const width = (design[0] as readonly number[]).length;
  if (design.some((row) => row.length !== width)) {
    throw new RangeError("every design row needs the same number of columns");
  }
  if (y.length !== rows) {
    throw new RangeError(
      `the response has ${y.length} values but the design has ${rows} rows`,
    );
  }
  if (weights !== undefined) {
    if (weights.length !== rows) {
      throw new RangeError(
        `there are ${weights.length} weights but ${rows} rows`,
      );
    }
    if (weights.some((weight) => !(weight >= 0))) {
      throw new RangeError("weights cannot be negative or missing");
    }
  }

  // Scale each row by the square root of its weight, which turns the weighted
  // problem into an ordinary one. This is what lm.wfit and glm.fit both do.
  const scale = weights?.map((weight) => Math.sqrt(weight));
  const scaled = (value: number, row: number): number =>
    scale === undefined ? value : value * (scale[row] as number);

  const factored = qr(
    fromRows(design.map((row, index) => row.map((value) => scaled(value, index)))),
    { tolerance },
  );
  const coefficients = qrCoef(factored, y.map(scaled));

  const fitted = design.map((row) =>
    sum(
      zipWith(row, coefficients, (value, coefficient) =>
        coefficient === null ? 0 : value * coefficient,
      ),
    ),
  );
  const residuals = zipWith(y, fitted, (value, fit) => value - fit);

  return { coefficients, fitted, residuals, rank: factored.rank };
}
