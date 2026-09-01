/**
 * The determinant and the inverse of a 2x2 matrix.
 *
 * This is the arithmetic half of `plot_matrix_inverse()` in the R package,
 * which builds `A <- matrix(c(x1, y1, x2, y2), nrow = 2)` and calls
 * `solve(A)` before it draws anything. Verified against R in
 * `matrix.test.ts`.
 *
 * Four things are worth knowing before reading the code.
 *
 * **The matrix is two columns.** R fills a matrix column by column, so
 * `(x1, y1)` is column 1 and `(x2, y2)` is column 2. The R plot draws each
 * column as an arrow from the origin, and the parallelogram they span has the
 * determinant as its area. The field names are R's argument names, so nothing
 * has to be transposed on the way in or out.
 *
 * **R's answers come from a factorization, not from the closed form.** Both
 * `det()` and `solve()` factor the matrix first (LAPACK `dgetrf`, partial
 * pivoting), and `det()` then exponentiates a sum of logarithms. The closed
 * forms `x1*y2 - x2*y1` and `[[y2, -x2], [-y1, x1]]/det` give different last
 * bits: for the default matrix of the interactive gadget the closed form gives
 * exactly -3 where R gives -2.9999999999999996. This module follows the
 * factorization, so its numbers are R's.
 *
 * **Two operations there are not the obvious ones.** The factorization scales
 * the column below the pivot by `1 / pivot` instead of dividing by the pivot,
 * and it rounds the rank-one update once (see `fusedMultiplyAdd`). Both
 * change what a near-singular matrix reports: dividing turns R's
 * "computationally singular" into "exactly singular" for four equal entries at
 * `1e-5`, and rounding twice moves a cancelled determinant by a factor of two.
 *
 * **A singular matrix is data, not an error.** R stops with an error, which
 * ends the R function before it draws. A component that redraws while a slider
 * moves cannot throw, so this module reports the singularity in its result and
 * lets the caller decide. The two kinds R distinguishes are kept apart,
 * because they describe different things: an exactly zero pivot, and a matrix
 * that is invertible on paper but too ill-conditioned to invert in doubles.
 */

import { fusedMultiplyAdd, sum, withoutNegativeZero } from "./arith.js";

/**
 * The smallest normal double, LAPACK's `dlamch("S")`.
 *
 * Below it, `dgetf2` divides the column by the pivot instead of multiplying by
 * the reciprocal, because the reciprocal would overflow.
 */
const SMALLEST_NORMAL = 2.2250738585072014e-308;

/**
 * A 2x2 matrix, held as R's `plot_matrix_inverse` arguments.
 *
 * `(x1, y1)` is the first column and `(x2, y2)` is the second, which is how
 * `matrix(c(x1, y1, x2, y2), nrow = 2)` fills it. Written as a table of rows,
 * the matrix is `[[x1, x2], [y1, y2]]`.
 */
export interface Matrix2 {
  /** Row 1 of column 1. R's `A[1,1]`. */
  readonly x1: number;
  /** Row 2 of column 1. R's `A[2,1]`. */
  readonly y1: number;
  /** Row 1 of column 2. R's `A[1,2]`. */
  readonly x2: number;
  /** Row 2 of column 2. R's `A[2,2]`. */
  readonly y2: number;
}

/**
 * Why a matrix has no inverse, in the two kinds R reports.
 *
 * `"exact"` is R's "Lapack routine dgesv: system is exactly singular:
 * U[i,i] = 0": the factorization found a pivot that is the literal value zero.
 * `"computational"` is R's "system is computationally singular: reciprocal
 * condition number = ...": the factorization completed, but the condition
 * number is below R's tolerance of one machine epsilon.
 */
export type Singularity = "exact" | "computational";

/** What `invertMatrix` reports about one matrix. */
export interface MatrixInversion {
  /**
   * The determinant, as R's `det()` computes it. It is exactly zero for an
   * exactly singular matrix, and it is not a test for singularity: a matrix
   * with a determinant of `2e-16` can still be too ill-conditioned to invert,
   * and one with a determinant of `0.01` inverts without trouble.
   */
  readonly determinant: number;
  /**
   * The inverse, or null if R's `solve()` would have stopped with an error.
   * The port could report the huge and meaningless numbers that a
   * computationally singular matrix produces, and does not: a null says the
   * same thing as R's error, in a form a caller can branch on.
   */
  readonly inverse: Matrix2 | null;
  /** Which kind of singularity, or null if the matrix inverts. */
  readonly singularity: Singularity | null;
  /**
   * The reciprocal condition number in the one-norm:
   * `1 / (norm(A) * norm(inverse))`. R's bar for a usable matrix is
   * `rcond >= Number.EPSILON`, and this port keeps that bar.
   *
   * R's `solve()` reads an estimate of the same number from LAPACK's
   * `dgecon` rather than computing it. Near the bar the two agree to the last
   * bit — every fixture at the edge of singularity does — while for a well
   * conditioned matrix R's estimate can be up to about twice this value,
   * because the estimator only bounds the norm of the inverse from below. The
   * two never disagreed about a matrix over a sweep of 20000 slider settings.
   *
   * It is 0 for an exactly singular matrix. R computes no condition number
   * there — the factorization has already failed — and zero is the limit.
   */
  readonly rcond: number;
  /**
   * Which pivot was exactly zero: the `i` of R's message `U[i,i] = 0`. It is
   * 1 only when the whole first column is zero, and null unless the
   * singularity is exact.
   */
  readonly zeroPivot: 1 | 2 | null;
}

/**
 * Return the determinant, as R's `det()` reports it.
 *
 * R factors the matrix and then computes `sign * exp(sum(log(abs(pivot))))`,
 * so an integer determinant does not always come back as an integer. A
 * singular matrix gives a positive zero, whatever its rows: R leaves the sign
 * of the interchange unread on that path.
 *
 * @param matrix The matrix. The function does not modify it.
 * @returns The determinant. It is NaN if an entry is NaN, and it overflows to
 *   an infinity for entries large enough, both as R's does.
 */
export function determinant(matrix: Matrix2): number {
  return determinantOf(factorize(matrix));
}

/**
 * Invert the matrix, and report what R's `solve()` would have done with it.
 *
 * The function does not throw. An entry of NaN spreads into every number of
 * the report, which is what R's `solve()` does with it too. An infinite entry
 * gives an infinite norm and so a condition number of zero, and the report
 * says the matrix is computationally singular. R returns an inverse of zeros
 * there instead, but only because its condition test cannot judge a matrix of
 * infinite norm: R's own `rcond()` stops with an error on the same matrix.
 *
 * @param matrix The matrix. The function does not modify it.
 * @returns The inverse and the determinant, or the kind of singularity that
 *   stops the matrix from having an inverse.
 */
export function invertMatrix(matrix: Matrix2): MatrixInversion {
  const factorization = factorize(matrix);
  const determinant = determinantOf(factorization);
  const zeroPivot = zeroPivotOf(factorization);

  if (zeroPivot !== null) {
    return {
      determinant,
      inverse: null,
      singularity: "exact",
      rcond: 0,
      zeroPivot,
    };
  }

  const inverse = solveForIdentity(factorization);
  // R's `dgecon` estimates the norm of the inverse from the factorization.
  // This module has the inverse itself, so it takes the norm directly. See
  // the note on `rcond` for what that changes and what it does not.
  const rcond = 1 / (oneNorm(matrix) * oneNorm(inverse));

  // R's `solve()` takes its tolerance from `.Machine$double.eps`. A NaN fails
  // this test, as it fails R's, and so passes through as an inverse of NaNs.
  if (rcond < Number.EPSILON) {
    return {
      determinant,
      inverse: null,
      singularity: "computational",
      rcond,
      zeroPivot: null,
    };
  }

  return {
    determinant,
    inverse,
    singularity: null,
    rcond,
    zeroPivot: null,
  };
}

/**
 * The matrix, factored into a lower and an upper triangle with the larger
 * first-column entry as the leading pivot. LAPACK's `dgetf2`.
 */
interface Factorization {
  /** Whether the rows were interchanged to bring up the larger pivot. */
  readonly interchanged: boolean;
  /** The one entry of the lower triangle, below its unit diagonal. */
  readonly multiplier: number;
  /** The diagonal of the upper triangle, in order. */
  readonly pivots: readonly [number, number];
  /** The one entry of the upper triangle above its diagonal. */
  readonly upperRight: number;
}

/** Factor the matrix, as LAPACK's `dgetf2` does. */
function factorize(matrix: Matrix2): Factorization {
  // Partial pivoting: the larger of the two first-column entries leads.
  const interchanged = Math.abs(matrix.y1) > Math.abs(matrix.x1);
  const leading = interchanged ? matrix.y1 : matrix.x1;
  const upperRight = interchanged ? matrix.y2 : matrix.x2;
  const below = interchanged ? matrix.x1 : matrix.y1;
  const belowRight = interchanged ? matrix.x2 : matrix.y2;

  // `dgetf2` scales by the reciprocal of the pivot, and divides only where
  // the reciprocal would overflow. The difference reaches the result: see the
  // note on the module.
  const multiplier =
    Math.abs(leading) >= SMALLEST_NORMAL ? below * (1 / leading) : below / leading;
  const trailing = fusedMultiplyAdd(-multiplier, upperRight, belowRight);

  return {
    interchanged,
    multiplier,
    pivots: [leading, trailing],
    upperRight,
  };
}

/** Return the determinant of a factored matrix, as R's `det()` does. */
function determinantOf(factorization: Factorization): number {
  const { interchanged, pivots } = factorization;

  // R's `det_ge_real` reads neither the interchanges nor the diagonal when
  // the factorization reports a zero pivot: it sets the modulus to negative
  // infinity and keeps the sign at 1, so the determinant is a positive zero.
  if (zeroPivotOf(factorization) !== null) {
    return 0;
  }

  const modulus = sum(pivots.map((pivot) => Math.log(Math.abs(pivot))));
  const sign = pivots.reduce(
    (carried, pivot) => (pivot < 0 ? -carried : carried),
    interchanged ? -1 : 1,
  );

  return sign * Math.exp(modulus);
}

/** Return which pivot is exactly zero, in the order the factorization finds. */
function zeroPivotOf(factorization: Factorization): 1 | 2 | null {
  const [leading, trailing] = factorization.pivots;
  if (leading === 0) {
    return 1;
  }
  return trailing === 0 ? 2 : null;
}

/**
 * Solve the factored matrix against the identity, as `dgetrs` does.
 *
 * The right-hand side is the identity with its rows interchanged the same way
 * the factorization interchanged them, and each of its columns then goes
 * forward through the lower triangle and back through the upper one.
 */
function solveForIdentity(factorization: Factorization): Matrix2 {
  const { interchanged } = factorization;
  const [firstTop, firstBottom] = interchanged ? [0, 1] : [1, 0];
  const [secondTop, secondBottom] = interchanged ? [1, 0] : [0, 1];

  const [x1, y1] = solveColumn(factorization, firstTop, firstBottom);
  const [x2, y2] = solveColumn(factorization, secondTop, secondBottom);

  // The substitution can leave a zero entry with a sign; R's never carry one.
  return {
    x1: withoutNegativeZero(x1),
    y1: withoutNegativeZero(y1),
    x2: withoutNegativeZero(x2),
    y2: withoutNegativeZero(y2),
  };
}

/** Solve one column of the right-hand side. */
function solveColumn(
  factorization: Factorization,
  top: number,
  bottom: number,
): [number, number] {
  const { multiplier, pivots, upperRight } = factorization;

  const lower = fusedMultiplyAdd(-multiplier, top, bottom) / pivots[1];
  const upper = fusedMultiplyAdd(-upperRight, lower, top) / pivots[0];

  return [upper, lower];
}

/** Return the one-norm: the larger of the two absolute column sums. */
function oneNorm(matrix: Matrix2): number {
  return Math.max(
    Math.abs(matrix.x1) + Math.abs(matrix.y1),
    Math.abs(matrix.x2) + Math.abs(matrix.y2),
  );
}
