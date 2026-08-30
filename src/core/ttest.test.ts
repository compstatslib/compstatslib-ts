/**
 * Tests for the derived quantities of a t test, the statistics half of
 * `plot_t_test()` in `../compstatslib/R/t_statistic_plot.R`.
 *
 * Every expected value below comes from R 4.5.3 at full double precision.
 * Source: `.claude/plans/001-PLAN-port/tdist-fixtures.md`, Section 3. Those values were not
 * re-derived by hand: the fixture run sourced the R package and called its own
 * `t_null_plot()` and `t_alt_lines()` on a null graphics device, so they come
 * off the same code path `plot_t_test()` runs.
 *
 * How the R code arrives at them, for reference while reading the fixtures:
 *
 * ```r
 * plot_t_test <- function(diff, sd, n, alpha, error_matrix) {
 *   df <- n - 1
 *   t <- diff / (sd / sqrt(n))
 *   t_null_plot(df, alpha)          # fills qt(c(1-alpha, 0.999), df)
 *   alt_stats <- t_alt_lines(df, t, alpha)
 * }
 * t_alt_lines <- function(df, ncp, alpha) {
 *   beta <- pt(qt(1-alpha, df=df), df=df, ncp=ncp)
 *   # plott() returns c(polyq[1], xquants), the start of the fill and the
 *   # 0.5 quantile, so the whole vector is:
 *   c(beta, 1-beta, qt(beta, df, ncp), qt(0.5, df, ncp))
 * }
 * ```
 */

import { describe, expect, test } from "bun:test";

import { DEFAULT_T_TEST_OPTIONS, tTestStats } from "./ttest";

/** Relative tolerance for all comparisons against R. */
const RELATIVE_TOLERANCE = 1e-12;

/** Assert that a value agrees with R to `RELATIVE_TOLERANCE`. */
function expectCloseToR(actual: number, expected: number): void {
  const bound = RELATIVE_TOLERANCE * Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(bound);
}

/** One R-computed parameter set and everything `plot_t_test()` derives. */
interface Fixture {
  readonly label: string;
  readonly diff: number;
  readonly sd: number;
  readonly n: number;
  readonly alpha: number;
  readonly df: number;
  readonly t: number;
  readonly criticalValue: number;
  readonly beta: number;
  readonly power: number;
  /** R's `alt_stats[3]`, `qt(beta, df, ncp)`, which starts the alt fill. */
  readonly altFillFrom: number;
  readonly altFillTo: number;
  readonly nullFillFrom: number;
  readonly nullFillTo: number;
  /** R's `alt_stats[4]`, `qt(0.5, df, ncp)`. */
  readonly altMedian: number;
  readonly altMedianDensity: number;
  readonly highlightTopRow: boolean;
  /** What R prints in the four cells, after its own display rounding. */
  readonly cellTypeOne: number;
  readonly cellCorrectReject: number;
  readonly cellCorrectFailToReject: number;
  readonly cellTypeTwo: number;
}

const fixtures: readonly Fixture[] = [
  {
    label: "diff=0.5, sd=4, n=100, alpha=0.05 (R's defaults)",
    diff: 0.5,
    sd: 4,
    n: 100,
    alpha: 0.05,
    df: 99,
    t: 1.25,
    criticalValue: 1.6603911560169906,
    beta: 0.65667149797936653,
    power: 0.34332850202063347,
    altFillFrom: 1.6603911560170026,
    altFillTo: 4.5025304802721777,
    nullFillFrom: 1.6603911560169906,
    nullFillTo: 3.1746038497557523,
    altMedian: 1.2531688434650867,
    altMedianDensity: 0.39636343716266997,
    highlightTopRow: false,
    cellTypeOne: 0.050000000000000003,
    cellCorrectReject: 0.34000000000000002,
    cellCorrectFailToReject: 0.94999999999999996,
    cellTypeTwo: 0.66000000000000003,
  },
  {
    label: "diff=2, sd=2, n=10, alpha=0.01",
    diff: 2,
    sd: 2,
    n: 10,
    alpha: 0.01,
    df: 9,
    t: 3.1622776601683791,
    criticalValue: 2.8214379250258075,
    beta: 0.36105139653921836,
    power: 0.63894860346078164,
    altFillFrom: 2.821437925025843,
    altFillTo: 11.045519629198941,
    nullFillFrom: 2.8214379250258075,
    nullFillTo: 4.296805662729918,
    altMedian: 3.2632120519013448,
    altMedianDensity: 0.30657627261883874,
    highlightTopRow: true,
    cellTypeOne: 0.01,
    cellCorrectReject: 0.64000000000000001,
    cellCorrectFailToReject: 0.98999999999999999,
    cellTypeTwo: 0.35999999999999999,
  },
  {
    label: "diff=0.1, sd=5, n=500, alpha=0.1",
    diff: 0.1,
    sd: 5,
    n: 500,
    alpha: 0.1,
    df: 499,
    t: 0.44721359549995798,
    criticalValue: 1.2832504230098851,
    beta: 0.79805835577702444,
    power: 0.20194164422297556,
    altFillFrom: 1.2832504230098465,
    altFillTo: 3.5587001866702792,
    nullFillFrom: 1.2832504230098851,
    nullFillTo: 3.1066446079462313,
    altMedian: 0.44743772139425175,
    altMedianDensity: 0.39870245147157007,
    highlightTopRow: false,
    cellTypeOne: 0.10000000000000001,
    cellCorrectReject: 0.20000000000000001,
    cellCorrectFailToReject: 0.90000000000000002,
    cellTypeTwo: 0.80000000000000004,
  },
  {
    label: "diff=0, sd=4, n=2, alpha=0.05 (degenerate: ncp = 0, n at the slider floor)",
    diff: 0,
    sd: 4,
    n: 2,
    alpha: 0.05,
    df: 1,
    t: 0,
    criticalValue: 6.3137515146750376,
    beta: 0.94999999999999996,
    power: 0.050000000000000044,
    altFillFrom: 6.3137515146750376,
    altFillTo: 318.30883898555015,
    nullFillFrom: 6.3137515146750376,
    nullFillTo: 318.30883898555015,
    altMedian: 0,
    altMedianDensity: 0.31830988618379069,
    highlightTopRow: false,
    cellTypeOne: 0.050000000000000003,
    cellCorrectReject: 0.050000000000000003,
    cellCorrectFailToReject: 0.94999999999999996,
    cellTypeTwo: 0.94999999999999996,
  },
];

describe("tTestStats", () => {
  for (const fixture of fixtures) {
    describe(fixture.label, () => {
      const options = {
        diff: fixture.diff,
        sd: fixture.sd,
        n: fixture.n,
        alpha: fixture.alpha,
      };

      test("carries the degrees of freedom", () => {
        expect(tTestStats(options).df).toBe(fixture.df);
      });

      test("matches the R t statistic", () => {
        expectCloseToR(tTestStats(options).t, fixture.t);
      });

      test("matches the R critical value", () => {
        expectCloseToR(tTestStats(options).criticalValue, fixture.criticalValue);
      });

      test("matches the R beta", () => {
        expectCloseToR(tTestStats(options).beta, fixture.beta);
      });

      test("matches the R power", () => {
        expectCloseToR(tTestStats(options).power, fixture.power);
      });

      test("matches the R alternative fill range", () => {
        const { altFill } = tTestStats(options);
        expectCloseToR(altFill.from, fixture.altFillFrom);
        expectCloseToR(altFill.to, fixture.altFillTo);
      });

      test("matches the R null fill range", () => {
        const { nullFill } = tTestStats(options);
        expectCloseToR(nullFill.from, fixture.nullFillFrom);
        expectCloseToR(nullFill.to, fixture.nullFillTo);
      });

      test("matches the R alternative median", () => {
        expectCloseToR(tTestStats(options).altMedian, fixture.altMedian);
      });

      test("matches the R density at the alternative median", () => {
        expectCloseToR(
          tTestStats(options).altMedianDensity,
          fixture.altMedianDensity,
        );
      });

      test("carries the raw error-matrix cells", () => {
        const { errorMatrix } = tTestStats(options);
        expectCloseToR(errorMatrix.typeOne, fixture.alpha);
        expectCloseToR(errorMatrix.correctReject, fixture.power);
        expectCloseToR(errorMatrix.correctFailToReject, 1 - fixture.alpha);
        expectCloseToR(errorMatrix.typeTwo, fixture.beta);
      });

      test("picks the row R highlights", () => {
        expect(tTestStats(options).errorMatrix.highlightTopRow).toBe(
          fixture.highlightTopRow,
        );
      });
    });
  }

  /**
   * R rounds only two of the four cells before printing them.
   *
   * `plot_error_matrix()` passes `alpha` and `1 - alpha` through untouched but
   * writes `round(alt_stats[2], 2)` and `round(alt_stats[1], 2)`. That
   * asymmetry is R's, not a tidy-up, and the plot layer has to reproduce it.
   * The raw numbers stay in `core/`; this pins what the display must make of
   * them.
   */
  test("R's display rounding turns the raw cells into its printed cells", () => {
    const roundToTwo = (value: number): number => Math.round(value * 100) / 100;
    for (const fixture of fixtures) {
      const { errorMatrix } = tTestStats({
        diff: fixture.diff,
        sd: fixture.sd,
        n: fixture.n,
        alpha: fixture.alpha,
      });
      expectCloseToR(errorMatrix.typeOne, fixture.cellTypeOne);
      expectCloseToR(errorMatrix.correctFailToReject, fixture.cellCorrectFailToReject);
      expectCloseToR(roundToTwo(errorMatrix.correctReject), fixture.cellCorrectReject);
      expectCloseToR(roundToTwo(errorMatrix.typeTwo), fixture.cellTypeTwo);
    }
  });

  describe("defaults", () => {
    test("matches the R signature defaults", () => {
      expect(DEFAULT_T_TEST_OPTIONS).toEqual({
        diff: 0.5,
        sd: 4,
        n: 100,
        alpha: 0.05,
      });
    });

    test("works with no arguments at all", () => {
      expect(tTestStats()).toEqual(
        tTestStats({ diff: 0.5, sd: 4, n: 100, alpha: 0.05 }),
      );
    });

    test("fills in only the options left out", () => {
      const stats = tTestStats({ n: 10 });
      expect(stats.n).toBe(10);
      expect(stats.diff).toBe(0.5);
      expect(stats.sd).toBe(4);
      expect(stats.alpha).toBe(0.05);
      expect(stats.df).toBe(9);
    });

    test("reports the options it used", () => {
      const stats = tTestStats({ diff: 2, sd: 2, n: 10, alpha: 0.01 });
      expect(stats.diff).toBe(2);
      expect(stats.sd).toBe(2);
      expect(stats.n).toBe(10);
      expect(stats.alpha).toBe(0.01);
    });
  });

  describe("the degenerate case with no difference", () => {
    const stats = tTestStats({ diff: 0, sd: 4, n: 2, alpha: 0.05 });

    test("has no non-centrality", () => {
      expect(stats.t).toBe(0);
    });

    test("gives beta as one minus alpha", () => {
      expectCloseToR(stats.beta, 1 - 0.05);
    });

    test("gives power as alpha", () => {
      expectCloseToR(stats.power, 0.05);
    });

    test("puts the alternative median at zero", () => {
      expect(stats.altMedian).toBe(0);
    });

    test("collapses the two fill ranges onto each other", () => {
      expectCloseToR(stats.altFill.from, stats.nullFill.from);
      expectCloseToR(stats.altFill.to, stats.nullFill.to);
    });
  });

  /**
   * A difference large enough to make the test certain.
   *
   * Beta underflows to exactly 0, so the alternative fill starts at the
   * quantile for 0 and runs from −Infinity: every part of the alternative
   * curve is in the rejection region. These settings are inside the slider
   * ranges, so the plot layer will meet them and has to clamp the shading to
   * its own window. R feeds the same infinity to `seq()` and stops with an
   * error.
   */
  test("reports an unbounded alternative fill when the power is total", () => {
    const stats = tTestStats({ diff: 4, sd: 1, n: 100, alpha: 0.1 });
    expect(stats.beta).toBe(0);
    expect(stats.power).toBe(1);
    expect(stats.altFill.from).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isFinite(stats.altFill.to)).toBe(true);
    expect(stats.errorMatrix.highlightTopRow).toBe(true);
  });

  describe("bad arguments", () => {
    test("reports NaN throughout when n leaves no degrees of freedom", () => {
      const stats = tTestStats({ n: 1 });
      expect(stats.df).toBe(0);
      expect(stats.criticalValue).toBeNaN();
      expect(stats.beta).toBeNaN();
      expect(stats.power).toBeNaN();
    });

    test("reports NaN throughout for a NaN option", () => {
      const stats = tTestStats({ diff: Number.NaN });
      expect(stats.t).toBeNaN();
      expect(stats.beta).toBeNaN();
    });
  });
});
