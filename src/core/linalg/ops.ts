/**
 * The elementary matrix operations, named as R names them.
 *
 * `t()`, `%*%` (`matmul`), `crossprod()`, `tcrossprod()`, `cbind()`,
 * `rbind()` and `diag()`. Each takes matrices (and, where R allows it, plain
 * vectors) and returns a new matrix; nothing here modifies its input.
 *
 * Dimnames travel as they do in R: a transpose swaps them, a product keeps
 * the row names of the left factor and the column names of the right, and
 * binding stacks them, with `""` for a bare vector joined to a named matrix.
 *
 * The product is written as index loops. A matrix product addresses entries
 * by position, and the loop over `k` innermost keeps each column of the left
 * factor in cache, which is the order R's reference BLAS uses; the sums then
 * accumulate in the same order and round the same way as R's on a build with
 * no fused multiply-add. (CLAUDE.md allows an index loop with a stated
 * reason; that is the reason.)
 */

import { make, type Dimnames, type Matrix } from "./matrix";

/** A matrix, or a vector R would treat as a one-column matrix. */
export type MatrixOrVector = Matrix | readonly number[];

/** R's `t()`. */
export function t(m: Matrix): Matrix {
  const { nrow, ncol } = m;
  const data = new Float64Array(nrow * ncol);
  for (let j = 0; j < ncol; j++) {
    for (let i = 0; i < nrow; i++) {
      data[i * ncol + j] = m.data[j * nrow + i] as number;
    }
  }
  const dimnames: Dimnames | null =
    m.dimnames === null ? null : [m.dimnames[1], m.dimnames[0]];
  return make(ncol, nrow, data, dimnames);
}

/**
 * R's `x %*% y`.
 *
 * @param x The left factor.
 * @param y The right factor. A vector is a column, as R takes it.
 * @returns The product, with the row names of `x` and the column names of
 *   `y`.
 * @throws RangeError If the inner extents differ: R's "non-conformable
 *   arguments".
 */
export function matmul(x: Matrix, y: MatrixOrVector): Matrix {
  const right = asColumn(y);
  if (x.ncol !== right.nrow) {
    throw new RangeError(
      `non-conformable arguments: ${x.nrow} x ${x.ncol} %*% ${right.nrow} x ${right.ncol}`,
    );
  }
  const data = product(x, right);
  return make(x.nrow, right.ncol, data, productDimnames(x, right));
}

/**
 * R's `crossprod(x, y)`: `t(x) %*% y`, with `crossprod(x)` for `t(x) %*% x`.
 *
 * @throws RangeError If the row counts differ.
 */
export function crossprod(x: Matrix, y: MatrixOrVector = x): Matrix {
  const right = asColumn(y);
  if (x.nrow !== right.nrow) {
    throw new RangeError(
      `non-conformable arguments: crossprod of ${x.nrow} x ${x.ncol} and ${right.nrow} x ${right.ncol}`,
    );
  }
  return matmul(t(x), right);
}

/**
 * R's `tcrossprod(x, y)`: `x %*% t(y)`, with `tcrossprod(x)` for
 * `x %*% t(x)`.
 *
 * @throws RangeError If the column counts differ.
 */
export function tcrossprod(x: Matrix, y: MatrixOrVector = x): Matrix {
  const right = asColumn(y);
  if (x.ncol !== right.ncol) {
    throw new RangeError(
      `non-conformable arguments: tcrossprod of ${x.nrow} x ${x.ncol} and ${right.nrow} x ${right.ncol}`,
    );
  }
  return matmul(x, t(right));
}

/** The raw product of two conformable matrices, column-major. */
function product(x: Matrix, y: Matrix): Float64Array {
  const { nrow, ncol: inner } = x;
  const { ncol } = y;
  const data = new Float64Array(nrow * ncol);
  for (let j = 0; j < ncol; j++) {
    for (let k = 0; k < inner; k++) {
      const factor = y.data[j * y.nrow + k] as number;
      for (let i = 0; i < nrow; i++) {
        data[j * nrow + i] += (x.data[k * nrow + i] as number) * factor;
      }
    }
  }
  return data;
}

/** Row names of the left factor, column names of the right. */
function productDimnames(x: Matrix, y: Matrix): Dimnames | null {
  const rows = x.dimnames?.[0] ?? null;
  const columns = y.dimnames?.[1] ?? null;
  return rows === null && columns === null ? null : [rows, columns];
}

/** A vector as R's one-column matrix; a matrix as it is. */
function asColumn(value: MatrixOrVector): Matrix {
  if (isMatrix(value)) {
    return value;
  }
  return make(value.length, 1, Float64Array.from(value), null);
}

function isMatrix(value: MatrixOrVector): value is Matrix {
  return !Array.isArray(value);
}

/**
 * R's `cbind()`: join matrices and vectors side by side.
 *
 * @param parts Matrices, and vectors taken as columns. At least one.
 * @returns The joined matrix. Row names come from the first part that has
 *   them. Column names are kept when any part has them, with `""` for a part
 *   that does not, as R names a bare vector.
 * @throws RangeError If the row counts differ. R recycles a short vector
 *   with a warning; the port refuses.
 */
export function cbind(...parts: readonly MatrixOrVector[]): Matrix {
  const matrices = parts.map(asColumn);
  const first = matrices[0];
  if (first === undefined) {
    throw new RangeError("cbind() needs at least one argument");
  }
  const nrow = first.nrow;
  matrices.forEach((m, index) => {
    if (m.nrow !== nrow) {
      throw new RangeError(
        `number of rows of matrices must match (see arg ${index + 1})`,
      );
    }
  });

  const ncol = matrices.reduce((total, m) => total + m.ncol, 0);
  const data = new Float64Array(nrow * ncol);
  let offset = 0;
  matrices.forEach((m) => {
    data.set(m.data, offset);
    offset += m.data.length;
  });

  const rows = matrices.find((m) => m.dimnames?.[0])?.dimnames?.[0] ?? null;
  const columns = boundNames(
    matrices.map((m) => ({ names: m.dimnames?.[1] ?? null, count: m.ncol })),
  );
  return make(nrow, ncol, data, rows === null && columns === null ? null : [rows, columns]);
}

/**
 * R's `rbind()`: stack matrices and vectors.
 *
 * @param parts Matrices, and vectors taken as rows. At least one.
 * @returns The stacked matrix, with names as `cbind` carries them, rows and
 *   columns exchanged.
 * @throws RangeError If the column counts differ.
 */
export function rbind(...parts: readonly MatrixOrVector[]): Matrix {
  if (parts.length === 0) {
    throw new RangeError("rbind() needs at least one argument");
  }
  const transposed = parts.map((part) => (isMatrix(part) ? t(part) : part));
  try {
    return t(cbind(...transposed));
  } catch (error) {
    if (error instanceof RangeError) {
      throw new RangeError(
        error.message.replace("number of rows", "number of columns"),
      );
    }
    throw error;
  }
}

/** Concatenate the names of bound parts, `""` where a part has none. */
function boundNames(
  parts: readonly { names: readonly string[] | null; count: number }[],
): readonly string[] | null {
  if (parts.every((part) => part.names === null)) {
    return null;
  }
  return parts.flatMap(
    (part) => part.names ?? new Array<string>(part.count).fill(""),
  );
}

/**
 * R's `diag()` in its three forms: a vector gives the diagonal matrix of it,
 * a count gives the identity of that order, and a matrix gives its diagonal.
 */
export function diag(values: readonly number[]): Matrix;
export function diag(order: number): Matrix;
export function diag(m: Matrix): number[];
export function diag(arg: readonly number[] | number | Matrix): Matrix | number[] {
  if (typeof arg === "number") {
    return identity(arg);
  }
  if (Array.isArray(arg)) {
    const values = arg as readonly number[];
    const n = values.length;
    const data = new Float64Array(n * n);
    values.forEach((value, i) => {
      data[i * n + i] = value;
    });
    return make(n, n, data, null);
  }
  const m = arg as Matrix;
  const n = Math.min(m.nrow, m.ncol);
  return Array.from({ length: n }, (_, i) => m.data[i * m.nrow + i] as number);
}

/**
 * The identity matrix of the given order. R's `diag(n)`.
 *
 * @throws RangeError If the order is not a non-negative integer.
 */
export function identity(order: number): Matrix {
  if (!Number.isInteger(order) || order < 0) {
    throw new RangeError(`order must be a non-negative integer, got ${order}`);
  }
  const data = new Float64Array(order * order);
  for (let i = 0; i < order; i++) {
    data[i * order + i] = 1;
  }
  return make(order, order, data, null);
}
