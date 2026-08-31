/**
 * The QR factorization, R's `qr()` with `LAPACK = FALSE`.
 *
 * R factors a design with LINPACK's `dqrdc2`, a Householder QR with a
 * limited column-pivoting rule: a column whose norm has collapsed against
 * the columns to its left is moved to the right edge and its coefficient is
 * reported as `NA`. That rule is what makes `lm()` and `glm()` report an
 * aliased coefficient instead of dividing by a near-zero pivot. This module
 * reproduces it and exposes R's result — the compact `qr` matrix, `qraux`,
 * `pivot` and `rank` — and R's readers of it: `qr.coef`, `qr.fitted`,
 * `qr.resid`, `qr.qy`, `qr.qty`, `qr.Q` and `qr.R`. Verified against R in
 * `qr.test.ts`; `leastSquares` in `../ols.ts` is a wrapper over it.
 *
 * Provenance: `dqrsl` is LINPACK, by Dongarra, Bunch, Moler and Stewart.
 * `dqrdc2` is not — it is R Core's modification of LINPACK's `dqrdc`, and
 * the limited pivoting rule described above is that modification. See
 * NOTICE.
 *
 * Designs here are small — two columns for logit, four for a moderation
 * surface — so the code follows the LINPACK routines plainly rather than
 * blocking or vectorizing them. Index loops throughout: a factorization
 * addresses single entries by position, and this one follows `dqrdc2` and
 * `dqrsl` step for step so that the fixtures pin bit for bit.
 *
 * Every product goes into its sum through a multiply-add the caller picks
 * with the `fma` option. The default rounds once, as the build the fixtures
 * come from does, and plain `a * b + c` runs much faster for a few units in
 * the last place. See the README's linear algebra section for the measured
 * ratios. The decomposition carries the setting, so each reader below runs
 * the arithmetic the factorization ran.
 *
 * `qr()` resolves the option once and hands the boolean down. Each helper
 * then branches on it around its innermost loop and writes the loop body
 * twice, once for each form. The bodies are written out because one shared
 * call site inside a hot loop goes polymorphic as soon as a program has used
 * both settings, and the engine stops inlining it from then on.
 */

import { fusedMultiplyAdd, resolveFma, type FmaOption } from "../arith";
import { make, type Dimnames, type Matrix } from "./matrix";
import { isMatrix, type MatrixOrVector } from "./ops";
import type { Vector } from "./vector";

/** R's `qr()` result. */
export interface QrDecomposition {
  /**
   * The compact factorization, R's `qr$qr`: `R` on and above the diagonal,
   * the Householder vectors below it, columns in pivot order. Column names
   * follow the pivot, as R's do.
   */
  readonly qr: Matrix;
  /**
   * R's `qr$qraux`: for each reflected column, the leading entry of its
   * Householder reflector; for a column never reflected — the trailing
   * column of a square or wide design, or an aliased column — its remaining
   * norm, which is what R reports there (fixtures 2b, 2c, 2g).
   */
  readonly qraux: Vector;
  /**
   * The column order after pivoting, R's `qr$pivot` **zero-based**:
   * `pivot[k]` is the original index of the column now at position `k`.
   * The aliased columns are at the end.
   */
  readonly pivot: readonly number[];
  /** The number of columns the factorization could identify. */
  readonly rank: number;
  /**
   * The arithmetic the factorization ran, as `qr()` resolved the `fma`
   * option. Every reader in this module follows it, so a decomposition and
   * its coefficients always come from one kind of multiply-add.
   */
  readonly fma: boolean;
}

/** The rank tolerance, and the arithmetic of `FmaOption`. */
export interface QrOptions extends FmaOption {
  /**
   * How far a column's norm may collapse before it is aliased: the column is
   * moved to the end when its remaining norm falls below this fraction of
   * its original norm. The default is R's `qr()` and `lm.fit()` default.
   * `glm.fit()` passes `min(1e-7, epsilon / 1000)`. Zero aliases nothing,
   * as R's `tol = 0` does; a negative or NaN value is refused, where R
   * would pass it through — a deliberate narrowing.
   */
  readonly tolerance?: number;
}

/** The rank tolerance of R's `qr()` and `lm.fit()`. */
export const DEFAULT_QR_TOLERANCE = 1e-7;

/**
 * Factor a matrix, as R's `qr(x, LAPACK = FALSE)` does.
 *
 * @param x The matrix. The function does not modify it. Row names travel
 *   onto the compact form; column names follow the pivot.
 * @param options The rank tolerance and the arithmetic. `{ fma: false }`
 *   takes plain `a * b + c` for throughput, a few units in the last place
 *   from the default. The setting travels on the result.
 * @returns The compact factorization, `qraux`, the pivot, the rank, and the
 *   arithmetic it ran.
 * @throws RangeError If the tolerance is negative or NaN, or if an entry is
 *   not finite — R's "NA/NaN/Inf in foreign function call (arg 1)". NaN is
 *   this library's missing value; a caller drops incomplete rows first, as
 *   `modelMatrix` does.
 * @throws TypeError If `x` is not a matrix, or if `fma` is not a boolean.
 */
export function qr(x: Matrix, options: QrOptions = {}): QrDecomposition {
  const { tolerance = DEFAULT_QR_TOLERANCE, fma: fmaOption } = options;
  if (!(tolerance >= 0)) {
    throw new RangeError(`tolerance must be a non-negative number, got ${tolerance}`);
  }
  // The option is read here, once. The helpers below take the boolean and
  // branch on it around each innermost loop, so no entry pays for the choice.
  const fma = resolveFma(fmaOption);
  if (!isMatrix(x)) {
    throw new TypeError("expected a Matrix");
  }
  if (!x.data.every(Number.isFinite)) {
    throw new RangeError("NA/NaN/Inf in foreign function call (arg 1)");
  }
  const { nrow, ncol } = x;

  // Work on a copy of each column. `dqrdc2` overwrites the matrix in place;
  // the copies keep the caller's matrix untouched.
  const columns = Array.from({ length: ncol }, (_, j) =>
    Array.from(x.data.subarray(j * nrow, (j + 1) * nrow)),
  );
  const { householders, pivot, rank } = decompose(columns, tolerance, nrow, fma);

  const data = new Float64Array(nrow * ncol);
  columns.forEach((column, j) => {
    data.set(column, j * nrow);
  });
  const rows = x.dimnames?.[0] ?? null;
  const names = x.dimnames?.[1] ?? null;
  const dimnames: Dimnames | null =
    rows === null && names === null
      ? null
      : [rows, names === null ? null : pivot.map((from) => names[from] as string)];

  return {
    qr: make(nrow, ncol, data, dimnames),
    qraux: householders,
    pivot,
    rank,
    fma,
  };
}

/**
 * Solve for the coefficients, R's `qr.coef(qr, y)`.
 *
 * @param q The factorization.
 * @param y The response, one value per row — or a matrix with one response
 *   per column, as R also takes.
 * @returns One coefficient per column of the factored matrix, **in the
 *   original column order**, with null for an aliased column (R's `NA`).
 *   For a matrix `y`, a matrix with one column per response, the factored
 *   matrix's column names as row names and `y`'s column names as column
 *   names; an aliased column reads NaN there, since a matrix holds no null.
 * @throws RangeError If `y` has the wrong number of rows.
 */
export function qrCoef(q: QrDecomposition, y: Vector): (number | null)[];
export function qrCoef(q: QrDecomposition, y: Matrix): Matrix;
export function qrCoef(q: QrDecomposition, y: MatrixOrVector): (number | null)[] | Matrix {
  if (isMatrix(y)) {
    requireRows(q, y.nrow);
    const width = q.qr.ncol;
    const data = new Float64Array(width * y.ncol);
    for (let j = 0; j < y.ncol; j++) {
      const solved = coefficientsOf(q, Array.from(y.data.subarray(j * y.nrow, (j + 1) * y.nrow)));
      solved.forEach((value, i) => {
        data[j * width + i] = value ?? Number.NaN;
      });
    }
    return make(width, y.ncol, data, readerDimnames(originalColumnNames(q), y));
  }
  requireRows(q, y.length);
  return coefficientsOf(q, y);
}

/** The coefficients of one response, in the original column order. */
function coefficientsOf(q: QrDecomposition, y: Vector): (number | null)[] {
  const qty = transformed(q, y, true);
  const solved = backSubstitute(q.qr, qty, q.rank, q.fma);
  const coefficients = new Array<number | null>(q.qr.ncol).fill(null);
  q.pivot.slice(0, q.rank).forEach((column, position) => {
    coefficients[column] = solved[position] as number;
  });
  return coefficients;
}

/** The factored matrix's column names in their original order, if any. */
function originalColumnNames(q: QrDecomposition): readonly string[] | null {
  const pivoted = q.qr.dimnames?.[1] ?? null;
  if (pivoted === null) {
    return null;
  }
  const names = new Array<string>(pivoted.length);
  q.pivot.forEach((original, position) => {
    names[original] = pivoted[position] as string;
  });
  return names;
}

/**
 * The fitted values, R's `qr.fitted(qr, y)`: `Q` applied to the first `rank`
 * entries of `Qᵀy`, the rest set to zero. A matrix `y` gives a matrix with
 * its column names.
 *
 * @throws RangeError If `y` has the wrong number of rows.
 */
export function qrFitted(q: QrDecomposition, y: Vector): number[];
export function qrFitted(q: QrDecomposition, y: Matrix): Matrix;
export function qrFitted(q: QrDecomposition, y: MatrixOrVector): number[] | Matrix {
  return perColumn(q, y, (column) =>
    transformed(q, transformed(q, column, true).map((value, index) => (index < q.rank ? value : 0)), false),
  );
}

/**
 * The residuals, R's `qr.resid(qr, y)`: `Q` applied to `Qᵀy` with its first
 * `rank` entries set to zero. A matrix `y` gives a matrix with its column
 * names.
 *
 * @throws RangeError If `y` has the wrong number of rows.
 */
export function qrResid(q: QrDecomposition, y: Vector): number[];
export function qrResid(q: QrDecomposition, y: Matrix): Matrix;
export function qrResid(q: QrDecomposition, y: MatrixOrVector): number[] | Matrix {
  return perColumn(q, y, (column) =>
    transformed(q, transformed(q, column, true).map((value, index) => (index < q.rank ? 0 : value)), false),
  );
}

/**
 * `Qᵀy`, R's `qr.qty(qr, y)`: the reflectors applied first to last. A
 * matrix `y` gives a matrix with its column names.
 *
 * @throws RangeError If `y` has the wrong number of rows.
 */
export function qrQty(q: QrDecomposition, y: Vector): number[];
export function qrQty(q: QrDecomposition, y: Matrix): Matrix;
export function qrQty(q: QrDecomposition, y: MatrixOrVector): number[] | Matrix {
  return perColumn(q, y, (column) => transformed(q, column, true));
}

/**
 * `Qy`, R's `qr.qy(qr, y)`: the reflectors applied last to first. A matrix
 * `y` gives a matrix with its column names.
 *
 * @throws RangeError If `y` has the wrong number of rows.
 */
export function qrQy(q: QrDecomposition, y: Vector): number[];
export function qrQy(q: QrDecomposition, y: Matrix): Matrix;
export function qrQy(q: QrDecomposition, y: MatrixOrVector): number[] | Matrix {
  return perColumn(q, y, (column) => transformed(q, column, false));
}

/** Apply a vector reader to a vector, or to each column of a matrix. */
function perColumn(
  q: QrDecomposition,
  y: MatrixOrVector,
  read: (column: Vector) => number[],
): number[] | Matrix {
  if (isMatrix(y)) {
    requireRows(q, y.nrow);
    const data = new Float64Array(y.nrow * y.ncol);
    for (let j = 0; j < y.ncol; j++) {
      data.set(read(Array.from(y.data.subarray(j * y.nrow, (j + 1) * y.nrow))), j * y.nrow);
    }
    return make(y.nrow, y.ncol, data, readerDimnames(null, y));
  }
  requireRows(q, y.length);
  return read(y);
}

/** Row names given, column names of `y`; null when there are neither. */
function readerDimnames(rows: readonly string[] | null, y: Matrix): Dimnames | null {
  const columns = y.dimnames?.[1] ?? null;
  return rows === null && columns === null ? null : [rows, columns];
}

/**
 * Apply the reflectors to a copy of `y`, first to last for `Qᵀy`, last to
 * first for `Qy`.
 *
 * The setting of the decomposition is read once here and handed to every
 * step, so no entry pays for the choice.
 */
function transformed(q: QrDecomposition, y: Vector, transpose: boolean): number[] {
  const result = [...y];
  const count = reflectorCount(q);
  const { fma } = q;
  if (transpose) {
    for (let step = 0; step < count; step++) {
      applyReflector(q, step, result, fma);
    }
  } else {
    for (let step = count - 1; step >= 0; step--) {
      applyReflector(q, step, result, fma);
    }
  }
  return result;
}

/**
 * The orthogonal factor, R's `qr.Q(qr)`: `n` rows by `min(n, p)` columns —
 * `Q` applied to the leading columns of the identity. It carries no names,
 * as R's does not.
 */
export function qrQ(q: QrDecomposition): Matrix {
  const { nrow, ncol } = q.qr;
  const width = Math.min(nrow, ncol);
  const data = new Float64Array(nrow * width);
  for (let j = 0; j < width; j++) {
    const unit = new Array<number>(nrow).fill(0);
    unit[j] = 1;
    data.set(transformed(q, unit, false), j * nrow);
  }
  return make(nrow, width, data, null);
}

/**
 * The triangular factor, R's `qr.R(qr)`: `min(n, p)` rows by `p` columns,
 * the upper triangle of the compact form, with the leading row names and
 * the column names in pivot order.
 */
export function qrR(q: QrDecomposition): Matrix {
  const { nrow, ncol } = q.qr;
  const height = Math.min(nrow, ncol);
  const data = new Float64Array(height * ncol);
  for (let j = 0; j < ncol; j++) {
    for (let i = 0; i <= Math.min(j, height - 1); i++) {
      data[j * height + i] = q.qr.data[j * nrow + i] as number;
    }
  }
  const rows = q.qr.dimnames?.[0]?.slice(0, height) ?? null;
  const columns = q.qr.dimnames?.[1] ?? null;
  return make(height, ncol, data, rows === null && columns === null ? null : [rows, columns]);
}

/** Refuse a response that does not match the rows. R's own wording. */
function requireRows(q: QrDecomposition, rows: number): void {
  if (rows !== q.qr.nrow) {
    throw new RangeError("'qr' and 'y' must have the same number of rows");
  }
}

/**
 * How many reflectors `dqrsl` applies: `min(k, n - 1)`, because the last
 * row of a square or wide matrix is never reflected.
 */
function reflectorCount(q: QrDecomposition): number {
  return Math.min(q.rank, q.qr.nrow - 1);
}

/**
 * Apply one stored reflector to a vector in place: one step of LINPACK's
 * `dqrsl`.
 *
 * The reflector's leading entry lives in `qraux`, outside the column, so the
 * inner product and the update read it separately from the entries under
 * the diagonal. Both are BLAS calls in LINPACK — `ddot` and `daxpy` — and on
 * the build the fixtures come from each product is contracted into a fused
 * multiply-add, so the default rounds once where the BLAS would. Each of the
 * two loops is written twice, with the branch on `fma` around it, and only
 * the single entry at the diagonal takes the branch inline, once per
 * reflector.
 */
function applyReflector(
  q: QrDecomposition,
  step: number,
  vector: number[],
  fma: boolean,
): void {
  const leading = q.qraux[step] as number;
  if (leading === 0) {
    return;
  }
  const { nrow } = q.qr;
  const column = q.qr.data.subarray(step * nrow, (step + 1) * nrow);

  let inner = leading * (vector[step] as number);
  if (fma) {
    for (let row = step + 1; row < nrow; row++) {
      inner = fusedMultiplyAdd(column[row] as number, vector[row] as number, inner);
    }
  } else {
    for (let row = step + 1; row < nrow; row++) {
      inner = (column[row] as number) * (vector[row] as number) + inner;
    }
  }
  const factor = -inner / leading;
  vector[step] = fma
    ? fusedMultiplyAdd(factor, leading, vector[step] as number)
    : factor * leading + (vector[step] as number);
  if (fma) {
    for (let row = step + 1; row < nrow; row++) {
      vector[row] = fusedMultiplyAdd(factor, column[row] as number, vector[row] as number);
    }
  } else {
    for (let row = step + 1; row < nrow; row++) {
      vector[row] = factor * (column[row] as number) + (vector[row] as number);
    }
  }
}

/**
 * Factor the columns in place: LINPACK's `dqrdc2`, R's modification of
 * `dqrdc` with limited column pivoting.
 *
 * The routine walks the columns left to right, keeping in `qraux` a running
 * norm of each column's remaining part — downdated after every reflection
 * rather than recomputed, and recomputed only when the downdate would lose
 * too much (the `1e-6` rule). A column whose running norm has fallen below
 * `tolerance` times its original norm moves to the right edge and the
 * columns behind it shift left, so the columns that survive keep their
 * original order — which is why R can report the coefficients of a rank-
 * deficient fit in their own slots, with `NA` in the slot of the column it
 * dropped.
 *
 * On return each column holds its part of R above the diagonal and the
 * Householder vector below it, `qraux` holds the leading entry of each
 * reflector — or, for a column that was never reflected, its running norm,
 * which is what R reports there.
 *
 * @returns `qraux`, the column order, and the rank.
 */
function decompose(
  columns: number[][],
  tolerance: number,
  rows: number,
  fma: boolean,
): { householders: number[]; pivot: number[]; rank: number } {
  const width = columns.length;
  const pivot = columns.map((_, column) => column);
  const qraux = columns.map((column) => norm(column, 0, fma));
  // `work(j, 1)`: the norm the running value was last set from.
  const lastNorms = [...qraux];
  // `work(j, 2)`: the original norm, with 1 substituted for zero so that an
  // all-zero column compares as negligible rather than dividing by zero.
  const originalNorms = qraux.map((value) => value || 1);
  // R's `k`, one past the count of columns still in play.
  let k = width + 1;

  for (let step = 0; step < Math.min(rows, width); step++) {
    // Cycle the columns from `step` rightward until one with a non-negligible
    // norm is found. `step + 1` is R's one-based `l`.
    while (
      step + 1 < k &&
      (qraux[step] as number) < (originalNorms[step] as number) * tolerance
    ) {
      moveToEnd(columns, step);
      moveToEnd(pivot, step);
      moveToEnd(qraux, step);
      moveToEnd(lastNorms, step);
      moveToEnd(originalNorms, step);
      k -= 1;
    }

    // The last row leaves nothing to reflect. R skips it and keeps the entry
    // as it stands, which is how a design with more columns than rows still
    // resolves the coefficients it can.
    if (step === rows - 1) {
      continue;
    }
    reflect(columns, qraux, lastNorms, step, rows, fma);
  }

  return { householders: qraux, pivot, rank: Math.min(k - 1, rows) };
}

/**
 * Build the Householder reflector of one column, apply it to the columns to
 * its right, and downdate their running norms. On return `qraux[step]` holds
 * the reflector's leading entry.
 */
function reflect(
  columns: number[][],
  qraux: number[],
  lastNorms: number[],
  step: number,
  rows: number,
  fma: boolean,
): void {
  const column = columns[step] as number[];
  const length = norm(column, step, fma);
  if (length === 0) {
    return;
  }
  // Reflect away from the leading entry, so that nothing cancels.
  const pivotNorm = (column[step] as number) < 0 ? -length : length;

  // `dscal(n, 1/nrmxl, x)`: LINPACK multiplies by the reciprocal rather than
  // dividing, and the two round differently. Dividing lands one ulp away from
  // R in the Householder vector of the very first fixture.
  const reciprocal = 1 / pivotNorm;
  for (let row = step; row < rows; row++) {
    column[row] = (column[row] as number) * reciprocal;
  }
  const leading = 1 + (column[step] as number);
  column[step] = leading;

  for (let index = step + 1; index < columns.length; index++) {
    const other = columns[index] as number[];
    // `ddot` and `daxpy`. The default rounds each product once with its
    // addition, as the build the fixtures come from does.
    let inner = 0;
    if (fma) {
      for (let row = step; row < rows; row++) {
        inner = fusedMultiplyAdd(column[row] as number, other[row] as number, inner);
      }
    } else {
      for (let row = step; row < rows; row++) {
        inner = (column[row] as number) * (other[row] as number) + inner;
      }
    }
    const factor = -inner / leading;
    if (fma) {
      for (let row = step; row < rows; row++) {
        other[row] = fusedMultiplyAdd(factor, column[row] as number, other[row] as number);
      }
    } else {
      for (let row = step; row < rows; row++) {
        other[row] = factor * (column[row] as number) + (other[row] as number);
      }
    }

    // Downdate the running norm of the column just updated, or recompute it
    // when the downdate would cancel too much.
    const running = qraux[index] as number;
    if (running !== 0) {
      const ratio = Math.abs(other[step] as number) / running;
      const remaining = Math.max(1 - ratio * ratio, 0);
      if (Math.abs(remaining) < 1e-6) {
        qraux[index] = norm(other, step + 1, fma);
        lastNorms[index] = qraux[index] as number;
      } else {
        qraux[index] = running * Math.sqrt(remaining);
      }
    }
  }

  qraux[step] = leading;
  column[step] = -pivotNorm;
}

/**
 * Solve the leading `rank` columns of the triangular system, as `dqrsl`
 * does: column by column from the last, each solved coefficient subtracted
 * from the entries above it with `daxpy`.
 */
function backSubstitute(
  compact: Matrix,
  response: Vector,
  rank: number,
  fma: boolean,
): number[] {
  const { nrow } = compact;
  const entry = (i: number, j: number): number =>
    compact.data[j * nrow + i] as number;
  const solved = response.slice(0, rank);

  for (let column = rank - 1; column >= 0; column--) {
    const value = (solved[column] as number) / entry(column, column);
    solved[column] = value;
    if (fma) {
      for (let row = 0; row < column; row++) {
        solved[row] = fusedMultiplyAdd(-value, entry(row, column), solved[row] as number);
      }
    } else {
      for (let row = 0; row < column; row++) {
        solved[row] = -value * entry(row, column) + (solved[row] as number);
      }
    }
  }

  return solved;
}

/** Move one entry of an array to its end, sliding the rest left. */
function moveToEnd<T>(track: T[], from: number): void {
  const [moved] = track.splice(from, 1) as [T];
  track.push(moved);
}

/**
 * The Euclidean length of a column from `from` down: the BLAS `dnrm2`.
 *
 * For values in the ordinary range `dnrm2` is a sum of squares under a
 * square root; its scaling engages only near overflow or underflow, which
 * no fixture and no teaching dataset reaches. Written as a fold —
 * `Math.hypot(...column)` overflows the call stack past about a million
 * entries, and its rounding is not specified — with each square rounded into
 * the sum once for the default and twice for the plain form. Several places
 * call this, so it takes the setting and writes its loop twice.
 */
function norm(column: Vector, from: number, fma: boolean): number {
  let squares = 0;
  if (fma) {
    for (let row = from; row < column.length; row++) {
      const value = column[row] as number;
      squares = fusedMultiplyAdd(value, value, squares);
    }
  } else {
    for (let row = from; row < column.length; row++) {
      const value = column[row] as number;
      squares = value * value + squares;
    }
  }
  return Math.sqrt(squares);
}
