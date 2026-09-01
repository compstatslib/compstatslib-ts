/**
 * R's `var()`, `cov()` and `cor()`.
 *
 * R computes a covariance in two passes: the mean of each column, refined
 * once by adding the mean of the residuals (its `cov.c` does this to shave
 * the rounding off a long sum), then the sum of products of deviations over
 * `n − 1`. A correlation is that covariance over the spread of each column,
 * clamped to `[-1, 1]`. The port follows those steps. R accumulates in
 * `long double` where the platform has one; the conformance fixtures come
 * from arm64, where it does not, and the values are verified at a relative
 * tolerance (plan Q1).
 *
 * Each column is centered once and the entries are dot products of the
 * centered columns. That is the order of R's `cov.c` — the refined mean
 * first, then the sum of products over `n − 1` — so the fixtures pin the
 * same doubles as the earlier per-pair form did, and a `p` column matrix
 * takes `p` means rather than `p²`. Index loops throughout: a covariance
 * matrix addresses entries by position, and the loops are the ones a caller
 * runs inside a bootstrap. (CLAUDE.md allows an index loop with a stated
 * reason; that is the reason.)
 *
 * Where R takes the spread differs between its two paths, and the port
 * follows each one:
 *
 * - `cor(x)` of one matrix reads the spread off the diagonal of the
 *   covariance matrix it has just built, so the spread carries the rounding
 *   of that plain sum.
 * - `cor(x, y)` of two arguments walks each column again for its sum of
 *   squares. The build the fixtures come from contracts that loop's multiply
 *   and add into one instruction, so the port sums it with
 *   `fusedMultiplyAdd`, as `matmul`, `qr` and `lu` already do, and it takes
 *   the same `fma` option: `{ fma: false }` sums the spread plainly, which
 *   is about 5× faster on a 24-column block and a unit in the last place
 *   away. The loop is written once per setting, as in `ops.ts`.
 *
 * The two spreads differ in the last bit, and so do R's own two results.
 * Fixture 6a pins `cor(x, y)` a unit in the last place away from fixture
 * 5a's `cor(x)` for the same pair of columns.
 *
 * A missing value gives NaN, as R's default `use = "everything"` gives NA.
 * A constant column gives NaN for its correlations, where R warns "the
 * standard deviation is zero" and gives NA.
 */

import { fusedMultiplyAdd, resolveFma, type FmaOption } from "../arith.js";
import { isMatrix, type MatrixOrVector } from "./ops.js";
import { make, type Dimnames, type Matrix } from "./matrix.js";
import type { Vector } from "./vector.js";

/** A column, as an R vector or as a slice of a matrix. */
type Column = ArrayLike<number>;

/**
 * R's `mean()` as `cov()` computes it: the plain mean, refined by the mean
 * of the residuals. A non-finite first pass is returned as it is.
 */
function refinedMean(values: Column): number {
  const n = values.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += values[i] as number;
  }
  const first = total / n;
  if (!Number.isFinite(first)) {
    return first;
  }
  let residual = 0;
  for (let i = 0; i < n; i++) {
    residual += (values[i] as number) - first;
  }
  return first + residual / n;
}

/** The column less its refined mean. */
function center(values: Column): Float64Array {
  const n = values.length;
  const mean = refinedMean(values);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (values[i] as number) - mean;
  }
  return out;
}

/** Every column of a matrix, each centered on its own refined mean. */
function centeredColumns(m: Matrix): Float64Array[] {
  const { nrow, ncol } = m;
  return Array.from({ length: ncol }, (_, j) =>
    center(m.data.subarray(j * nrow, (j + 1) * nrow)),
  );
}

/** The sum of products of two centered columns. R's plain running sum. */
function dot(a: Float64Array, b: Float64Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    total += (a[i] as number) * (b[i] as number);
  }
  return total;
}

/**
 * The spread of a centered column: the square root of its sum of squares
 * over `n − 1`, summed the way R's own `cor(x, y)` sums it — one rounding
 * per term. See the module comment.
 */
function spreadOf(a: Float64Array, n: number, fma: boolean): number {
  let total = 0;
  if (fma) {
    for (let i = 0; i < a.length; i++) {
      total = fusedMultiplyAdd(a[i] as number, a[i] as number, total);
    }
  } else {
    for (let i = 0; i < a.length; i++) {
      total = (a[i] as number) * (a[i] as number) + total;
    }
  }
  return Math.sqrt(total / (n - 1));
}

/** The covariance of two centered columns; NaN below two values. */
function covarianceOf(a: Float64Array, b: Float64Array, n: number): number {
  return n < 2 ? Number.NaN : dot(a, b) / (n - 1);
}

/** Refuse two vectors of different lengths, in R's words. */
function requireSameLength(a: Vector, b: Vector): void {
  if (a.length !== b.length) {
    throw new RangeError("incompatible dimensions");
  }
}

/**
 * R's `var(x)` of a vector: the sample variance with the `n − 1` divisor.
 *
 * @returns The variance, or NaN below two values or with a missing value.
 */
export function variance(a: Vector): number {
  const centered = center(a);
  return covarianceOf(centered, centered, a.length);
}

/**
 * R's `cov()`: the covariance of two vectors, the covariance matrix of the
 * columns of a matrix, or the covariances between the columns of two
 * matrices.
 *
 * @param x A vector, or a matrix whose columns are the variables.
 * @param y The second vector or matrix. A vector beside a matrix is R's
 *   one-column matrix, with no name.
 * @returns The covariance of two vectors as a number; the symmetric
 *   covariance matrix of one matrix, with its column names on both sides;
 *   or the `ncol(x)` by `ncol(y)` matrix of covariances, with the column
 *   names of `x` as its row names and those of `y` as its column names.
 * @throws RangeError If two vectors differ in length, if the two arguments
 *   have different numbers of rows, or if `x` is a vector and `y` is absent.
 */
export function cov(x: Vector, y: Vector): number;
export function cov(x: Matrix): Matrix;
export function cov(x: Matrix, y: Matrix): Matrix;
export function cov(x: Vector, y: Matrix): Matrix;
export function cov(x: Matrix, y: Vector): Matrix;
export function cov(x: MatrixOrVector, y?: MatrixOrVector): number | Matrix {
  if (y === undefined) {
    if (!isMatrix(x)) {
      throw new RangeError("cov() of a vector needs a second vector");
    }
    return pairwise(x, false);
  }
  if (!isMatrix(x) && !isMatrix(y)) {
    requireSameLength(x, y);
    return covarianceOf(center(x), center(y), x.length);
  }
  return crosswise(asMatrix(x), asMatrix(y), false, true);
}

/**
 * R's `cor()`: the Pearson correlation of two vectors, of the columns of a
 * matrix, or between the columns of two matrices.
 *
 * @param x A vector, or a matrix whose columns are the variables.
 * @param y The second vector or matrix. A vector beside a matrix is R's
 *   one-column matrix, with no name.
 * @param options `{ fma: false }` sums each spread plainly. See the module
 *   comment. The one-matrix form takes no option: its spread is read off
 *   the covariance diagonal, which R sums plainly.
 * @returns The correlation, clamped to `[-1, 1]`. One matrix gives the
 *   symmetric correlation matrix with an exact 1 on its diagonal; two give
 *   the `ncol(x)` by `ncol(y)` matrix, with the column names of `x` as its
 *   row names and those of `y` as its column names. NaN where a variable
 *   has no spread.
 * @throws RangeError If two vectors differ in length, if the two arguments
 *   have different numbers of rows, or if `x` is a vector and `y` is absent.
 * @throws TypeError If `fma` is neither true nor false.
 */
export function cor(x: Vector, y: Vector, options?: FmaOption): number;
export function cor(x: Matrix): Matrix;
export function cor(x: Matrix, y: Matrix, options?: FmaOption): Matrix;
export function cor(x: Vector, y: Matrix, options?: FmaOption): Matrix;
export function cor(x: Matrix, y: Vector, options?: FmaOption): Matrix;
export function cor(
  x: MatrixOrVector,
  y?: MatrixOrVector,
  options: FmaOption = {},
): number | Matrix {
  if (y === undefined) {
    if (!isMatrix(x)) {
      throw new RangeError("cor() of a vector needs a second vector");
    }
    return pairwise(x, true);
  }
  const fma = resolveFma(options.fma);
  if (!isMatrix(x) && !isMatrix(y)) {
    requireSameLength(x, y);
    const n = x.length;
    const a = center(x);
    const b = center(y);
    return scaled(covarianceOf(a, b, n), spreadOf(a, n, fma), spreadOf(b, n, fma));
  }
  return crosswise(asMatrix(x), asMatrix(y), true, fma);
}

/** A vector as R's one-column matrix, with no dimnames. */
function asMatrix(x: MatrixOrVector): Matrix {
  return isMatrix(x)
    ? x
    : make(x.length, 1, Float64Array.from(x), null);
}

/** The covariance or correlation matrix of the columns, as R builds it. */
function pairwise(m: Matrix, correlation: boolean): Matrix {
  const { nrow, ncol } = m;
  const columns = centeredColumns(m);
  const data = new Float64Array(ncol * ncol);
  for (let i = 0; i < ncol; i++) {
    for (let j = 0; j <= i; j++) {
      const value = covarianceOf(
        columns[i] as Float64Array,
        columns[j] as Float64Array,
        nrow,
      );
      data[j * ncol + i] = value;
      data[i * ncol + j] = value;
    }
  }
  if (correlation) {
    // R's symmetric path takes each spread off the diagonal it just wrote.
    const spreads = Array.from({ length: ncol }, (_, i) => Math.sqrt(data[i * ncol + i] as number));
    for (let i = 0; i < ncol; i++) {
      for (let j = 0; j <= i; j++) {
        const value =
          i === j
            ? 1
            : scaled(data[j * ncol + i] as number, spreads[i] as number, spreads[j] as number);
        data[j * ncol + i] = value;
        data[i * ncol + j] = value;
      }
    }
  }
  const names = m.dimnames?.[1] ?? null;
  const dimnames: Dimnames | null = names === null ? null : [names, names];
  return make(ncol, ncol, data, dimnames);
}

/** The covariances or correlations between the columns of two matrices. */
function crosswise(x: Matrix, y: Matrix, correlation: boolean, fma: boolean): Matrix {
  if (x.nrow !== y.nrow) {
    throw new RangeError("incompatible dimensions");
  }
  const n = x.nrow;
  const rows = centeredColumns(x);
  const columns = centeredColumns(y);
  const data = new Float64Array(x.ncol * y.ncol);
  const rowSpreads = correlation ? rows.map((column) => spreadOf(column, n, fma)) : [];
  const columnSpreads = correlation ? columns.map((column) => spreadOf(column, n, fma)) : [];
  for (let j = 0; j < y.ncol; j++) {
    for (let i = 0; i < x.ncol; i++) {
      const value = covarianceOf(rows[i] as Float64Array, columns[j] as Float64Array, n);
      data[j * x.ncol + i] = correlation
        ? scaled(value, rowSpreads[i] as number, columnSpreads[j] as number)
        : value;
    }
  }
  const rowNames = x.dimnames?.[1] ?? null;
  const columnNames = y.dimnames?.[1] ?? null;
  const dimnames: Dimnames | null =
    rowNames === null && columnNames === null ? null : [rowNames, columnNames];
  return make(x.ncol, y.ncol, data, dimnames);
}

/** A covariance over two spreads, clamped to `[-1, 1]` as R clamps it. */
function scaled(covariance: number, spreadX: number, spreadY: number): number {
  const divisor = spreadX * spreadY;
  if (divisor === 0) {
    return Number.NaN;
  }
  const value = covariance / divisor;
  return value > 1 ? 1 : value < -1 ? -1 : value;
}
