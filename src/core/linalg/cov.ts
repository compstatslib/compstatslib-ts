/**
 * R's `var()`, `cov()` and `cor()`.
 *
 * R computes a covariance in two passes: the mean of each column, refined
 * once by adding the mean of the residuals (its `cov.c` does this to shave
 * the rounding off a long sum), then the sum of products of deviations over
 * `n − 1`. A correlation is the covariance matrix scaled by the square roots
 * of its diagonal, clamped to `[-1, 1]`, with an exact 1 on the diagonal.
 * The port follows those steps. R accumulates in `long double` where the
 * platform has one; the conformance fixtures come from arm64, where it does
 * not, and the values are verified at a relative tolerance (plan Q1).
 *
 * A missing value gives NaN, as R's default `use = "everything"` gives NA.
 * A constant column gives NaN for its correlations, where R warns "the
 * standard deviation is zero" and gives NA.
 */

import { sum } from "../arith";
import { isMatrix, type MatrixOrVector } from "./ops";
import { make, type Dimnames, type Matrix } from "./matrix";

/**
 * R's `mean()` as `cov()` computes it: the plain mean, refined by the mean
 * of the residuals. A non-finite first pass is returned as it is.
 */
function refinedMean(values: readonly number[]): number {
  const n = values.length;
  const first = sum(values) / n;
  if (!Number.isFinite(first)) {
    return first;
  }
  return first + sum(values.map((value) => value - first)) / n;
}

/** The sum of products of deviations over `n − 1`; NaN below two values. */
function covariance(
  a: readonly number[],
  meanA: number,
  b: readonly number[],
  meanB: number,
): number {
  const n = a.length;
  if (n < 2) {
    return Number.NaN;
  }
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += ((a[i] as number) - meanA) * ((b[i] as number) - meanB);
  }
  return total / (n - 1);
}

/** Refuse two vectors of different lengths, in R's words. */
function requireSameLength(a: readonly number[], b: readonly number[]): void {
  if (a.length !== b.length) {
    throw new RangeError("incompatible dimensions");
  }
}

/**
 * R's `var(x)` of a vector: the sample variance with the `n − 1` divisor.
 *
 * @returns The variance, or NaN below two values or with a missing value.
 */
export function variance(a: readonly number[]): number {
  const center = refinedMean(a);
  return covariance(a, center, a, center);
}

/**
 * R's `cov()`: the covariance of two vectors, or the covariance matrix of
 * the columns of a matrix.
 *
 * @param x A vector, or a matrix whose columns are the variables.
 * @param y The second vector when `x` is a vector.
 * @returns The covariance, or the symmetric covariance matrix with the
 *   column names of `x` on both sides.
 * @throws RangeError If two vectors differ in length.
 */
export function cov(x: readonly number[], y: readonly number[]): number;
export function cov(x: Matrix): Matrix;
export function cov(x: MatrixOrVector, y?: readonly number[]): number | Matrix {
  if (isMatrix(x)) {
    return pairwise(x, false);
  }
  if (y === undefined) {
    throw new RangeError("cov() of a vector needs a second vector");
  }
  requireSameLength(x, y);
  return covariance(x, refinedMean(x), y, refinedMean(y));
}

/**
 * R's `cor()`: the Pearson correlation of two vectors, or the correlation
 * matrix of the columns of a matrix.
 *
 * @param x A vector, or a matrix whose columns are the variables.
 * @param y The second vector when `x` is a vector.
 * @returns The correlation, clamped to `[-1, 1]`, or the symmetric
 *   correlation matrix with an exact 1 on its diagonal. NaN where a
 *   variable has no spread.
 * @throws RangeError If two vectors differ in length.
 */
export function cor(x: readonly number[], y: readonly number[]): number;
export function cor(x: Matrix): Matrix;
export function cor(x: MatrixOrVector, y?: readonly number[]): number | Matrix {
  if (isMatrix(x)) {
    return pairwise(x, true);
  }
  if (y === undefined) {
    throw new RangeError("cor() of a vector needs a second vector");
  }
  requireSameLength(x, y);
  const meanX = refinedMean(x);
  const meanY = refinedMean(y);
  const spread = Math.sqrt(covariance(x, meanX, x, meanX) * covariance(y, meanY, y, meanY));
  return spread === 0 ? Number.NaN : clamp(covariance(x, meanX, y, meanY) / spread);
}

/** The covariance or correlation matrix of the columns, as R builds it. */
function pairwise(m: Matrix, correlation: boolean): Matrix {
  const { nrow, ncol } = m;
  const columns = Array.from({ length: ncol }, (_, j) =>
    Array.from(m.data.subarray(j * nrow, (j + 1) * nrow)),
  );
  const means = columns.map(refinedMean);
  const data = new Float64Array(ncol * ncol);
  for (let i = 0; i < ncol; i++) {
    for (let j = 0; j <= i; j++) {
      const value = covariance(
        columns[i] as number[],
        means[i] as number,
        columns[j] as number[],
        means[j] as number,
      );
      data[j * ncol + i] = value;
      data[i * ncol + j] = value;
    }
  }
  if (correlation) {
    const spreads = Array.from({ length: ncol }, (_, i) => Math.sqrt(data[i * ncol + i] as number));
    for (let i = 0; i < ncol; i++) {
      for (let j = 0; j <= i; j++) {
        const divisor = (spreads[i] as number) * (spreads[j] as number);
        const value =
          i === j ? 1 : divisor === 0 ? Number.NaN : clamp((data[j * ncol + i] as number) / divisor);
        data[j * ncol + i] = value;
        data[i * ncol + j] = value;
      }
    }
  }
  const names = m.dimnames?.[1] ?? null;
  const dimnames: Dimnames | null = names === null ? null : [names, names];
  return make(ncol, ncol, data, dimnames);
}

/** R's clamp of a correlation to `[-1, 1]`. */
function clamp(value: number): number {
  return value > 1 ? 1 : value < -1 ? -1 : value;
}
