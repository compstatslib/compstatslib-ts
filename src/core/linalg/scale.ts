/**
 * R's `scale()`.
 *
 * R centers each column on its `colMeans` and then divides it by
 * `sqrt(Σv² / max(1, n − 1))` of the column **as it stands after
 * centering**. That divisor is the standard deviation when the column was
 * centered and the root mean square when it was not, which is why
 * `scale(x, center = FALSE)` is not `x / sd(x)`. Either argument may instead
 * be a vector of length `ncol`, and R then uses the values given.
 *
 * R reports what it used in the attributes `scaled:center` and
 * `scaled:scale`, and leaves an attribute absent when its argument was
 * `FALSE`. A `Matrix` here has no attribute slot, so the port returns them
 * as the fields `center` and `scale`, null where R leaves the attribute
 * absent. R's attributes carry the column names when the values were
 * computed; the port returns plain vectors, and the names stay where they
 * were, on `scaled.dimnames`.
 *
 * A column of zero variance divides by zero and gives NaN, which is R's own
 * result and comes with no warning. A missing value spreads through its
 * column, where R's `scale` drops it (its `colMeans` and its column function
 * both take `na.rm = TRUE`).
 *
 * The means and the sums of squares are plain running sums, as R's are.
 * `colMeans` takes the plain mean, not the refined mean that `cov()` takes.
 * Index loops throughout: the loops walk a column of a column-major matrix
 * by position, and a caller runs them on every bootstrap replication.
 * (CLAUDE.md allows an index loop with a stated reason; that is the reason.)
 *
 * Values are verified against R at 1e-15 relative, not pinned: R's own sum
 * may differ from the port's in the last bit
 * (`.claude/plans/004-PLAN-seminr-utilities/linalg-fixtures.md`, section 6).
 */

import { make, type Matrix } from "./matrix.js";
import type { Vector } from "./vector.js";

/** The named arguments of R's `scale()`. Both default to `true`. */
export interface ScaleOptions {
  /**
   * `true` to subtract each column's mean, `false` to leave the column
   * where it is, or the values to subtract, one per column.
   */
  readonly center?: boolean | Vector;
  /**
   * `true` to divide each column by its root mean square after centering,
   * `false` to leave it, or the divisors, one per column.
   */
  readonly scale?: boolean | Vector;
}

/** What R returns from `scale()`: the matrix and the two attributes. */
export interface Scaled {
  /** The scaled matrix, with the dimnames of `x`. */
  readonly scaled: Matrix;
  /** R's `scaled:center`, or null where the attribute is absent. */
  readonly center: Vector | null;
  /** R's `scaled:scale`, or null where the attribute is absent. */
  readonly scale: Vector | null;
}

/**
 * R's `scale()`: center and scale the columns of a matrix.
 *
 * @param x The matrix, whose columns are the variables.
 * @param options `center` and `scale`, each `true` (the default), `false`,
 *   or a vector of length `ncol(x)`.
 * @returns The scaled matrix and the center and scale that were used, null
 *   where the argument was `false`.
 * @throws RangeError If a vector argument is not `ncol(x)` long, in R's
 *   words.
 */
export function scale(x: Matrix, options: ScaleOptions = {}): Scaled {
  const { center = true, scale: divisor = true } = options;
  const { nrow, ncol } = x;
  const data = Float64Array.from(x.data);

  const givenCenter = requireLength(center, ncol, "center");
  const centers = givenCenter === undefined ? columnMeans(data, nrow, ncol) : givenCenter;
  if (centers !== null) {
    subtract(data, nrow, ncol, centers);
  }

  const givenScale = requireLength(divisor, ncol, "scale");
  const divisors =
    givenScale === undefined ? rootMeanSquares(data, nrow, ncol) : givenScale;
  if (divisors !== null) {
    divide(data, nrow, ncol, divisors);
  }

  return {
    scaled: make(nrow, ncol, data, x.dimnames),
    center: centers,
    scale: divisors,
  };
}

/**
 * The values a `boolean | Vector` argument supplies: the vector itself, or
 * null where `false` asks for nothing. `true` supplies nothing and the
 * caller computes the values, so it reads as `undefined`.
 *
 * @throws RangeError If the vector is not `ncol` long, in R's words.
 */
function requireLength(
  argument: boolean | Vector,
  ncol: number,
  name: string,
): Vector | null | undefined {
  if (argument === true) {
    return undefined;
  }
  if (argument === false) {
    return null;
  }
  if (argument.length !== ncol) {
    throw new RangeError(
      `length of '${name}' must equal the number of columns of 'x'`,
    );
  }
  return argument;
}

/** R's `colMeans()`: a plain running sum over the rows, divided by `n`. */
function columnMeans(data: Float64Array, nrow: number, ncol: number): number[] {
  return Array.from({ length: ncol }, (_, j) => {
    let total = 0;
    for (let i = 0; i < nrow; i++) {
      total += data[j * nrow + i] as number;
    }
    return total / nrow;
  });
}

/**
 * R's divisor for each column: the square root of its sum of squares over
 * `max(1, n − 1)`, taken from the column as it stands.
 */
function rootMeanSquares(data: Float64Array, nrow: number, ncol: number): number[] {
  const divisor = Math.max(1, nrow - 1);
  return Array.from({ length: ncol }, (_, j) => {
    let total = 0;
    for (let i = 0; i < nrow; i++) {
      const value = data[j * nrow + i] as number;
      total += value * value;
    }
    return Math.sqrt(total / divisor);
  });
}

/** R's `sweep(x, 2, center)`. */
function subtract(data: Float64Array, nrow: number, ncol: number, values: Vector): void {
  for (let j = 0; j < ncol; j++) {
    const value = values[j] as number;
    for (let i = 0; i < nrow; i++) {
      data[j * nrow + i] = (data[j * nrow + i] as number) - value;
    }
  }
}

/** R's `sweep(x, 2, scale, "/")`. */
function divide(data: Float64Array, nrow: number, ncol: number, values: Vector): void {
  for (let j = 0; j < ncol; j++) {
    const value = values[j] as number;
    for (let i = 0; i < nrow; i++) {
      data[j * nrow + i] = (data[j * nrow + i] as number) / value;
    }
  }
}
