/**
 * The derived quantities of a one-sided t test.
 *
 * This is the statistics half of `plot_t_test()` in
 * `../compstatslib/R/t_statistic_plot.R`. R computes these while drawing,
 * scattered across `plot_t_test()`, `t_null_plot()`, `t_alt_lines()`, and
 * `plot_error_matrix()`; here they are one pure result that the plot layer
 * reads. Verified against R in `ttest.test.ts`.
 *
 * What the picture shows: a null distribution centred at 0 and an alternative
 * distribution centred at the t statistic the given difference produces. The
 * area of the null above the critical value is the significance level; the
 * area of the alternative above that same point is the power, and what falls
 * below it is beta.
 */

import { dt, pt, qt } from "./tdist";

/** The four numbers `plot_t_test()` takes, all optional as in R. */
export interface TTestOptions {
  /** The difference the alternative hypothesis claims. */
  readonly diff?: number;
  /** The population standard deviation. */
  readonly sd?: number;
  /** The sample size. */
  readonly n?: number;
  /** The significance level. */
  readonly alpha?: number;
}

/**
 * R's defaults from the `plot_t_test()` signature.
 *
 * These live here rather than in the plot layer so that the plot and
 * interactive layers read one set of numbers, and so that `tTestStats()` on
 * its own yields the classroom demo, matching R's no-argument behaviour.
 */
export const DEFAULT_T_TEST_OPTIONS = {
  diff: 0.5,
  sd: 4,
  n: 100,
  alpha: 0.05,
} as const;

/**
 * A span of the x axis to shade under a curve.
 *
 * `from` can be −Infinity. Once the difference is large enough, beta
 * underflows to exactly 0 and the shading starts at the quantile for 0, which
 * is unbounded — the whole alternative curve lies in the rejection region.
 * About one in thirty of the slider settings reaches this. The value is
 * honest and the plot layer must clamp it to the drawing window; R instead
 * hands the infinity to `seq()` and stops with an error, so this is one place
 * the port has to do better rather than follow.
 */
export interface FillRange {
  /** Where the shading starts. May be −Infinity; see above. */
  readonly from: number;
  /** Where the shading stops. R runs every fill out to the 0.999 quantile. */
  readonly to: number;
}

/**
 * The four cells of the error matrix, and which row R rings.
 *
 * The numbers here are raw. R prints two of the four through `round(x, 2)`
 * and the other two untouched: `plot_error_matrix()` writes `alpha` and
 * `1 - alpha` as they are, but `round(alt_stats[2], 2)` and
 * `round(alt_stats[1], 2)` for the power and beta cells. That asymmetry is
 * R's own. Rounding is a display concern, so it belongs to the plot layer;
 * this type carries full precision and lets the drawing decide.
 */
export interface TTestErrorMatrix {
  /** Top left: rejecting a true null. This is alpha. */
  readonly typeOne: number;
  /** Top right: rejecting a false null. This is the power. */
  readonly correctReject: number;
  /** Bottom left: keeping a true null. This is 1 − alpha. */
  readonly correctFailToReject: number;
  /** Bottom right: keeping a false null. This is beta. */
  readonly typeTwo: number;
  /**
   * Whether R rings the top row rather than the bottom one.
   *
   * R's test is `alt_stats[3] < alt_stats[4]`: the point where the alternative
   * fill begins, against the alternative's median. The fill begins at the
   * critical value, so this asks whether the critical value sits below the
   * median — that is, whether the test is more likely than not to reject. When
   * it is, the top row is the likely outcome and gets the ring.
   */
  readonly highlightTopRow: boolean;
}

/** Everything `plot_t_test()` derives before it draws anything. */
export interface TTestStats {
  /** The difference the statistics were computed from. */
  readonly diff: number;
  /** The standard deviation they were computed from. */
  readonly sd: number;
  /** The sample size they were computed from. */
  readonly n: number;
  /** The significance level they were computed from. */
  readonly alpha: number;
  /** Degrees of freedom, n − 1. */
  readonly df: number;
  /**
   * The t statistic, `diff / (sd / √n)`.
   *
   * This doubles as the non-centrality of the alternative distribution, which
   * is what makes the two curves in the picture the same shape shifted.
   */
  readonly t: number;
  /** Where the null distribution starts rejecting, `qt(1 − alpha, df)`. */
  readonly criticalValue: number;
  /** The chance of keeping a false null: the alternative below the critical value. */
  readonly beta: number;
  /** The chance of rejecting a false null, 1 − beta. */
  readonly power: number;
  /** The alternative distribution's midpoint, `qt(0.5, df, ncp)`. */
  readonly altMedian: number;
  /** The height of the alternative curve at its midpoint. */
  readonly altMedianDensity: number;
  /**
   * The shaded span under the alternative curve, the power.
   *
   * `from` is R's `alt_stats[3]`, `qt(beta, df, ncp)`. That inverts the beta
   * it was just built from, so it lands back on the critical value — but only
   * as closely as the two routines invert each other, which is why R's own
   * numbers differ in the last digits from `criticalValue`.
   */
  readonly altFill: FillRange;
  /**
   * The shaded span under the null curve, the significance level.
   *
   * `from` is the critical value, by the same expression.
   */
  readonly nullFill: FillRange;
  /** The four cells R draws beside the curves. */
  readonly errorMatrix: TTestErrorMatrix;
}

/** How far out R runs a fill. Both tails stop at the same quantile. */
const FILL_UPPER_QUANTILE = 0.999;

/**
 * Work out everything the picture needs from the four test parameters.
 *
 * A missing option takes R's default, so calling this with nothing yields the
 * same demo `plot_t_test()` does. Nothing is validated: a sample size of 1
 * leaves no degrees of freedom and the quantiles come back as NaN, which is
 * what R does too.
 *
 * @param options The test parameters. Any left out take R's defaults.
 * @returns The derived quantities. No drawing, no state.
 */
export function tTestStats(options: TTestOptions = {}): TTestStats {
  const { diff, sd, n, alpha } = { ...DEFAULT_T_TEST_OPTIONS, ...options };

  const df = n - 1;
  const t = diff / (sd / Math.sqrt(n));

  // The critical value belongs to the null curve, but beta measures the
  // alternative's mass below it. That shared point is what ties the picture
  // together.
  const criticalValue = qt(1 - alpha, df);
  const beta = pt(criticalValue, df, t);
  const power = 1 - beta;

  const altMedian = qt(0.5, df, t);

  // Where the alternative fill starts. R reads this back out of beta rather
  // than reusing the critical value, and uses the same number again for the
  // highlight test, so it is computed once here and shared.
  const altFillFrom = qt(beta, df, t);

  return {
    diff,
    sd,
    n,
    alpha,
    df,
    t,
    criticalValue,
    beta,
    power,
    altMedian,
    altMedianDensity: dt(altMedian, df, t),
    altFill: {
      from: altFillFrom,
      to: qt(FILL_UPPER_QUANTILE, df, t),
    },
    nullFill: {
      from: criticalValue,
      to: qt(FILL_UPPER_QUANTILE, df),
    },
    errorMatrix: {
      typeOne: alpha,
      correctReject: power,
      correctFailToReject: 1 - alpha,
      typeTwo: beta,
      highlightTopRow: altFillFrom < altMedian,
    },
  };
}
