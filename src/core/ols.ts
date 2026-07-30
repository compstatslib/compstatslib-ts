/**
 * Dense (weighted) least squares for small designs.
 *
 * This is the equivalent of R's `lm.wfit()`, and of the solver R runs inside
 * every step of `glm.fit()`'s IRLS loop. R factors the design with `dqrdc2`,
 * a Householder QR with a limited column-pivoting rule: a column whose norm
 * has collapsed against the columns to its left is moved to the right edge
 * and its coefficient is reported as `NA`. The port reproduces that rule,
 * because it is what makes `lm()` and `glm()` report an aliased coefficient
 * instead of dividing by a near-zero pivot. Verified against R in
 * `ols.test.ts`.
 *
 * Designs here are tiny — two columns for logit, four for a moderation
 * surface — so the code follows the LINPACK routine plainly rather than
 * blocking or vectorizing it.
 */

import { sum, zipWith } from "./arith";

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
  const width = design[0].length;
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
    scale === undefined ? value : value * scale[row];

  const columns = Array.from({ length: width }, (_, column) =>
    design.map((row, index) => scaled(row[column], index)),
  );
  const projected = y.map(scaled);

  const { householders, pivot, rank } = decompose(columns, tolerance, rows);
  applyHouseholders(columns, householders, projected, Math.min(rank, rows - 1));
  const solved = backSubstitute(columns, projected, rank);

  // The solve returns the coefficients in pivot order. An aliased column
  // never reaches the solve and keeps its null, the way R reports NA.
  const coefficients = new Array<number | null>(width).fill(null);
  pivot.slice(0, rank).forEach((column, position) => {
    coefficients[column] = solved[position];
  });

  const fitted = design.map((row) =>
    sum(
      zipWith(row, coefficients, (value, coefficient) =>
        coefficient === null ? 0 : value * coefficient,
      ),
    ),
  );
  const residuals = zipWith(y, fitted, (value, fit) => value - fit);

  return { coefficients, fitted, residuals, rank };
}

/**
 * Factor the columns in place, R's way.
 *
 * `dqrdc2` walks the columns left to right. A column whose remaining norm has
 * fallen below `tolerance` times its original norm moves to the right edge and
 * the columns behind it shift left, so the columns that survive keep their
 * original order — which is why R can report the coefficients of a rank-
 * deficient fit in their own slots, with `NA` in the slot of the column it
 * dropped.
 *
 * On return each column holds its part of R above the diagonal and the
 * Householder vector below it, as LINPACK stores them.
 *
 * @returns The Householder scalars, the column order, and the rank.
 */
function decompose(
  columns: number[][],
  tolerance: number,
  rows: number,
): { householders: number[]; pivot: number[]; rank: number } {
  const width = columns.length;
  const pivot = columns.map((_, column) => column);
  // R substitutes 1 for a zero norm, so that an all-zero column compares as
  // negligible rather than dividing by zero.
  const originalNorms = columns.map((column) => norm(column, 0) || 1);
  const householders = new Array<number>(width).fill(0);
  // The count of columns still in play. R keeps this as `k` and rank is
  // min(k, rows) once the walk is over.
  let live = width;

  // Index loops throughout: a QR factorization addresses single matrix
  // entries by position, and this one follows LINPACK's dqrdc2 step for step.
  for (let step = 0; step < Math.min(rows, width); step++) {
    while (
      step < live &&
      norm(columns[step], step) < originalNorms[step] * tolerance
    ) {
      cycleToEnd(columns, pivot, originalNorms, step);
      live -= 1;
    }

    // The last row leaves nothing to reflect. R skips it and keeps the entry
    // as it stands, which is how a design with more columns than rows still
    // resolves the coefficients it can.
    if (step === rows - 1) {
      continue;
    }
    householders[step] = reflect(columns, step, rows);
  }

  return { householders, pivot, rank: Math.min(live, rows) };
}

/**
 * Build the Householder reflector of one column and apply it to the columns
 * to its right.
 *
 * @returns The leading entry of the reflector, which R keeps in `qraux`.
 */
function reflect(columns: number[][], step: number, rows: number): number {
  const column = columns[step];
  const length = norm(column, step);
  if (length === 0) {
    return 0;
  }
  // Reflect away from the leading entry, so that nothing cancels.
  const pivotNorm = column[step] < 0 ? -length : length;

  for (let row = step; row < rows; row++) {
    column[row] = column[row] / pivotNorm;
  }
  const leading = 1 + column[step];
  column[step] = leading;

  for (let index = step + 1; index < columns.length; index++) {
    const other = columns[index];
    let inner = 0;
    for (let row = step; row < rows; row++) {
      inner += column[row] * other[row];
    }
    const factor = -inner / leading;
    for (let row = step; row < rows; row++) {
      other[row] = other[row] + factor * column[row];
    }
  }

  column[step] = -pivotNorm;
  return leading;
}

/** Apply the stored reflectors to the response, giving Qᵀy. */
function applyHouseholders(
  columns: readonly number[][],
  householders: readonly number[],
  response: number[],
  count: number,
): void {
  const rows = response.length;

  for (let step = 0; step < count; step++) {
    const leading = householders[step];
    if (leading === 0) {
      continue;
    }
    const column = columns[step];
    // The reflector's leading entry lives outside the column, so the two
    // passes below read it separately from the entries under the diagonal.
    let inner = leading * response[step];
    for (let row = step + 1; row < rows; row++) {
      inner += column[row] * response[row];
    }
    const factor = -inner / leading;
    response[step] = response[step] + factor * leading;
    for (let row = step + 1; row < rows; row++) {
      response[row] = response[row] + factor * column[row];
    }
  }
}

/** Solve the leading `rank` columns of the triangular system. */
function backSubstitute(
  columns: readonly number[][],
  response: readonly number[],
  rank: number,
): number[] {
  const solved = new Array<number>(rank).fill(0);

  for (let row = rank - 1; row >= 0; row--) {
    let value = response[row];
    for (let column = row + 1; column < rank; column++) {
      value -= columns[column][row] * solved[column];
    }
    solved[row] = value / columns[row][row];
  }

  return solved;
}

/** Move one column to the right edge, sliding the rest left. */
function cycleToEnd(
  columns: number[][],
  pivot: number[],
  originalNorms: number[],
  step: number,
): void {
  moveToEnd(columns, step);
  moveToEnd(pivot, step);
  moveToEnd(originalNorms, step);
}

/** Move one entry of an array to its end, sliding the rest left. */
function moveToEnd<T>(track: T[], from: number): void {
  const [moved] = track.splice(from, 1) as [T];
  track.push(moved);
}

/** The Euclidean length of a column from `from` down. */
function norm(column: readonly number[], from: number): number {
  return Math.hypot(...column.slice(from));
}
