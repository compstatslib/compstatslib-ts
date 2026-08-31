/**
 * R's `lm()` over a data frame, with what `summary.lm()` reads off the fit.
 *
 * `lm()` is `model.matrix()` followed by `lm.fit()`, and `lm.fit()` is
 * `dqrls`: the `qr()` of `qr.ts` — LINPACK's `dqrdc2` with its limited
 * column pivoting — followed by `dqrsl`'s coefficients and residuals, with
 * the fitted values as `y` minus the residuals. The port runs that same
 * arithmetic, so the coefficients, fitted values and residuals pin bit for
 * bit against R. The summary statistics — R², adjusted R², σ, the standard
 * errors and the t and p values — follow `summary.lm()`'s formulas but not
 * its rounding step for step (`chol2inv` and `pt`), and are verified at a
 * stated tolerance. See `lm.test.ts`.
 *
 * Coefficients come back as a `NamedVector` in R's order, `null` where R
 * reports `NA` for an aliased column. Fitted values and residuals are padded
 * with NaN to the input length where a row was dropped for a missing value,
 * R's `na.exclude`, which is the convention every fit in this package uses.
 */

import { mean, sum, zipWith } from "../arith";
import type { DataFrame } from "../frame";
import { pt } from "../tdist";
import { modelMatrix, type ModelSpec } from "./modelMatrix";
import { namedVector, type NamedVector } from "./namedVector";
import { DEFAULT_QR_TOLERANCE, qr, qrCoef, qrResid, type QrDecomposition } from "./qr";
import type { Vector } from "./vector";

/** The model, with the outcome required, and the rank tolerance. */
export interface LmOptions extends ModelSpec {
  /** The column to fit. */
  readonly outcome: string;
  /** How far a column's norm may collapse before it is aliased. R's `lm.fit()` default. */
  readonly tolerance?: number;
  /**
   * The arithmetic of the factorization, passed straight to `qr()`:
   * `{ fma: false }` trades the pinned last bits for throughput.
   */
  readonly fma?: boolean;
}

/** R's `summary(fit)$fstatistic`. */
export interface FStatistic {
  readonly value: number;
  readonly numdf: number;
  readonly dendf: number;
}

/** A fitted linear model and its summary. */
export interface LmFit {
  /** `coef(fit)`: one entry per design column, null where R reports `NA`. */
  readonly coefficients: NamedVector;
  /** `coef(summary(fit))[, "Std. Error"]`, null for an aliased term. */
  readonly standardErrors: NamedVector;
  /** `coef(summary(fit))[, "t value"]`, null for an aliased term. */
  readonly tValues: NamedVector;
  /** `coef(summary(fit))[, "Pr(>|t|)"]`, null for an aliased term. */
  readonly pValues: NamedVector;
  /** The fitted outcome of each data row, in input order; NaN for a row dropped. */
  readonly fitted: Vector;
  /** The outcome minus the fit, in input order; NaN for a row dropped. */
  readonly residuals: Vector;
  /** The number of columns the fit could identify. */
  readonly rank: number;
  /** `fit$df.residual`: rows fitted minus rank. */
  readonly dfResidual: number;
  /** `summary(fit)$r.squared`. */
  readonly rSquared: number;
  /** `summary(fit)$adj.r.squared`. */
  readonly adjRSquared: number;
  /** `summary(fit)$sigma`: the residual standard error. */
  readonly sigma: number;
  /** `summary(fit)$fstatistic`, or null when the model has no term beyond the intercept. */
  readonly fStatistic: FStatistic | null;
  /** The data rows the fit used, in input order. */
  readonly rows: readonly number[];
  /** R's `term.labels`. */
  readonly termLabels: readonly string[];
}

/**
 * Fit a linear model, as R's `lm()` does.
 *
 * @param data The frame holding every column the model names.
 * @param options The outcome, the terms, the intercept flag, the rank
 *   tolerance, and the arithmetic.
 * @returns The fit and its summary.
 * @throws RangeError If a named column is absent or not numeric, if the
 *   frame is ragged, or if no row is complete — R's "0 (non-NA) cases".
 * @throws TypeError If `fma` is not a boolean. `qr()` refuses it.
 */
export function lm(data: DataFrame, options: LmOptions): LmFit {
  const {
    outcome,
    intercept = true,
    tolerance = DEFAULT_QR_TOLERANCE,
    fma,
  } = options;
  const design = modelMatrix(data, options);
  const { rows } = design;
  const n = rows.length;
  if (n === 0) {
    throw new RangeError("0 (non-NA) cases");
  }
  // modelMatrix has already checked the outcome column.
  const outcomeColumn = data[outcome] as Vector;
  const y = rows.map((row) => outcomeColumn[row] as number);

  const factored = qr(design.matrix, { tolerance, fma });
  const coefficients = qrCoef(factored, y);
  const residuals = qrResid(factored, y);
  const fitted = zipWith(y, residuals, (value, residual) => value - residual);
  const names = design.matrix.dimnames?.[1] ?? [];

  const { rank } = factored;
  const dfResidual = n - rank;
  const interceptCount = intercept ? 1 : 0;
  const rss = sum(residuals.map((r) => r * r));
  const centered = intercept ? mean(fitted) : 0;
  const mss = sum(fitted.map((f) => (f - centered) * (f - centered)));
  const resvar = rss / dfResidual;
  const numdf = rank - interceptCount;
  // summary.lm() reports 0 for both when nothing beyond the intercept was
  // fitted, rather than the rounding noise the formula would give.
  const rSquared = numdf > 0 ? mss / (mss + rss) : 0;
  const adjRSquared =
    numdf > 0 ? 1 - (1 - rSquared) * ((n - interceptCount) / dfResidual) : 0;

  const standardErrors = standardErrorsOf(factored, resvar, names.length);
  const tValues = zipWith(coefficients, standardErrors, (b, se) =>
    b === null || se === null ? null : b / se,
  );
  const pValues = tValues.map((tv) =>
    tv === null ? null : 2 * pt(-Math.abs(tv), dfResidual),
  );

  return {
    coefficients: namedVector(names, coefficients),
    standardErrors: namedVector(names, standardErrors),
    tValues: namedVector(names, tValues),
    pValues: namedVector(names, pValues),
    fitted: padded(fitted, rows, outcomeColumn.length),
    residuals: padded(residuals, rows, outcomeColumn.length),
    rank,
    dfResidual,
    rSquared,
    adjRSquared,
    sigma: Math.sqrt(resvar),
    fStatistic:
      numdf > 0 ? { value: mss / numdf / resvar, numdf, dendf: dfResidual } : null,
    rows,
    termLabels: design.termLabels,
  };
}

/**
 * The standard errors, `summary.lm()`'s `sqrt(diag(chol2inv(R)) * resvar)`
 * over the leading `rank` columns of the factorization, placed back in the
 * original column order; null for an aliased column.
 *
 * `chol2inv(R)` is `(RᵀR)⁻¹ = R⁻¹ R⁻ᵀ`, whose diagonal is the sum of
 * squares of each row of `R⁻¹`. `R⁻¹` comes from back substitution against
 * the identity.
 */
function standardErrorsOf(
  factored: QrDecomposition,
  resvar: number,
  width: number,
): (number | null)[] {
  const { rank, pivot } = factored;
  const { nrow } = factored.qr;
  const r = (i: number, j: number): number => factored.qr.data[j * nrow + i] as number;

  // Column k of R⁻¹ solves R x = e_k; the entries above row k are the only
  // ones that can be non-zero.
  const inverse = Array.from({ length: rank }, (_, k) => {
    const x = new Array<number>(rank).fill(0);
    x[k] = 1 / r(k, k);
    for (let i = k - 1; i >= 0; i--) {
      let total = 0;
      for (let j = i + 1; j <= k; j++) {
        total += r(i, j) * (x[j] as number);
      }
      x[i] = -total / r(i, i);
    }
    return x;
  });
  const diagonal = Array.from({ length: rank }, (_, i) =>
    sum(inverse.map((columnOfInverse) => (columnOfInverse[i] as number) ** 2)),
  );

  const errors = new Array<number | null>(width).fill(null);
  pivot.slice(0, rank).forEach((original, position) => {
    errors[original] = Math.sqrt((diagonal[position] as number) * resvar);
  });
  return errors;
}

/** Spread values fitted on `rows` back over `length` slots, NaN elsewhere. */
function padded(values: Vector, rows: readonly number[], length: number): number[] {
  const out = new Array<number>(length).fill(Number.NaN);
  rows.forEach((row, index) => {
    out[row] = values[index] as number;
  });
  return out;
}
