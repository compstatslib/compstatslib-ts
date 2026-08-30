/**
 * Tests for the shared data-frame helpers.
 *
 * The R package treats its data as an R data frame, which guarantees things
 * TypeScript cannot: every column has one type, and every column has the same
 * length. This module is where the port checks what R gets for free, so
 * `moderation.ts` and (slice 7.3) `scatter3d.ts` both ask the same questions
 * and report the same errors.
 *
 * The R behavior these tests port comes from
 * `../compstatslib/R/scatter3d_helpers.R`:
 *
 * ```r
 * scatter3d_numeric_cols <- function(data) {
 *   names(data)[vapply(data, is.numeric, logical(1))]
 * }
 * ```
 *
 * and its output on the bundled dataset, pinned in
 * `.claude/plans/001-PLAN-port/moderation-fixtures.md` section 5:
 *
 * ```text
 * numeric columns: y, x, z, w
 * ```
 *
 * ## Two rules R does not need
 *
 * R's `is.numeric()` reads a vector's type, so an empty numeric column is
 * numeric and a mixed column cannot exist. A JavaScript array carries no
 * element type, so this module decides by inspecting values: a column counts
 * as numeric when it has at least one value and every value is a number.
 * Both departures are deliberate, and both are pinned below — an empty column
 * offers no evidence that it is numeric, and a column of numbers with one
 * string in it would fit a model on `NaN`.
 */

import { describe, expect, test } from "bun:test";

import { moderationData } from "../data/moderationData";
import {
  frameRows,
  isNumericColumn,
  numericColumns,
  requireNumericColumn,
  type DataFrame,
} from "./frame";

describe("isNumericColumn", () => {
  test("accepts a column of numbers", () => {
    expect(isNumericColumn([1, 2, 3])).toBe(true);
  });

  test("accepts NaN, which R also calls numeric", () => {
    expect(isNumericColumn([1, Number.NaN, 3])).toBe(true);
  });

  test("rejects a column of strings", () => {
    expect(isNumericColumn(["a", "b"])).toBe(false);
    // Contrast, so a guard that always answers false cannot pass this.
    expect(isNumericColumn([1, 2])).toBe(true);
  });

  test("rejects a column of booleans, unlike R's is.numeric on logicals", () => {
    // R's is.numeric(c(TRUE, FALSE)) is FALSE too, so this agrees with R.
    expect(isNumericColumn([true, false])).toBe(false);
    expect(isNumericColumn([0, 1])).toBe(true);
  });

  test("rejects a column that mixes numbers with anything else", () => {
    expect(isNumericColumn([1, "2", 3] as unknown as readonly string[])).toBe(
      false,
    );
    expect(isNumericColumn([1, 2, 3])).toBe(true);
  });

  test("rejects an empty column, which R would call numeric", () => {
    expect(isNumericColumn([])).toBe(false);
    expect(isNumericColumn([1])).toBe(true);
  });
});

describe("numericColumns", () => {
  test("names the numeric columns in insertion order", () => {
    const data: DataFrame = { b: [1, 2], a: [3, 4], c: [5, 6] };
    expect(numericColumns(data)).toEqual(["b", "a", "c"]);
  });

  test("skips non-numeric columns", () => {
    const data: DataFrame = {
      a: [1, 2],
      label: ["p", "q"],
      flag: [true, false],
      c: [5, 6],
    };
    expect(numericColumns(data)).toEqual(["a", "c"]);
  });

  test("returns nothing for a frame with no columns", () => {
    expect(numericColumns({})).toEqual([]);
    // Contrast: the empty answer has to come from the frame, not the function.
    expect(numericColumns({ a: [1] })).toEqual(["a"]);
  });

  test("reproduces R's numeric columns of moderation_data", () => {
    expect(numericColumns(moderationData)).toEqual(["y", "x", "z", "w"]);
  });
});

describe("frameRows", () => {
  test("returns the shared column length", () => {
    expect(frameRows({ a: [1, 2, 3], b: ["p", "q", "r"] })).toBe(3);
  });

  test("returns 0 for a frame with no columns", () => {
    expect(frameRows({})).toBe(0);
    expect(frameRows({ a: [1, 2] })).toBe(2);
  });

  test("returns 0 when every column is empty", () => {
    expect(frameRows({ a: [], b: [] })).toBe(0);
    expect(frameRows({ a: [1], b: ["p"] })).toBe(1);
  });

  test("counts the 200 rows of moderation_data", () => {
    expect(frameRows(moderationData)).toBe(200);
  });

  test("refuses columns of different lengths, which a data frame cannot have", () => {
    expect(() => frameRows({ a: [1, 2, 3], b: [1, 2] })).toThrow(RangeError);
  });

  test("names both columns of a ragged frame in the error", () => {
    expect(() => frameRows({ a: [1, 2, 3], b: [1, 2] })).toThrow(/"a".*"b"|"b".*"a"/s);
  });
});

describe("requireNumericColumn", () => {
  const data: DataFrame = { a: [1, 2, 3], label: ["p", "q", "r"] };

  test("returns the column", () => {
    expect(requireNumericColumn(data, "a", "iv")).toEqual([1, 2, 3]);
  });

  test("refuses a column that is not in the frame", () => {
    expect(() => requireNumericColumn(data, "nope", "iv")).toThrow(RangeError);
  });

  test("names the column and the role of a missing column", () => {
    expect(() => requireNumericColumn(data, "nope", "iv")).toThrow(/nope/);
    expect(() => requireNumericColumn(data, "nope", "iv")).toThrow(/iv/);
  });

  test("refuses a non-numeric column", () => {
    expect(() => requireNumericColumn(data, "label", "mod")).toThrow(RangeError);
  });

  test("names the column and the role of a non-numeric column", () => {
    expect(() => requireNumericColumn(data, "label", "mod")).toThrow(/label/);
    expect(() => requireNumericColumn(data, "label", "mod")).toThrow(/mod/);
  });

  test("refuses an empty column, by the same rule as isNumericColumn", () => {
    expect(() => requireNumericColumn({ a: [] }, "a", "iv")).toThrow(RangeError);
  });
});
