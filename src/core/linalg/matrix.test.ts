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
  row,
  toColumns,
  toRows,
  type Matrix,
} from "./matrix";

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
