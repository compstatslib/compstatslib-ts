/**
 * The fitted surface of a moderated regression.
 *
 * This is the statistics half of `plot_moderation_3d()` in the R package,
 * which fits `lm(formula, data)`, predicts over a 15 by 15 grid of the IV and
 * the moderator, and hands the grid to `lattice::wireframe()`. Verified
 * against R in `moderation.test.ts`.
 *
 * Four things are worth knowing before reading the code.
 *
 * **Columns, not a formula.** R names the model with `y ~ x * z`. TypeScript
 * has no such notation, so the model arrives as column names, per CLAUDE.md:
 * an outcome, an IV, a moderator, an optional list of controls, and a flag
 * for the interaction. The three models the fixtures pin are
 * `{outcome: "y", iv: "x", mod: "z"}` (R's `y ~ x * z`), the same with
 * `interaction: false` (`y ~ x + z`), and the same with `controls: ["w"]`
 * (`y ~ x + z + w + x:z`).
 *
 * **The design follows R's model matrix, not the option order.** R's
 * `model.matrix` puts every main effect before any interaction, whatever
 * order the formula was typed in, so `y ~ x + z + w + x:z` gives the columns
 * `(Intercept), x, z, w, x:z`. This module builds them in that order, which
 * is what lets a caller read the coefficients next to R's.
 *
 * **Controls are held at their mean, and only numbers are accepted.** R's
 * `hold_value()` also handles factors (first level), characters (first in
 * sort order) and logicals (always FALSE). The bundled data has no such
 * column and no doc example uses one, so this port supports the numeric
 * branch alone and refuses the rest, rather than shipping three rules nothing
 * exercises. The other rules are recorded in
 * `.claude/plans/moderation-fixtures.md` section 4 if they are ever wanted.
 *
 * **Missing values are not handled anywhere.** R's `lm()` drops incomplete
 * rows through `na.omit` and R's `hold_value()` averages with `na.rm = TRUE`.
 * This port does neither: a `NaN` in a column travels through the fit and the
 * surface. One rule everywhere is easier to reason about than a fit on 198
 * rows whose controls were held at the mean of 199.
 */

import { extent, mean, sum, zipWith } from "./arith";
import { frameRows, requireNumericColumn, type DataFrame } from "./frame";
import { leastSquares } from "./ols";

/**
 * The number of steps along each axis of the grid. R's
 * `plot_moderation_3d()` hardcodes `length.out = 15` for both.
 */
const GRID_STEPS = 15;

/** Which columns make the model. */
export interface ModerationOptions {
  /** The column to predict — the vertical axis of the surface. */
  readonly outcome: string;
  /** The predictor on the first horizontal axis. */
  readonly iv: string;
  /** The predictor on the second horizontal axis. */
  readonly mod: string;
  /**
   * Whether the model carries the IV by moderator product. True by default,
   * which is R's `y ~ x * z`. False gives R's additive `y ~ x + z`, whose
   * surface is a plane with no twist.
   */
  readonly interaction?: boolean;
  /**
   * Further predictors to fit but not to plot. Each is held at its own mean
   * over the grid, R's `hold_value()` for a numeric column. Empty by default.
   */
  readonly controls?: readonly string[];
}

/** One fitted term, named as R names it. */
export interface ModerationTerm {
  /**
   * R's coefficient name: `(Intercept)`, a column name, or `iv:mod` for the
   * product term.
   */
  readonly name: string;
  /**
   * The coefficient, or null where R reports `NA` — a column the fit could
   * not tell apart from the columns before it.
   */
  readonly value: number | null;
}

/** A fitted model and the surface it predicts. */
export interface ModerationSurface {
  /** The fitted terms, in R's model-matrix order. */
  readonly coefficients: readonly ModerationTerm[];
  /**
   * The fitted outcome of each data row, in input order. NaN where the row
   * was dropped for a missing value, as R's `na.exclude` pads.
   */
  readonly fitted: readonly number[];
  /**
   * The outcome minus the fit, of each data row, in input order. NaN where
   * the row was dropped for a missing value.
   */
  readonly residuals: readonly number[];
  /** The 15 IV values of the grid, from the column's minimum to its maximum. */
  readonly ivValues: readonly number[];
  /** The 15 moderator values of the grid, over the same span. */
  readonly modValues: readonly number[];
  /**
   * The 225 predicted outcomes, **with the IV varying fastest**: index
   * `j * 15 + i` holds the prediction at `ivValues[i]` and `modValues[j]`.
   * This is the row order of R's `expand.grid(seq_iv, seq_mod)`.
   */
  readonly predictions: readonly number[];
  /**
   * The vertical range to draw, as `[low, high]`: the range of the observed
   * outcome together with the range of the surface. Which of the two reaches
   * further depends on the model — an interaction usually swings the surface
   * past the data at the corners of the grid, while a plane stays inside it.
   */
  readonly zlim: readonly [number, number];
  /** The value each control is held at over the grid: its mean. */
  readonly holds: Readonly<Record<string, number>>;
}

/**
 * Fit the model and predict its surface.
 *
 * Rows with a missing (non-finite) value in any model column are dropped
 * before fitting, R's `na.action = na.omit`; their fitted values and
 * residuals report NaN, keeping input order. The grid and zlim span the
 * finite values of their columns, and a control is held at its finite mean —
 * R's `hold_value()` with `na.rm = TRUE`. (R itself computes zlim with no
 * `na.rm` and fails on a missing outcome; the port draws what it can fit, a
 * stated departure.)
 *
 * @param data The frame holding every column the options name.
 * @param options Which column plays which part in the model.
 * @returns The fit, the grid, the surface, and the vertical range.
 * @throws RangeError If a named column is absent, empty, or not numeric, if
 *   the IV and the moderator are the same column, if a control repeats
 *   another named column, if the frame is ragged, or if no row is complete.
 */
export function moderationSurface(
  data: DataFrame,
  options: ModerationOptions,
): ModerationSurface {
  const { outcome, iv, mod, interaction = true, controls = [] } = options;

  if (iv === mod) {
    throw new RangeError(
      `\`iv\` and \`mod\` must name different columns, both name "${iv}"`,
    );
  }
  // A repeated column would enter the design twice and alias itself, and the
  // caller would read a null coefficient with no clue why.
  const named = new Set([outcome, iv, mod]);
  controls.forEach((control) => {
    if (named.has(control)) {
      throw new RangeError(
        `control "${control}" already names the outcome, the iv, the mod, ` +
          "or another control",
      );
    }
    named.add(control);
  });

  const rows = frameRows(data);
  const y = requireNumericColumn(data, outcome, "outcome");
  const ivColumn = requireNumericColumn(data, iv, "iv");
  const modColumn = requireNumericColumn(data, mod, "mod");
  const controlColumns = controls.map((control) =>
    requireNumericColumn(data, control, "controls"),
  );

  // R's na.omit: a row with a missing value in any model column leaves the
  // fit. NaN is this library's missing value, and an infinity would poison
  // the fit the same way, so "complete" means finite everywhere.
  const modelColumns = [y, ivColumn, modColumn, ...controlColumns];
  const completeRows = y
    .map((_, row) => row)
    .filter((row) =>
      modelColumns.every((column) => Number.isFinite(column[row])),
    );
  if (completeRows.length === 0) {
    throw new RangeError(
      "the model has no complete rows: every row is missing a value in " +
        "the outcome, the IV, the moderator, or a control",
    );
  }

  // R's model.matrix order: the intercept, the main effects in the order the
  // model names them, then the interaction.
  const designColumns: readonly {
    readonly name: string;
    readonly values: readonly number[];
  }[] = [
    { name: "(Intercept)", values: new Array<number>(rows).fill(1) },
    { name: iv, values: ivColumn },
    { name: mod, values: modColumn },
    ...controls.map((control, index) => ({
      name: control,
      values: controlColumns[index] as readonly number[],
    })),
    ...(interaction
      ? [
          {
            name: `${iv}:${mod}`,
            values: zipWith(ivColumn, modColumn, (a, b) => a * b),
          },
        ]
      : []),
  ];

  const design = completeRows.map((row) =>
    designColumns.map((column) => column.values[row] as number),
  );
  const fit = leastSquares(
    design,
    completeRows.map((row) => y[row] as number),
  );
  const coefficients = designColumns.map((column, index) => ({
    name: column.name,
    value: fit.coefficients[index] ?? null,
  }));

  // R's na.exclude padding: report the fit in input order, NaN where a row
  // was dropped.
  const fitted = new Array<number>(rows).fill(Number.NaN);
  const residuals = new Array<number>(rows).fill(Number.NaN);
  completeRows.forEach((row, survivor) => {
    fitted[row] = fit.fitted[survivor] as number;
    residuals[row] = fit.residuals[survivor] as number;
  });

  // extent() ignores non-finite values, so each axis spans its column's
  // finite range — R's seq over min and max, which R only reaches when the
  // column has no NA. The hold is R's hold_value(): mean with na.rm = TRUE.
  const ivValues = rSeq(...extent(ivColumn), GRID_STEPS);
  const modValues = rSeq(...extent(modColumn), GRID_STEPS);
  const holds = Object.fromEntries(
    controls.map((control, index) => [
      control,
      mean(
        (controlColumns[index] as readonly number[]).filter(Number.isFinite),
      ),
    ]),
  );

  // R's predict() drops an aliased term rather than giving up on the row, so
  // a null coefficient contributes nothing here either.
  const weights = coefficients.map((term) => term.value ?? 0);
  const predictions = modValues.flatMap((modValue) =>
    ivValues.map((ivValue) => {
      const gridRow = [
        1,
        ivValue,
        modValue,
        ...controls.map((control) => holds[control] as number),
        ...(interaction ? [ivValue * modValue] : []),
      ];
      return sum(zipWith(gridRow, weights, (value, weight) => value * weight));
    }),
  );

  const [dataLow, dataHigh] = extent(y);
  const [surfaceLow, surfaceHigh] = extent(predictions);

  return {
    coefficients,
    fitted,
    residuals,
    ivValues,
    modValues,
    predictions,
    zlim: [Math.min(dataLow, surfaceLow), Math.max(dataHigh, surfaceHigh)],
    holds,
  };
}

/**
 * Step from one end of a span to the other, the way R's
 * `seq(from, to, length.out = n)` does.
 *
 * R computes `from + i * by` in plain double arithmetic and writes both
 * endpoints in exactly. That last part matters — it is why the grid always
 * reaches the data's own minimum and maximum — and so does the plain
 * arithmetic: rounding the product and the sum together, as `pretty.ts` must
 * for R's other sequence path, moves 14 of the 30 grid coordinates of the
 * bundled dataset off R's values.
 *
 * @param from The first value.
 * @param to The last value.
 * @param length How many values to return.
 * @returns The sequence. A span of no width repeats its one value, as R's
 *   `seq(3, 3, length.out = 15)` does.
 */
function rSeq(from: number, to: number, length: number): number[] {
  if (from === to) {
    return new Array<number>(length).fill(from);
  }

  const by = (to - from) / (length - 1);
  return Array.from({ length }, (_, index) =>
    index === 0 ? from : index === length - 1 ? to : from + index * by,
  );
}
