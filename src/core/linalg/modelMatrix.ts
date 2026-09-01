/**
 * R's `model.matrix()`: a data frame and a list of terms → the design
 * matrix, with the column names `lm()` gives its coefficients.
 *
 * R builds this from a formula. The port has no formulas (CLAUDE.md: the
 * canonical form is explicit column names in an options object), so a
 * model is a list of terms — a column name for a main effect, an array of
 * column names for an interaction — and the intercept is a flag. R's
 * `y ~ x * z + w` is `{ outcome: "y", terms: ["x", "z", "w", ["x", "z"]] }`.
 *
 * The columns come out in R's order, whatever order the terms were written
 * in: the intercept, then the terms by degree — every main effect before
 * every two-way interaction before every three-way — and within a degree in
 * the order given. A term written twice enters once. The `assign` vector is
 * R's: the index of the term each column came from, 0 for the intercept.
 *
 * Rows with a missing (non-finite) value in the outcome or in any column a
 * term names are dropped, R's `model.frame()` under `na.omit`; the indices
 * of the rows kept are returned, so a fit can pad its results back to the
 * input order (the `na.exclude` convention every fit in this package uses).
 * Only numeric columns can enter; R's factors and contrasts are out of
 * scope.
 */

import { frameRows, requireNumericColumn, type DataFrame } from "../frame.js";
import { make, type Matrix } from "./matrix.js";

/**
 * One term of a model: a column name for a main effect, or the column names
 * of an interaction, R's `a:b`.
 */
export type Term = string | readonly string[];

/** Which columns make the model. */
export interface ModelSpec {
  /**
   * The outcome column. It enters no design column, but a row missing it is
   * dropped, as `model.frame()` drops it. Optional here; `lm()` requires it.
   */
  readonly outcome?: string;
  /** The terms, in any order. R's order is restored. */
  readonly terms: readonly Term[];
  /** Whether to lead with a column of ones. True by default, R's `+ 1`. */
  readonly intercept?: boolean;
}

/** A design matrix and where its rows came from. */
export interface ModelMatrix {
  /**
   * The design, one row per complete data row, with the coefficient names
   * as column names: `(Intercept)`, the main effects, the interactions as
   * `a:b`.
   */
  readonly matrix: Matrix;
  /** The data rows the design holds, in input order. */
  readonly rows: readonly number[];
  /** R's `assign`: the term each column came from, 0 for the intercept. */
  readonly assign: readonly number[];
  /** R's `term.labels`: the terms in the order the columns follow. */
  readonly termLabels: readonly string[];
}

/**
 * Build the design matrix of a model, as R's `model.matrix()` does.
 *
 * @param data The frame holding every column the model names.
 * @param spec The outcome, the terms, and the intercept flag.
 * @returns The design, the rows it kept, and R's `assign` and term labels.
 * @throws RangeError If a named column is absent or not numeric (through
 *   `requireNumericColumn`, naming the option it arrived through), if the
 *   frame is ragged, or if an interaction term names no column.
 */
export function modelMatrix(data: DataFrame, spec: ModelSpec): ModelMatrix {
  const { outcome, intercept = true } = spec;
  const rowCount = frameRows(data);
  const terms = orderTerms(spec.terms);

  const columns = new Map<string, readonly number[]>();
  const read = (name: string, role: string): readonly number[] => {
    const held = columns.get(name);
    if (held !== undefined) {
      return held;
    }
    const column = requireNumericColumn(data, name, role);
    columns.set(name, column);
    return column;
  };
  if (outcome !== undefined) {
    read(outcome, "outcome");
  }
  terms.forEach((factors) => {
    factors.forEach((name) => read(name, "terms"));
  });

  // R's na.omit: a row with a missing value in any model column leaves.
  // NaN is this library's missing value, and an infinity would poison the
  // fit the same way, so "complete" means finite everywhere.
  const involved = [...columns.values()];
  const rows = Array.from({ length: rowCount }, (_, row) => row).filter((row) =>
    involved.every((column) => Number.isFinite(column[row])),
  );

  const termColumns = terms.map((factors) =>
    rows.map((row) =>
      factors.reduce((product, name) => product * ((columns.get(name) as readonly number[])[row] as number), 1),
    ),
  );
  const design = intercept ? [rows.map(() => 1), ...termColumns] : termColumns;
  const names = [
    ...(intercept ? ["(Intercept)"] : []),
    ...terms.map((factors) => factors.join(":")),
  ];
  const assign = [
    ...(intercept ? [0] : []),
    ...terms.map((_, index) => index + 1),
  ];

  const n = rows.length;
  const p = design.length;
  const buffer = new Float64Array(n * p);
  design.forEach((column, j) => {
    buffer.set(column, j * n);
  });

  return {
    matrix: make(n, p, buffer, p === 0 ? null : [null, names]),
    rows,
    assign,
    termLabels: names.slice(intercept ? 1 : 0),
  };
}

/**
 * Normalize the terms to arrays of column names, drop repeats, and put them
 * in R's order: by degree, then as written.
 *
 * @throws RangeError If a term names no column.
 */
function orderTerms(terms: readonly Term[]): readonly (readonly string[])[] {
  const seen = new Set<string>();
  const unique: (readonly string[])[] = [];
  terms.forEach((term) => {
    const factors = typeof term === "string" ? [term] : term;
    if (factors.length === 0) {
      throw new RangeError("an interaction term needs at least one column name");
    }
    // R treats `a:b` and `b:a` as one term; the first spelling wins.
    const key = [...factors].sort().join("\u0000");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(factors);
    }
  });
  // A stable sort by degree keeps the written order within a degree, as R's
  // terms() does.
  return unique
    .map((factors, index) => ({ factors, index }))
    .sort((a, b) => a.factors.length - b.factors.length || a.index - b.index)
    .map(({ factors }) => factors);
}
