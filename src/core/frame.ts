/**
 * Column-keyed data frames, and the checks R gets for free.
 *
 * The 3D functions of the R package take an R data frame, which guarantees
 * two things a JavaScript object does not: every column holds one type, and
 * every column has the same length. `moderation.ts` and the scatter3d module
 * both need those guarantees, so the questions are asked in one place and
 * answered the same way for both.
 *
 * The port follows `../compstatslib/R/scatter3d_helpers.R`:
 *
 * ```r
 * scatter3d_numeric_cols <- function(data) {
 *   names(data)[vapply(data, is.numeric, logical(1))]
 * }
 * ```
 *
 * with two departures, both forced by the language and both pinned by tests.
 * R reads a vector's declared type, so `is.numeric(numeric(0))` is TRUE and a
 * column of mixed types cannot exist. A JavaScript array declares nothing, so
 * this module reads the values: **a column is numeric when it holds at least
 * one value and every value is a number.** An empty column therefore is not
 * numeric — it offers no evidence either way, and an empty axis draws nothing
 * — and a column of numbers with one string in it is not numeric either,
 * because fitting it would give `NaN` for every coefficient.
 */

/**
 * One column of a data frame.
 *
 * Numeric columns carry the statistics. The other two types are here because
 * `plot_scatter3d()` accepts a categorical column for `color`, which R allows
 * to be a factor, a character vector, or a logical vector.
 */
export type Column = readonly number[] | readonly string[] | readonly boolean[];

/**
 * A data frame: named columns of equal length.
 *
 * The equal length is a rule, not a type. `frameRows` enforces it.
 */
export type DataFrame = { readonly [name: string]: Column };

/**
 * Report whether a column holds numbers, and narrow it when it does.
 *
 * @param column The column to inspect.
 * @returns True when the column has at least one value and every value is a
 *   number. `NaN` counts as a number, as R's missing values do.
 */
export function isNumericColumn(column: Column): column is readonly number[] {
  return column.length > 0 && column.every((value) => typeof value === "number");
}

/**
 * Name the numeric columns, in the order the frame declares them.
 *
 * This is R's `scatter3d_numeric_cols()`. The order matters: the scatter3d
 * default takes the first three names this returns.
 *
 * @param data The frame to inspect.
 * @returns The names of the numeric columns, in insertion order.
 */
export function numericColumns(data: DataFrame): string[] {
  return Object.keys(data).filter((name) =>
    isNumericColumn(data[name] as Column),
  );
}

/**
 * Return the number of rows, and refuse a frame that has no single answer.
 *
 * @param data The frame to measure.
 * @returns The shared length of the columns. A frame with no columns has no
 *   rows.
 * @throws RangeError If two columns have different lengths. An R data frame
 *   cannot be built that way, so nothing downstream is written to survive it.
 */
export function frameRows(data: DataFrame): number {
  const names = Object.keys(data);
  const first = names[0];
  if (first === undefined) {
    return 0;
  }

  const rows = (data[first] as Column).length;
  const ragged = names.find((name) => (data[name] as Column).length !== rows);
  if (ragged !== undefined) {
    throw new RangeError(
      `every column needs the same number of rows: "${first}" has ${rows} ` +
        `but "${ragged}" has ${(data[ragged] as Column).length}`,
    );
  }

  return rows;
}

/**
 * Read one numeric column, or explain why it cannot be used.
 *
 * The wording follows R's own, which names both the column and the argument
 * it arrived through: `Column "b" (passed as \`x\`) is not in \`data\`.`
 *
 * @param data The frame to read.
 * @param name The column name the caller asked for.
 * @param role The option that carried the name, such as `iv` or `mod`. It
 *   appears in the error, so the caller learns which argument is wrong.
 * @returns The column.
 * @throws RangeError If the frame has no such column, or the column is not
 *   numeric.
 */
export function requireNumericColumn(
  data: DataFrame,
  name: string,
  role: string,
): readonly number[] {
  const column = data[name];
  if (column === undefined) {
    throw new RangeError(
      `Column "${name}" (passed as \`${role}\`) is not in the data.`,
    );
  }
  if (!isNumericColumn(column)) {
    throw new RangeError(
      `Column "${name}" (passed as \`${role}\`) is not numeric; ` +
        "only numeric columns can carry the statistics.",
    );
  }

  return column;
}
