/**
 * Tests for the matrix type and its constructors.
 *
 * Expected values come from R 4.5.3, `../compstatslib/conformance-fixtures/linalg.R`
 * section 1a and 1c, captured in `.claude/plans/003-PLAN-linalg/linalg-fixtures.md`.
 * Fill order and dimnames are structural, so every assertion here is exact.
 */

import { describe, expect, test } from "bun:test";
import {
  at,
  column,
  fromColumns,
  fromRows,
  matrix,
  matrixIndex,
  row,
  toColumns,
  toRows,
  withDim,
  type Matrix,
} from "./matrix.js";

/** R's `as.vector(m)`: the column-major data as a plain array. */
function columnMajor(m: Matrix): number[] {
  return Array.from(m.data);
}

describe("matrix()", () => {
  test("fills column by column, as R does — fixture 1a", () => {
    const a = matrix([1, 2, 3, 4, 5, 6], { nrow: 3 });
    expect(a.nrow).toBe(3);
    expect(a.ncol).toBe(2);
    expect(columnMajor(a)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(a.dimnames).toBeNull();
  });

  test("byrow fills row by row — fixture 1a", () => {
    const a = matrix([1, 2, 3, 4, 5, 6], { nrow: 3, byrow: true });
    expect(columnMajor(a)).toEqual([1, 3, 5, 2, 4, 6]);
  });

  test("ncol alone infers nrow — fixture 1a", () => {
    const a = matrix([1, 2, 3, 4, 5, 6], { ncol: 2 });
    expect(a.nrow).toBe(3);
    expect(a.ncol).toBe(2);
    expect(columnMajor(a)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("nrow and ncol together must agree with the length", () => {
    expect(matrix([1, 2, 3, 4], { nrow: 2, ncol: 2 }).ncol).toBe(2);
    expect(() => matrix([1, 2, 3, 4], { nrow: 2, ncol: 3 })).toThrow(
      RangeError,
    );
  });

  test("carries dimnames — fixture 1c", () => {
    const x = matrix([1, 2, 3, 4], {
      nrow: 2,
      dimnames: [
        ["r1", "r2"],
        ["a", "b"],
      ],
    });
    expect(x.dimnames).toEqual([
      ["r1", "r2"],
      ["a", "b"],
    ]);
    const y = matrix([1, 0, 2, -1, 0.5, 3], {
      nrow: 2,
      dimnames: [null, ["u", "v", "w"]],
    });
    expect(y.dimnames).toEqual([null, ["u", "v", "w"]]);
  });

  test("recycles a scalar, as R silently does — fixture 1g", () => {
    expect(columnMajor(matrix([0], { nrow: 3, ncol: 3 }))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const column = matrix([7], { nrow: 2 });
    expect([column.nrow, column.ncol]).toEqual([2, 1]);
    expect(columnMajor(column)).toEqual([7, 7]);
  });

  test("refuses a sub-multiple, which R silently recycles — fixture 1g", () => {
    // R's matrix(1:3, 3, 2) repeats the column. The port recycles a scalar
    // only; a caller who wants the repeat writes cbind(v, v).
    expect(() => matrix([1, 2, 3], { nrow: 3, ncol: 2 })).toThrow(
      /data length \[3\] is not nrow \* ncol \[3 \* 2\]/,
    );
  });

  test("allows zero extents, as R does — fixture 1g", () => {
    expect([matrix([], { nrow: 0 }).nrow, matrix([], { nrow: 0 }).ncol]).toEqual([0, 0]);
    expect([matrix([], { nrow: 0, ncol: 3 }).nrow, matrix([], { nrow: 0, ncol: 3 }).ncol]).toEqual([0, 3]);
    expect([matrix([], { ncol: 0 }).nrow, matrix([], { ncol: 0 }).ncol]).toEqual([0, 0]);
    expect(() => matrix([1, 2], { nrow: 0 })).toThrow(/data is too long/);
  });

  test("reads a hole in a sparse array as NaN on every fill path", () => {
    const sparse = [1, , 3, 4] as number[];
    expect(columnMajor(matrix(sparse, { nrow: 2 }))).toEqual([1, NaN, 3, 4]);
    expect(columnMajor(matrix(sparse, { nrow: 2, byrow: true }))).toEqual([1, 3, NaN, 4]);
    expect(columnMajor(fromRows([sparse]))).toEqual([1, NaN, 3, 4]);
    expect(columnMajor(fromColumns([sparse]))).toEqual([1, NaN, 3, 4]);
    // More than one row, so the hole has to survive the scatter down a
    // column rather than a single straight fill. `fromRows` no longer builds
    // a typed array per row to get this; it relies on a Float64Array storing
    // `undefined` as NaN. See the comment at the function.
    expect(columnMajor(fromRows([sparse, [5, 6, 7, 8]]))).toEqual([
      1, 5, NaN, 6, 3, 7, 4, 8,
    ]);
  });

  test("copies its dimnames", () => {
    const names: [string[], string[]] = [["r1", "r2"], ["a", "b"]];
    const x = matrix([1, 2, 3, 4], { nrow: 2, dimnames: names });
    names[0][0] = "changed";
    names[1].push("extra");
    expect(x.dimnames).toEqual([
      ["r1", "r2"],
      ["a", "b"],
    ]);
  });

  test("refuses a length that nrow does not divide, where R warns and recycles — fixture 1f", () => {
    expect(() => matrix([1, 2, 3, 4, 5], { nrow: 2 })).toThrow(
      /data length \[5\] is not a multiple of the number of rows \[2\]/,
    );
  });

  test("refuses dimnames of the wrong length", () => {
    expect(() =>
      matrix([1, 2, 3, 4], { nrow: 2, dimnames: [["only"], null] }),
    ).toThrow(/dimnames/);
  });

  test("refuses a missing, negative, fractional or unsafe dimension", () => {
    expect(() => matrix([1, 2], {})).toThrow(RangeError);
    expect(() => matrix([1, 2], { nrow: -1 })).toThrow(RangeError);
    expect(() => matrix([1, 2], { nrow: 1.5 })).toThrow(RangeError);
    expect(() => matrix([], { nrow: 1e21 })).toThrow(RangeError);
  });

  test("copies its input", () => {
    const values = [1, 2, 3, 4];
    const a = matrix(values, { nrow: 2 });
    values[0] = 99;
    expect(at(a, 0, 0)).toBe(1);
  });
});

describe("fromRows() and fromColumns()", () => {
  test("agree with matrix() and with each other — fixture 1a", () => {
    const byRows = fromRows([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
    const byColumns = fromColumns([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(columnMajor(byRows)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(columnMajor(byColumns)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(byRows.nrow).toBe(3);
    expect(byColumns.nrow).toBe(3);
  });

  test("refuse a ragged input", () => {
    expect(() => fromRows([[1, 2], [3]])).toThrow(RangeError);
    expect(() => fromColumns([[1, 2], [3]])).toThrow(RangeError);
  });

  test("refuse no rows or no columns", () => {
    expect(() => fromRows([])).toThrow(RangeError);
    expect(() => fromColumns([])).toThrow(RangeError);
  });
});

describe("accessors", () => {
  const a = matrix([1, 2, 3, 4, 5, 6], { nrow: 3 });

  test("at() is zero-based, row then column", () => {
    expect(at(a, 0, 0)).toBe(1);
    expect(at(a, 2, 0)).toBe(3);
    expect(at(a, 0, 1)).toBe(4);
    expect(at(a, 2, 1)).toBe(6);
  });

  test("at() refuses an index outside the matrix", () => {
    expect(() => at(a, 3, 0)).toThrow(RangeError);
    expect(() => at(a, 0, 2)).toThrow(RangeError);
    expect(() => at(a, -1, 0)).toThrow(RangeError);
  });

  test("row() and column() read one line", () => {
    expect(row(a, 1)).toEqual([2, 5]);
    expect(column(a, 1)).toEqual([4, 5, 6]);
  });

  test("toRows() and toColumns() round-trip", () => {
    expect(toRows(a)).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
    expect(toColumns(a)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(columnMajor(fromRows(toRows(a)))).toEqual(columnMajor(a));
  });
});

describe("withDim()", () => {
  test("adopts the buffer without copying it", () => {
    const buffer = Float64Array.from([1, 2, 3, 4, 5, 6]);
    const m = withDim(buffer, { nrow: 3 });
    expect(m.data).toBe(buffer);
    expect(m.nrow).toBe(3);
    expect(m.ncol).toBe(2);
  });

  /**
   * The one place this departs from R. R's `dim(v) <- c(3, 2)` copies on
   * modify, so the caller's `v` and the matrix part ways; JavaScript has no
   * such thing, so an adopted buffer aliases. Pinning it here rather than
   * warning about it in prose: the aliasing is the feature, and a caller who
   * reuses one buffer across bootstrap replications depends on it.
   */
  test("a write through the caller's handle is visible in the matrix", () => {
    const buffer = Float64Array.from([1, 2, 3, 4, 5, 6]);
    const m = withDim(buffer, { nrow: 3 });
    buffer[0] = 99;
    buffer[5] = -1;
    expect(at(m, 0, 0)).toBe(99);
    expect(at(m, 2, 1)).toBe(-1);
  });

  test("fills column by column, as matrix() does", () => {
    const m = withDim(Float64Array.from([1, 2, 3, 4, 5, 6]), { nrow: 3 });
    expect(toRows(m)).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  test("takes either extent, or both when they agree", () => {
    expect(withDim(Float64Array.from([1, 2, 3, 4]), { ncol: 2 }).nrow).toBe(2);
    expect(
      withDim(Float64Array.from([1, 2, 3, 4]), { nrow: 2, ncol: 2 }).ncol,
    ).toBe(2);
  });

  test("refuses extents that do not match the length", () => {
    expect(() => withDim(Float64Array.from([1, 2, 3]), { nrow: 2 })).toThrow(
      RangeError,
    );
    expect(() =>
      withDim(Float64Array.from([1, 2, 3, 4]), { nrow: 3, ncol: 3 }),
    ).toThrow(RangeError);
    expect(() => withDim(Float64Array.from([1, 2]), {})).toThrow(RangeError);
  });

  /**
   * `matrix()` recycles a single value over the whole matrix. `withDim` has
   * no such path: adopting means the buffer *is* the storage, and a scalar is
   * not storage for nine entries.
   */
  test("does not recycle a single value", () => {
    expect(() =>
      withDim(Float64Array.from([0]), { nrow: 3, ncol: 3 }),
    ).toThrow(RangeError);
  });

  test("refuses byrow, which would mean a reordering copy", () => {
    expect(() =>
      withDim(Float64Array.from([1, 2, 3, 4]), { nrow: 2, byrow: true }),
    ).toThrow(RangeError);
    // `byrow: false` is the default and says nothing, so it is allowed.
    expect(
      withDim(Float64Array.from([1, 2, 3, 4]), { nrow: 2, byrow: false }).ncol,
    ).toBe(2);
  });

  test("copies dimnames, so no two matrices share one", () => {
    const rows = ["a", "b"];
    const m = withDim(Float64Array.from([1, 2, 3, 4]), {
      nrow: 2,
      dimnames: [rows, ["x", "y"]],
    });
    rows[0] = "changed";
    expect(m.dimnames?.[0]).toEqual(["a", "b"]);
  });

  test("validates dimnames against the extents, as make() does", () => {
    expect(() =>
      withDim(Float64Array.from([1, 2, 3, 4]), {
        nrow: 2,
        dimnames: [["a", "b", "c"], null],
      }),
    ).toThrow(RangeError);
  });
});

describe("matrixIndex()", () => {
  const m = matrix([1, 2, 3, 4, 5, 6], {
    nrow: 3,
    dimnames: [
      ["r1", "r2", "r3"],
      ["c1", "c2"],
    ],
  });

  test("resolves a name to its position", () => {
    const index = matrixIndex(m);
    expect(index.row("r1")).toBe(0);
    expect(index.row("r3")).toBe(2);
    expect(index.col("c2")).toBe(1);
  });

  test("offset() lands on the entry at() reads", () => {
    const index = matrixIndex(m);
    expect(m.data[index.offset("r2", "c2")]).toBe(at(m, 1, 1));
    expect(m.data[index.offset("r3", "c1")]).toBe(at(m, 2, 0));
  });

  /**
   * The point of splitting `row` and `col` out of `offset`: every
   * name-addressed fill loops the column name outside and the row name in, so
   * the caller hoists one lookup out of the inner loop.
   */
  test("row() and col() compose into the same offset", () => {
    const index = matrixIndex(m);
    const j = index.col("c2");
    expect(j * m.nrow + index.row("r3")).toBe(index.offset("r3", "c2"));
  });

  test("an absent name is a RangeError in R's words", () => {
    const index = matrixIndex(m);
    expect(() => index.row("nope")).toThrow(RangeError);
    expect(() => index.row("nope")).toThrow(/subscript out of bounds/);
    expect(() => index.col("nope")).toThrow(RangeError);
    expect(() => index.offset("r1", "nope")).toThrow(RangeError);
  });

  test("a matrix with no dimnames reports as such, per dimension", () => {
    const bare = matrix([1, 2, 3, 4], { nrow: 2 });
    const index = matrixIndex(bare);
    expect(() => index.row("a")).toThrow(/no rownames/);
    expect(() => index.col("a")).toThrow(/no colnames/);

    const rowsOnly = matrix([1, 2, 3, 4], {
      nrow: 2,
      dimnames: [["a", "b"], null],
    });
    const partial = matrixIndex(rowsOnly);
    expect(partial.row("b")).toBe(1);
    expect(() => partial.col("x")).toThrow(/no colnames/);
  });

  test("with a repeated name, the first, as R's match() gives", () => {
    const dup = matrix([1, 2, 3, 4], {
      nrow: 2,
      dimnames: [["a", "a"], ["x", "y"]],
    });
    expect(matrixIndex(dup).row("a")).toBe(0);
  });
});
