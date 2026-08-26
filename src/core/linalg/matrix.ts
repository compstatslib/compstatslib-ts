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
 * Where R warns and recycles — a data length that `nrow` does not divide, a
 * vector too short for the rows it joins — this module refuses. A warning
 * that silently recycles a mismatched length lets a typo fit the wrong model.
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
 * @param values The entries, in column-major order unless `byrow` is set.
 *   The function copies them.
 * @param options `nrow` or `ncol` (or both, in which case they must agree
 *   with the length), `byrow`, and `dimnames`.
 * @returns The matrix.
 * @throws RangeError If neither extent is given, an extent is not a positive
 *   integer, the length is not a multiple of the extent given (R warns and
 *   recycles; the port refuses), both extents are given and do not multiply
 *   to the length, or a dimnames entry has the wrong length.
 */
export function matrix(
  values: readonly number[],
  options: MatrixOptions,
): Matrix {
  const { byrow = false, dimnames } = options;
  const [nrow, ncol] = extents(values.length, options);

  const data = new Float64Array(nrow * ncol);
  if (byrow) {
    values.forEach((value, index) => {
      const i = Math.floor(index / ncol);
      const j = index % ncol;
      data[j * nrow + i] = value;
    });
  } else {
    data.set(values);
  }

  return make(nrow, ncol, data, dimnames ?? null);
}

/** Resolve `nrow` and `ncol` from whichever the caller gave. */
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

  if (nrow !== undefined && ncol !== undefined) {
    if (nrow * ncol !== length) {
      throw new RangeError(
        `data length [${length}] is not nrow * ncol [${nrow} * ${ncol}]`,
      );
    }
    return [nrow, ncol];
  }
  if (nrow !== undefined) {
    if (length % nrow !== 0) {
      throw new RangeError(
        `data length [${length}] is not a multiple of the number of rows [${nrow}]`,
      );
    }
    return [nrow, length / nrow];
  }
  // ncol alone. The branch above returned for every other case, so ncol is
  // defined here.
  const columns = ncol as number;
  if (length % columns !== 0) {
    throw new RangeError(
      `data length [${length}] is not a multiple of the number of columns [${columns}]`,
    );
  }
  return [length / columns, columns];
}

/** Reject an extent that is not a positive integer. */
function requireExtent(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
}

/**
 * Assemble a matrix from data already in column-major order, checking the
 * dimnames against the extents. Internal to the linalg modules: the data is
 * taken as is, not copied.
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
    if (rows === null && columns === null) {
      dimnames = null;
    }
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
    row.forEach((value, j) => {
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
