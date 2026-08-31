/**
 * The Cholesky factorization of a symmetric positive definite matrix, R's
 * `chol()`, and the inverse read off that factor, R's `chol2inv()`.
 *
 * R's `chol(a)` is LAPACK `dpotrf` with `uplo = "U"`. It returns the upper
 * triangular `U` for which `a` equals `t(U) %*% U`. Below the block size of
 * 64, and every matrix here is far below it, `dpotrf` hands the whole
 * problem to the recursive `dpotrf2`: split the order in half, factor the
 * leading block, solve the off-diagonal block against that factor
 * (`dtrsm`), subtract its cross product from the trailing block (`dsyrk`),
 * and factor what remains. An order of one is a square root. This module
 * follows that recursion and the loop order of the reference BLAS the
 * fixtures come from, so the factor pins bit for bit. Verified in
 * `chol.test.ts`.
 *
 * R's `chol2inv(x)` is LAPACK `dpotri`: invert the triangle (`dtrtri`),
 * then multiply it by its own transpose (`dlauum`). R then copies the upper
 * triangle of the result down to the lower one, so the inverse comes back
 * symmetric. The two extra passes accumulate a little rounding, so the
 * inverse is compared with R at a relative bar rather than pinned.
 *
 * Both routines read **only the upper triangle** of their argument, as R
 * does. A value below the diagonal never reaches the arithmetic.
 * `chol()` carries the dimnames of its argument, and `chol2inv()` returns
 * none, which is what R does with each.
 *
 * One stated narrowing: R's `chol2inv()` takes a `size` argument that
 * defaults to the column count, so R reads the leading square block of a
 * tall matrix and refuses only a wide one. The port takes no `size` and
 * refuses any matrix that is not square. See plan 004, Slice 2.
 *
 * Every routine here takes `fma`, the option `FmaOption` describes. The
 * default, `true`, rounds each product once into its sum and keeps R's
 * doubles. `false` rounds twice, which runs much faster and lands a few
 * units in the last place away. The setting is read once, at the entry of
 * the routine, and each innermost loop is written twice, one body per
 * setting, with the branch around the loop. One shared call site would go
 * polymorphic as soon as a program used both settings, and the engine would
 * stop inlining it. See the module comment of `lu.ts` for the measurement.
 *
 * Index loops throughout: a factorization addresses single entries by
 * position, and this one follows `dpotrf2`, `dtrsm`, `dsyrk`, `dtrti2`,
 * `dtrmv`, `dlauu2` and `dgemv` step for step.
 */

import { fusedMultiplyAdd, resolveFma, type FmaOption } from "../arith";
import { make, type Matrix } from "./matrix";
import { isMatrix } from "./ops";

/** The arithmetic option of `chol()` and `chol2inv()`. */
export interface CholOptions extends FmaOption {}

/**
 * R's `chol(a)`: the upper triangular factor `U` for which `a` is
 * `t(U) %*% U`.
 *
 * @param a The symmetric positive definite matrix. Only the upper triangle
 *   is read. The function does not modify it.
 * @param options The arithmetic. `{ fma: false }` rounds each product
 *   twice, which is faster and a few units in the last place away from R.
 * @returns The factor, with zeros below the diagonal and the dimnames of
 *   `a`, as R's `chol()` returns them.
 * @throws RangeError If `a` is not square, or a leading minor is not
 *   positive. A NaN on the diagonal is not positive either, so it reports
 *   the same message, as R does for an `NA`.
 * @throws TypeError If `a` is not a matrix, or `fma` is not a boolean.
 */
export function chol(a: Matrix, options: CholOptions = {}): Matrix {
  // The arithmetic is read here, before the loops, and never per entry.
  const fma = resolveFma(options.fma);
  if (!isMatrix(a)) {
    throw new TypeError("expected a Matrix");
  }
  if (a.nrow !== a.ncol) {
    throw new RangeError("'a' must be a square matrix");
  }
  const n = a.nrow;
  const data = upperTriangle(a.data, n);
  const info = dpotrf2(data, n, 0, n, fma);
  if (info !== 0) {
    throw new RangeError(`the leading minor of order ${info} is not positive`);
  }
  return make(n, n, data, a.dimnames);
}

/**
 * R's `chol2inv(x)`: the inverse of `t(U) %*% U` from the upper factor `U`.
 *
 * @param x The upper triangular factor, as `chol()` returns it. Only the
 *   upper triangle is read. The function does not modify it.
 * @param options The arithmetic, as `chol()` takes it.
 * @returns The inverse, symmetric and without dimnames, as R's is. A NaN in
 *   the factor passes through to the entries it reaches, as R's `NA` does.
 * @throws RangeError If `x` is not square — a narrowing of R, which reads
 *   the leading square block of a tall matrix — or a diagonal entry is
 *   zero, in R's own words.
 * @throws TypeError If `x` is not a matrix, or `fma` is not a boolean.
 */
export function chol2inv(x: Matrix, options: CholOptions = {}): Matrix {
  const fma = resolveFma(options.fma);
  if (!isMatrix(x)) {
    throw new TypeError("expected a Matrix");
  }
  if (x.nrow !== x.ncol) {
    throw new RangeError("'x' must be a square matrix");
  }
  const n = x.nrow;
  const data = upperTriangle(x.data, n);
  const info = dtrtri(data, n, fma);
  if (info !== 0) {
    throw new RangeError(
      `element (${info}, ${info}) is zero, so the inverse cannot be computed`,
    );
  }
  dlauum(data, n, fma);
  // R copies the upper triangle down, so the inverse comes back symmetric.
  for (let j = 0; j < n; j++) {
    for (let i = j + 1; i < n; i++) {
      data[j * n + i] = data[i * n + j] as number;
    }
  }
  return make(n, n, data, null);
}

/** Copy the upper triangle of a square buffer, with zeros below it. */
function upperTriangle(source: Float64Array, n: number): Float64Array {
  const data = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i <= j; i++) {
      data[j * n + i] = source[j * n + i] as number;
    }
  }
  return data;
}

/**
 * LAPACK's recursive `dpotrf2` on the upper triangle of an order `n` block
 * that starts at `offset` in a buffer of leading dimension `lda`.
 *
 * @returns LAPACK's `info`: zero on success, or the one-based order of the
 *   leading minor that is not positive.
 */
function dpotrf2(
  data: Float64Array,
  lda: number,
  offset: number,
  n: number,
  fma: boolean,
): number {
  if (n === 0) {
    return 0;
  }
  if (n === 1) {
    const value = data[offset] as number;
    // A NaN fails this comparison, which is how LAPACK reports it too.
    if (!(value > 0)) {
      return 1;
    }
    data[offset] = Math.sqrt(value);
    return 0;
  }
  const n1 = Math.floor(n / 2);
  const n2 = n - n1;
  const leading = dpotrf2(data, lda, offset, n1, fma);
  if (leading !== 0) {
    return leading;
  }
  // A12 sits in the first n1 rows of the last n2 columns of the block.
  const cornerOffset = offset + n1 * lda;
  dtrsm(data, lda, offset, cornerOffset, n1, n2, fma);
  dsyrk(data, lda, cornerOffset, cornerOffset + n1, n2, n1, fma);
  const trailing = dpotrf2(data, lda, cornerOffset + n1, n2, fma);
  return trailing === 0 ? 0 : trailing + n1;
}

/**
 * The `dtrsm` call of `dpotrf2`: `B` becomes `inv(t(A)) %*% B`, for an upper
 * triangular `A` of order `m` and a `B` of `m` rows and `n` columns. The
 * loop order is the reference BLAS one, left side, upper, transposed, with
 * a non-unit diagonal and an alpha of one.
 */
function dtrsm(
  data: Float64Array,
  lda: number,
  aOffset: number,
  bOffset: number,
  m: number,
  n: number,
  fma: boolean,
): void {
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < m; i++) {
      let temp = data[bOffset + j * lda + i] as number;
      if (fma) {
        for (let k = 0; k < i; k++) {
          temp = fusedMultiplyAdd(
            -(data[aOffset + i * lda + k] as number),
            data[bOffset + j * lda + k] as number,
            temp,
          );
        }
      } else {
        for (let k = 0; k < i; k++) {
          temp =
            -(data[aOffset + i * lda + k] as number) *
              (data[bOffset + j * lda + k] as number) +
            temp;
        }
      }
      data[bOffset + j * lda + i] = temp / (data[aOffset + i * lda + i] as number);
    }
  }
}

/**
 * The `dsyrk` call of `dpotrf2`: the upper triangle of `C`, of order `n`,
 * loses `t(A) %*% A` for an `A` of `k` rows and `n` columns. The loop order
 * is the reference BLAS one, upper and transposed, with an alpha of minus
 * one and a beta of one.
 */
function dsyrk(
  data: Float64Array,
  lda: number,
  aOffset: number,
  cOffset: number,
  n: number,
  k: number,
  fma: boolean,
): void {
  for (let j = 0; j < n; j++) {
    for (let i = 0; i <= j; i++) {
      let temp = 0;
      if (fma) {
        for (let l = 0; l < k; l++) {
          temp = fusedMultiplyAdd(
            data[aOffset + i * lda + l] as number,
            data[aOffset + j * lda + l] as number,
            temp,
          );
        }
      } else {
        for (let l = 0; l < k; l++) {
          temp =
            (data[aOffset + i * lda + l] as number) *
              (data[aOffset + j * lda + l] as number) +
            temp;
        }
      }
      // The reference form is `alpha * temp + beta * C`. An alpha of minus
      // one and a beta of one make the product exact, so the subtraction
      // rounds once whichever multiply-add the caller picked.
      data[cOffset + j * lda + i] = (data[cOffset + j * lda + i] as number) - temp;
    }
  }
}

/**
 * LAPACK's `dtrti2` on an upper triangular buffer of order `n` with a
 * non-unit diagonal: the triangle becomes its own inverse in place.
 *
 * @returns LAPACK's `info`: zero on success, or the one-based position of
 *   the first zero on the diagonal.
 */
function dtrtri(data: Float64Array, n: number, fma: boolean): number {
  for (let i = 0; i < n; i++) {
    if (data[i * n + i] === 0) {
      return i + 1;
    }
  }
  for (let j = 0; j < n; j++) {
    const reciprocal = 1 / (data[j * n + j] as number);
    data[j * n + j] = reciprocal;
    const scale = -reciprocal;
    dtrmv(data, n, j, fma);
    for (let i = 0; i < j; i++) {
      data[j * n + i] = (data[j * n + i] as number) * scale;
    }
  }
  return 0;
}

/**
 * The `dtrmv` call of `dtrti2`: the leading `column` entries of that column
 * become the triangle of the same order times themselves. Upper, not
 * transposed, non-unit diagonal, in the reference BLAS loop order.
 */
function dtrmv(data: Float64Array, n: number, column: number, fma: boolean): void {
  for (let k = 0; k < column; k++) {
    const held = data[column * n + k] as number;
    if (held !== 0) {
      if (fma) {
        for (let i = 0; i < k; i++) {
          data[column * n + i] = fusedMultiplyAdd(
            held,
            data[k * n + i] as number,
            data[column * n + i] as number,
          );
        }
      } else {
        for (let i = 0; i < k; i++) {
          data[column * n + i] =
            held * (data[k * n + i] as number) + (data[column * n + i] as number);
        }
      }
      data[column * n + k] = held * (data[k * n + k] as number);
    }
  }
}

/**
 * LAPACK's `dlauu2` on an upper triangular buffer of order `n`: the
 * triangle becomes `U %*% t(U)`, in its upper half. The row dot product is
 * `ddot` and the column update is `dgemv`, both in the reference loop order.
 */
function dlauum(data: Float64Array, n: number, fma: boolean): void {
  for (let i = 0; i < n; i++) {
    const diagonal = data[i * n + i] as number;
    if (i === n - 1) {
      for (let l = 0; l <= i; l++) {
        data[i * n + l] = (data[i * n + l] as number) * diagonal;
      }
      continue;
    }
    // `ddot` of row i from column i to the right edge with itself.
    let total = 0;
    if (fma) {
      for (let j = i; j < n; j++) {
        const value = data[j * n + i] as number;
        total = fusedMultiplyAdd(value, value, total);
      }
    } else {
      for (let j = i; j < n; j++) {
        const value = data[j * n + i] as number;
        total = value * value + total;
      }
    }
    data[i * n + i] = total;
    if (i === 0) {
      // `dgemv` returns at once when it has no rows to write.
      continue;
    }
    // The beta pass of `dgemv`, which scales the column it is about to add
    // to. The reference routine skips it when beta is one and clears the
    // column when beta is zero.
    if (diagonal === 0) {
      for (let l = 0; l < i; l++) {
        data[i * n + l] = 0;
      }
    } else if (diagonal !== 1) {
      for (let l = 0; l < i; l++) {
        data[i * n + l] = (data[i * n + l] as number) * diagonal;
      }
    }
    for (let j = i + 1; j < n; j++) {
      const held = data[j * n + i] as number;
      if (fma) {
        for (let l = 0; l < i; l++) {
          data[i * n + l] = fusedMultiplyAdd(
            held,
            data[j * n + l] as number,
            data[i * n + l] as number,
          );
        }
      } else {
        for (let l = 0; l < i; l++) {
          data[i * n + l] =
            held * (data[j * n + l] as number) + (data[i * n + l] as number);
        }
      }
    }
  }
}
