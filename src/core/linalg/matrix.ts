/**
 * A matrix, held the way R holds one.
 *
 * R stores a matrix as one vector in column-major order with a `dim`
 * attribute and optional `dimnames`. This module keeps that shape as a plain
 * object: a `Float64Array` of the entries column by column, the two extents,
 * and the names. Plain data, not a class — a matrix serializes, clones and
 * crosses a worker boundary as it is, and every operation on it is a function
 * in R's vocabulary (`t`, `matmul`, `crossprod`, `cbind`, …) in `ops.ts`.
 *
 * Column-major is load-bearing. It is what R, LAPACK and every conformance
 * fixture assume, so `matrix(c(x1, y1, x2, y2), nrow = 2)` translates with
 * no reordering, and a factorization ported from LINPACK reads the same
 * memory in the same order.
 *
 * Indices are zero-based throughout, as the language's are. R's `A[1, 1]` is
 * `at(a, 0, 0)` here.
 *
 * R recycles the data to fill the matrix: a scalar silently, a sub-multiple
 * of the extent silently too (`matrix(1:3, 3, 2)` repeats the column), and
 * any other length with a warning. This module recycles a scalar only —
 * `matrix([0], {nrow: 3, ncol: 3})` is R's `matrix(0, 3, 3)` — and refuses
 * every other mismatch, warned or not. A silently recycled column lets a
 * typo fit the wrong model; a caller who wants the repeat writes
 * `cbind(v, v)`.
 */

/** Row names and column names, either of which R may leave `NULL`. */
export type Dimnames = readonly [
  readonly string[] | null,
  readonly string[] | null,
];

/** A matrix in R's layout: column-major data with its two extents. */
export interface Matrix {
  readonly nrow: number;
  readonly ncol: number;
  /**
   * The entries, column by column: entry `(i, j)` is `data[j * nrow + i]`.
   * Treat it as read-only. A `Float64Array` has no read-only type, so the
   * rule is stated rather than enforced.
   */
  readonly data: Float64Array;
  /** R's `dimnames`, or null when the matrix has none. */
  readonly dimnames: Dimnames | null;
}

/** The named arguments of R's `matrix()`. */
export interface MatrixOptions {
  /** The number of rows. At least one of `nrow` and `ncol` is required. */
  readonly nrow?: number;
  /** The number of columns. */
  readonly ncol?: number;
  /** Fill row by row instead of column by column. False by default. */
  readonly byrow?: boolean;
  /** Row names and column names. */
  readonly dimnames?: Dimnames;
}

/**
 * Build a matrix from its entries, as R's `matrix()` does.
 *
 * @param values The entries, in column-major order unless `byrow` is set,
 *   or a single value to fill the whole matrix with. The function copies
 *   them; a hole in a sparse array reads as NaN.
 * @param options `nrow` or `ncol` (or both, in which case they must agree
 *   with the length), `byrow`, and `dimnames`. An extent may be zero, as
 *   R's may.
 * @returns The matrix.
 * @throws RangeError If neither extent is given, an extent is not a
 *   non-negative integer, the length is not a multiple of the extent given
 *   (R warns and recycles; the port refuses), both extents are given and do
 *   not multiply to the length (R recycles a sub-multiple silently; the port
 *   refuses), or a dimnames entry has the wrong length.
 */
export function matrix(
  values: readonly number[],
  options: MatrixOptions,
): Matrix {
  const { byrow = false, dimnames } = options;
  const [nrow, ncol] = extents(values.length, options);
  // A typed array has no holes, so every fill path below sees the same
  // dense sequence, with NaN where the caller's array had a gap.
  const dense = Float64Array.from(values);

  const data = new Float64Array(nrow * ncol);
  if (dense.length === 1 && data.length > 1) {
    data.fill(dense[0] as number);
  } else if (byrow) {
    dense.forEach((value, index) => {
      const i = Math.floor(index / ncol);
      const j = index % ncol;
      data[j * nrow + i] = value;
    });
  } else {
    data.set(dense);
  }

  return make(nrow, ncol, data, dimnames ?? null);
}

/**
 * Resolve `nrow` and `ncol` from whichever the caller gave. A single value
 * fills any extents; otherwise the length must match them.
 */
function extents(
  length: number,
  { nrow, ncol }: MatrixOptions,
): [number, number] {
  if (nrow === undefined && ncol === undefined) {
    throw new RangeError("matrix() needs nrow or ncol");
  }
  if (nrow !== undefined) {
    requireExtent(nrow, "nrow");
  }
  if (ncol !== undefined) {
    requireExtent(ncol, "ncol");
  }
  const scalar = length === 1;

  if (nrow !== undefined && ncol !== undefined) {
    if (!scalar && nrow * ncol !== length) {
      throw new RangeError(
        length > nrow * ncol
          ? "data is too long"
          : `data length [${length}] is not nrow * ncol [${nrow} * ${ncol}]`,
      );
    }
    return [nrow, ncol];
  }
  // One extent given. R's `matrix(numeric(0), nrow = 0)` is 0 x 0.
  const given = (nrow ?? ncol) as number;
  const name = nrow !== undefined ? "rows" : "columns";
  if (given === 0) {
    if (length !== 0) {
      throw new RangeError("data is too long");
    }
    return [0, 0];
  }
  const other = scalar ? 1 : length / given;
  if (!scalar && length % given !== 0) {
    throw new RangeError(
      `data length [${length}] is not a multiple of the number of ${name} [${given}]`,
    );
  }
  return nrow !== undefined ? [nrow, other] : [other, given];
}

/** Reject an extent that is not a non-negative integer a double can count. */
function requireExtent(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

/**
 * Assemble a matrix from data already in column-major order, checking the
 * dimnames against the extents and copying the name arrays so that no two
 * matrices share one. The data is taken as is, not copied.
 *
 * @internal Not part of the entry point. The other linalg modules build
 *   their results through it.
 */
export function make(
  nrow: number,
  ncol: number,
  data: Float64Array,
  dimnames: Dimnames | null,
): Matrix {
  if (data.length !== nrow * ncol) {
    throw new RangeError(
      `data length [${data.length}] is not nrow * ncol [${nrow} * ${ncol}]`,
    );
  }
  if (dimnames !== null) {
    const [rows, columns] = dimnames;
    if (rows !== null && rows.length !== nrow) {
      throw new RangeError(
        `length of dimnames [1] (${rows.length}) not equal to array extent (${nrow})`,
      );
    }
    if (columns !== null && columns.length !== ncol) {
      throw new RangeError(
        `length of dimnames [2] (${columns.length}) not equal to array extent (${ncol})`,
      );
    }
    dimnames =
      rows === null && columns === null
        ? null
        : [rows === null ? null : [...rows], columns === null ? null : [...columns]];
  }
  return { nrow, ncol, data, dimnames };
}

/**
 * Build a matrix from its rows.
 *
 * @param rows One array per row, each one value per column. Copied.
 * @returns The matrix.
 * @throws RangeError If there are no rows, a row is empty, or the rows have
 *   different lengths.
 */
export function fromRows(rows: readonly (readonly number[])[]): Matrix {
  const nrow = rows.length;
  const first = rows[0];
  if (first === undefined || first.length === 0) {
    throw new RangeError("fromRows() needs at least one row with one value");
  }
  const ncol = first.length;
  const ragged = rows.findIndex((row) => row.length !== ncol);
  if (ragged !== -1) {
    throw new RangeError(
      `every row needs ${ncol} values; row ${ragged} has ${(rows[ragged] as readonly number[]).length}`,
    );
  }

  const data = new Float64Array(nrow * ncol);
  rows.forEach((row, i) => {
    // Through a typed array, so a hole reads as NaN rather than being skipped.
    Float64Array.from(row).forEach((value, j) => {
      data[j * nrow + i] = value;
    });
  });
  return make(nrow, ncol, data, null);
}

/**
 * Build a matrix from its columns. This is R's `cbind()` over vectors and
 * the natural constructor from a column-keyed data frame.
 *
 * @param columns One array per column, each one value per row. Copied.
 * @returns The matrix.
 * @throws RangeError If there are no columns, a column is empty, or the
 *   columns have different lengths.
 */
export function fromColumns(
  columns: readonly (readonly number[])[],
): Matrix {
  const ncol = columns.length;
  const first = columns[0];
  if (first === undefined || first.length === 0) {
    throw new RangeError(
      "fromColumns() needs at least one column with one value",
    );
  }
  const nrow = first.length;
  const ragged = columns.findIndex((column) => column.length !== nrow);
  if (ragged !== -1) {
    throw new RangeError(
      `every column needs ${nrow} values; column ${ragged} has ${(columns[ragged] as readonly number[]).length}`,
    );
  }

  const data = new Float64Array(nrow * ncol);
  columns.forEach((column, j) => {
    data.set(column, j * nrow);
  });
  return make(nrow, ncol, data, null);
}

/**
 * Read one entry. R's `m[i + 1, j + 1]`.
 *
 * @throws RangeError If the index is outside the matrix.
 */
export function at(m: Matrix, i: number, j: number): number {
  if (!Number.isInteger(i) || i < 0 || i >= m.nrow) {
    throw new RangeError(`row index ${i} is outside 0..${m.nrow - 1}`);
  }
  if (!Number.isInteger(j) || j < 0 || j >= m.ncol) {
    throw new RangeError(`column index ${j} is outside 0..${m.ncol - 1}`);
  }
  return m.data[j * m.nrow + i] as number;
}

/** Read one row as a plain array. R's `m[i + 1, ]`. */
export function row(m: Matrix, i: number): number[] {
  if (!Number.isInteger(i) || i < 0 || i >= m.nrow) {
    throw new RangeError(`row index ${i} is outside 0..${m.nrow - 1}`);
  }
  return Array.from({ length: m.ncol }, (_, j) => m.data[j * m.nrow + i] as number);
}

/** Read one column as a plain array. R's `m[, j + 1]`. */
export function column(m: Matrix, j: number): number[] {
  if (!Number.isInteger(j) || j < 0 || j >= m.ncol) {
    throw new RangeError(`column index ${j} is outside 0..${m.ncol - 1}`);
  }
  return Array.from(m.data.subarray(j * m.nrow, (j + 1) * m.nrow));
}

/** The matrix as an array of rows. */
export function toRows(m: Matrix): number[][] {
  return Array.from({ length: m.nrow }, (_, i) => row(m, i));
}

/** The matrix as an array of columns. */
export function toColumns(m: Matrix): number[][] {
  return Array.from({ length: m.ncol }, (_, j) => column(m, j));
}
