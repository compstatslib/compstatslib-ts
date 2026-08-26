/**
 * The elementary matrix operations, named as R names them.
 *
 * `t()`, `%*%` (`matmul`), `crossprod()`, `tcrossprod()`, `cbind()`,
 * `rbind()` and `diag()`. Each takes matrices (and, where R allows it, plain
 * vectors) and returns a new matrix; nothing here modifies its input.
 *
 * A bare vector in a product takes the shape R gives it, which is not
 * always the one that would conform (fixtures 1g and 1h probe the rules).
 * In `%*%`, a left vector is a row when its length matches the rows of the
 * right factor and otherwise a column; a right vector is a column when its
 * length matches the columns of the left factor and otherwise a row; two
 * vectors give their inner product. In `crossprod` a vector `x` is always
 * a column, and a vector `y` is a column when its length matches the rows
 * of `x` and otherwise a row. In `tcrossprod` a vector `x` is a row when
 * its length matches the columns of a matrix `y` and otherwise a column,
 * and a vector `y` is a row only when `x` has one row; two vectors are both
 * columns, the outer product.
 *
 * Dimnames travel as they do in R: a transpose swaps them, a product keeps
 * the row names of the left factor and the column names of the right, and
 * binding stacks them, with `""` for a bare vector joined to a named matrix.
 *
 * The product follows the reference BLAS `dgemm` that R ships: the loop
 * over `i` innermost walks each column of the left factor in order, and each
 * product is rounded once into its running sum with `fusedMultiplyAdd`,
 * because the build the conformance fixtures come from contracts
 * `C + A * B` into one instruction (the fixture README records this; the LU
 * and QR here already follow it). Index loops throughout: a product
 * addresses entries by position. (CLAUDE.md allows an index loop with a
 * stated reason; that is the reason.)
 */

import { fusedMultiplyAdd } from "../arith";
import { make, type Dimnames, type Matrix } from "./matrix";

/** A matrix, or a vector R would treat as a one-column matrix. */
export type MatrixOrVector = Matrix | readonly number[];

/** R's `t()`. Also exported as `transpose`, for an app whose `t` is already taken. */
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

/** R's `t()`, under a name that does not collide with an i18n `t`. */
export const transpose = t;

/**
 * R's `x %*% y`.
 *
 * @param x The left factor. A vector is a row when its length matches the
 *   rows of `y`, else a column when `y` has one row.
 * @param y The right factor. A vector is a column when its length matches
 *   the columns of `x`, else a row when `x` has one column. Two vectors of
 *   one length give their inner product as a 1 x 1 matrix.
 * @returns The product, with the row names of `x` and the column names of
 *   `y`.
 * @throws RangeError If the inner extents differ: R's "non-conformable
 *   arguments".
 */
export function matmul(x: MatrixOrVector, y: MatrixOrVector): Matrix {
  const [left, right] = conformProduct(x, y);
  if (left.ncol !== right.nrow) {
    throw new RangeError(
      `non-conformable arguments: ${left.nrow} x ${left.ncol} %*% ${right.nrow} x ${right.ncol}`,
    );
  }
  const data = product(left, right);
  return make(left.nrow, right.ncol, data, productDimnames(left, right));
}

/** Shape the factors of `%*%` by R's rules for a bare vector. */
function conformProduct(x: MatrixOrVector, y: MatrixOrVector): [Matrix, Matrix] {
  if (isMatrix(x)) {
    if (isMatrix(y)) {
      return [x, y];
    }
    return [x, y.length === x.ncol ? asColumn(y) : asRow(y)];
  }
  if (isMatrix(y)) {
    return [x.length === y.nrow ? asRow(x) : asColumn(x), y];
  }
  // Two vectors: `x` is a row, and `y` is a row too when `x` is a single
  // value, else a column — the inner product when the lengths agree.
  return [asRow(x), x.length === 1 ? asRow(y) : asColumn(y)];
}

/**
 * R's `crossprod(x, y)`: `t(x) %*% y`, with `crossprod(x)` for `t(x) %*% x`.
 * A bare vector `x` is a column; a bare vector `y` is a column when its
 * length matches the rows of `x`, else a row (fixture 1h).
 *
 * @throws RangeError If the row counts differ.
 */
export function crossprod(x: MatrixOrVector, y: MatrixOrVector = x): Matrix {
  const left = asColumn(x);
  const right = isMatrix(y) ? y : y.length === left.nrow ? asColumn(y) : asRow(y);
  if (left.nrow !== right.nrow) {
    throw new RangeError(
      `non-conformable arguments: crossprod of ${left.nrow} x ${left.ncol} and ${right.nrow} x ${right.ncol}`,
    );
  }
  return matmul(t(left), right);
}

/**
 * R's `tcrossprod(x, y)`: `x %*% t(y)`, with `tcrossprod(x)` for
 * `x %*% t(x)`. A bare vector `x` is a row when its length matches the
 * columns of a matrix `y`, else a column; a bare vector `y` is a row only
 * when `x` has one row, and two bare vectors are both columns (fixture 1h).
 *
 * @throws RangeError If the column counts differ.
 */
export function tcrossprod(x: MatrixOrVector, y: MatrixOrVector = x): Matrix {
  const bothVectors = !isMatrix(x) && !isMatrix(y);
  const left = isMatrix(x) ? x : isMatrix(y) && y.ncol === x.length ? asRow(x) : asColumn(x);
  const right = isMatrix(y)
    ? y
    : !bothVectors && left.nrow === 1
      ? asRow(y)
      : asColumn(y);
  if (left.ncol !== right.ncol) {
    throw new RangeError(
      `non-conformable arguments: tcrossprod of ${left.nrow} x ${left.ncol} and ${right.nrow} x ${right.ncol}`,
    );
  }
  return matmul(left, t(right));
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
        data[j * nrow + i] = fusedMultiplyAdd(
          x.data[k * nrow + i] as number,
          factor,
          data[j * nrow + i] as number,
        );
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

/** A vector as a one-row matrix. */
function asRow(value: readonly number[]): Matrix {
  return make(1, value.length, Float64Array.from(value), null);
}

/**
 * Tell a matrix from a vector by shape, and refuse anything else — a typed
 * array or a stray object — with a TypeError rather than a wrong shape.
 *
 * @internal Shared with the other linalg modules; not part of the entry.
 */
export function isMatrix(value: MatrixOrVector): value is Matrix {
  if (Array.isArray(value)) {
    return false;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "nrow" in value &&
    "ncol" in value &&
    "data" in value
  ) {
    return true;
  }
  throw new TypeError("expected a Matrix or an array of numbers");
}

/**
 * R's `cbind()`: join matrices and vectors side by side.
 *
 * @param parts Matrices, and vectors taken as columns. At least one.
 * @returns The joined matrix. Row names come from the first part that has
 *   them. Column names are kept when any part has them, with `""` for a part
 *   that does not, as R names a bare vector.
 * @throws RangeError If the row counts differ, in R's words for a matrix
 *   part and for a vector part. R recycles a short vector with a warning;
 *   the port refuses.
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
        isMatrix(parts[index] as MatrixOrVector)
          ? `number of rows of matrices must match (see arg ${index + 1})`
          : `number of rows of result is not a multiple of vector length (arg ${index + 1})`,
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
 *
 * The form is chosen by type, not by length, which is R's own gotcha
 * removed: `diag([5])` is the 1 x 1 matrix `[5]` where R's `diag(c(5))` is
 * the 5 x 5 identity, and `diag(2.5)` refuses where R truncates to 2 x 2.
 * The diagonal of a matrix comes back as a plain array; R names it when the
 * row and column names agree, which the port will do once a named vector
 * exists (plan Q11).
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
