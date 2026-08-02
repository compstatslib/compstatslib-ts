/**
 * Tests for the linear-regression core, ported from `plot_regression()` in
 * `../compstatslib/R/regression_plot.R`.
 *
 * Every expected value below comes from R 4.5.3, printed at full double
 * precision with `sprintf("%.17g", x)`. Do not edit these numbers by hand.
 * Source: `.claude/plans/regression-fixtures.md`.
 *
 * R script that produced the values:
 *
 * ```r
 * ## Compute R-verified expected values for linear-regression test fixtures.
 *
 * fmt <- function(x) sprintf("%.17g", x)
 *
 * report_fixture <- function(label, x, y) {
 *   cat("\n==== ", label, " ====\n", sep = "")
 *   regr <- lm(y ~ x)
 *   co <- coef(regr)
 *   intercept <- co[["(Intercept)"]]
 *   slope <- co[["x"]]
 *   correlation <- cor(x, y)
 *   fitted <- regr$fitted.values
 *   ssr <- sum((fitted - mean(y))^2)
 *   sse <- sum((y - fitted)^2)
 *   sst <- sum((y - mean(y))^2)
 *   r2 <- summary(regr)$r.squared
 *
 *   cat("intercept:", fmt(intercept), "\n")
 *   cat("slope:", fmt(slope), "\n")
 *   cat("cor(x, y):", fmt(correlation), "\n")
 *   cat("fitted.values:\n")
 *   print(fmt(fitted))
 *   cat("SSR:", fmt(ssr), "\n")
 *   cat("SSE:", fmt(sse), "\n")
 *   cat("SST:", fmt(sst), "\n")
 *   cat("R-squared:", fmt(r2), "\n")
 * }
 *
 * ## Fixture A: R docs example
 * xA <- c(1, 3, 5, 8)
 * yA <- c(2, 4, 6, 8)
 * report_fixture("Fixture A", xA, yA)
 *
 * ## Fixture B: noisy data
 * xB <- 1:10
 * yB <- c(3.2, 1.8, 6.5, 4.9, 8.1, 6.0, 10.3, 8.7, 12.2, 9.5)
 * report_fixture("Fixture B", xB, yB)
 *
 * ## ---- Edge cases ----
 * cat("\n==== Edge case: lm with a single point (n = 1) ====\n")
 * x1 <- c(2)
 * y1 <- c(5)
 * regr1 <- tryCatch(lm(y1 ~ x1), error = function(e) e, warning = function(w) w)
 * print(regr1)
 * if (inherits(regr1, "lm")) {
 *   cat("coef:\n")
 *   print(coef(regr1))
 *   cat("fitted.values:\n")
 *   print(regr1$fitted.values)
 *   cat("residuals:\n")
 *   print(regr1$residuals)
 *   s <- tryCatch(summary(regr1), error = function(e) e, warning = function(w) w)
 *   print(s)
 * }
 *
 * cat("\n==== Edge case: cor() when all x values are identical ====\n")
 * xc <- c(4, 4, 4, 4)
 * yc <- c(1, 2, 3, 4)
 * corc <- tryCatch(cor(xc, yc), error = function(e) e, warning = function(w) w)
 * print(corc)
 *
 * regrc <- tryCatch(lm(yc ~ xc), error = function(e) e, warning = function(w) w)
 * cat("lm with constant x:\n")
 * print(regrc)
 * ```
 *
 * Fixture A — `x = c(1, 3, 5, 8)`, `y = c(2, 4, 6, 8)`:
 *
 *   intercept    1.3457943925233646
 *   slope        0.85981308411214952
 *   cor(x, y)    0.994376712684369
 *   SSR          19.775700934579433
 *   SSE          0.22429906542056008
 *   SST          20
 *   R-squared    0.98878504672897205
 *   fitted       2.2056074766355138, 3.9252336448598135,
 *                5.6448598130841123, 8.2242990654205599
 *
 * Fixture B — `x = 1:10`,
 * `y = c(3.2, 1.8, 6.5, 4.9, 8.1, 6.0, 10.3, 8.7, 12.2, 9.5)`:
 *
 *   intercept    1.9666666666666663
 *   slope        0.93696969696969701
 *   cor(x, y)    0.87188812319213727
 *   SSR          72.427757575757568
 *   SSE          22.848242424242422
 *   SST          95.275999999999996
 *   R-squared    0.76018889936350797
 *   fitted       2.9036363636363642, 3.8406060606060608, 4.7775757575757574,
 *                5.7145454545454539, 6.6515151515151514, 7.5884848484848479,
 *                8.5254545454545454, 9.4624242424242428, 10.39939393939394,
 *                11.336363636363636
 *
 * R edge-case behavior that the degenerate tests mirror:
 *
 * - n = 1: `lm()` fits an intercept equal to the single y value and reports
 *   the slope as `NA` ("1 not defined because of singularities"). The fitted
 *   value equals y and the residual is 0. `summary()` reports `NaN` for the
 *   standard error, the t value, and R-squared.
 * - Constant x: `cor(x, y)` returns `NA` with the warning "the standard
 *   deviation is zero". `lm()` fits an intercept-only model, with the
 *   intercept equal to `mean(y)` and the slope `NA`.
 *
 * This port represents R's `NA` as `null`, because strict TypeScript then
 * makes a caller handle the undefined case. See `regression.ts`.
 */

import { describe, expect, test } from "bun:test";

import { linearRegression, type Point } from "./regression";

/**
 * Relative tolerance for all comparisons against R.
 *
 * R fits with a QR decomposition and this port uses the sums-of-squares
 * formulas. The two agree to a few units in the last place, so 1e-12 relative
 * is many orders of magnitude tighter than any real disagreement, and still
 * catches a wrong formula.
 */
const RELATIVE_TOLERANCE = 1e-12;

/** Assert that a value agrees with R to `RELATIVE_TOLERANCE`. */
function expectCloseToR(actual: number | null, expected: number): void {
  expect(actual).not.toBeNull();
  const tolerance = RELATIVE_TOLERANCE * Math.max(1, Math.abs(expected));
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(
    tolerance,
  );
}

function pointsFrom(xs: readonly number[], ys: readonly number[]): Point[] {
  return xs.map((x, index) => ({ x, y: ys[index] as number }));
}

interface Fixture {
  readonly label: string;
  readonly points: Point[];
  readonly intercept: number;
  readonly slope: number;
  readonly correlation: number;
  readonly ssr: number;
  readonly sse: number;
  readonly sst: number;
  readonly rSquared: number;
  readonly fitted: readonly number[];
}

const fixtureA: Fixture = {
  label: "fixture A (R docs example)",
  points: pointsFrom([1, 3, 5, 8], [2, 4, 6, 8]),
  intercept: 1.3457943925233646,
  slope: 0.85981308411214952,
  correlation: 0.994376712684369,
  ssr: 19.775700934579433,
  sse: 0.22429906542056008,
  sst: 20,
  rSquared: 0.98878504672897205,
  fitted: [
    2.2056074766355138, 3.9252336448598135, 5.6448598130841123,
    8.2242990654205599,
  ],
};

const fixtureB: Fixture = {
  label: "fixture B (noisy)",
  points: pointsFrom(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [3.2, 1.8, 6.5, 4.9, 8.1, 6.0, 10.3, 8.7, 12.2, 9.5],
  ),
  intercept: 1.9666666666666663,
  slope: 0.93696969696969701,
  correlation: 0.87188812319213727,
  ssr: 72.427757575757568,
  sse: 22.848242424242422,
  sst: 95.275999999999996,
  rSquared: 0.76018889936350797,
  fitted: [
    2.9036363636363642, 3.8406060606060608, 4.7775757575757574,
    5.7145454545454539, 6.6515151515151514, 7.5884848484848479,
    8.5254545454545454, 9.4624242424242428, 10.39939393939394,
    11.336363636363636,
  ],
};

describe("linearRegression", () => {
  for (const fixture of [fixtureA, fixtureB]) {
    describe(fixture.label, () => {
      test("matches the R slope", () => {
        expectCloseToR(linearRegression(fixture.points)?.slope ?? null, fixture.slope);
      });

      test("matches the R intercept", () => {
        expectCloseToR(
          linearRegression(fixture.points)?.intercept ?? null,
          fixture.intercept,
        );
      });

      test("matches the R correlation", () => {
        expectCloseToR(
          linearRegression(fixture.points)?.correlation ?? null,
          fixture.correlation,
        );
      });

      test("matches the R SSR", () => {
        expectCloseToR(linearRegression(fixture.points)?.ssr ?? null, fixture.ssr);
      });

      test("matches the R SSE", () => {
        expectCloseToR(linearRegression(fixture.points)?.sse ?? null, fixture.sse);
      });

      test("matches the R SST", () => {
        expectCloseToR(linearRegression(fixture.points)?.sst ?? null, fixture.sst);
      });

      test("matches the R R-squared", () => {
        expectCloseToR(
          linearRegression(fixture.points)?.rSquared ?? null,
          fixture.rSquared,
        );
      });

      test("matches the R fitted values, in input order", () => {
        const fit = linearRegression(fixture.points);
        expect(fit).not.toBeNull();
        const fitted = fit?.fitted ?? [];
        expect(fitted).toHaveLength(fixture.fitted.length);
        for (const [index, expected] of fixture.fitted.entries()) {
          expectCloseToR(fitted[index] ?? null, expected);
        }
      });
    });
  }

  describe("zero points", () => {
    // R's plot_regression() returns early for an empty frame. There is no y value to
    // report, so this port reports no fit at all.
    test("returns null", () => {
      expect(linearRegression([])).toBeNull();
    });
  });

  describe("one point", () => {
    // R: lm(c(5) ~ c(2)) gives intercept 5, slope NA, fitted 5, residual 0.
    const single: Point[] = [{ x: 2, y: 5 }];

    test("sets the intercept to the y value", () => {
      expect(linearRegression(single)?.intercept).toBe(5);
    });

    test("reports no slope", () => {
      expect(linearRegression(single)?.slope).toBeNull();
    });

    test("reports no correlation", () => {
      expect(linearRegression(single)?.correlation).toBeNull();
    });

    test("fits the point exactly", () => {
      expect(linearRegression(single)?.fitted).toEqual([5]);
    });

    test("has no variation to decompose", () => {
      const fit = linearRegression(single);
      expect(fit?.ssr).toBe(0);
      expect(fit?.sse).toBe(0);
      expect(fit?.sst).toBe(0);
    });

    test("reports no R-squared", () => {
      // R's summary() gives NaN here, because SST is 0.
      expect(linearRegression(single)?.rSquared).toBeNull();
    });
  });

  describe("constant x", () => {
    // R: cor() is NA and lm() fits an intercept-only model at mean(y) = 2.5.
    const constantX: Point[] = pointsFrom([4, 4, 4, 4], [1, 2, 3, 4]);

    test("reports no correlation", () => {
      expect(linearRegression(constantX)?.correlation).toBeNull();
    });

    test("reports no slope", () => {
      expect(linearRegression(constantX)?.slope).toBeNull();
    });

    test("sets the intercept to the mean of y", () => {
      expect(linearRegression(constantX)?.intercept).toBe(2.5);
    });

    test("fits every point at the mean of y", () => {
      expect(linearRegression(constantX)?.fitted).toEqual([2.5, 2.5, 2.5, 2.5]);
    });

    test("explains none of the total variation", () => {
      const fit = linearRegression(constantX);
      expect(fit?.ssr).toBe(0);
      expect(fit?.sse).toBe(5);
      expect(fit?.sst).toBe(5);
      expect(fit?.rSquared).toBe(0);
    });
  });

  describe("constant y", () => {
    // R-verified (see "Constant y" in the fixtures document): lm() is not
    // singular here and gives slope exactly 0 with intercept 7. cor() is NA
    // because the standard deviation of y is zero. summary()$r.squared is
    // NaN; this port reports null when SST is 0.
    const constantY: Point[] = pointsFrom([1, 2, 3, 4], [7, 7, 7, 7]);

    test("reports no correlation", () => {
      expect(linearRegression(constantY)?.correlation).toBeNull();
    });

    test("fits a flat line at the y value", () => {
      const fit = linearRegression(constantY);
      expect(fit?.slope).toBe(0);
      expect(fit?.intercept).toBe(7);
      expect(fit?.fitted).toEqual([7, 7, 7, 7]);
    });

    test("reports no R-squared", () => {
      expect(linearRegression(constantY)?.rSquared).toBeNull();
    });
  });

  describe("purity", () => {
    test("does not mutate the input points", () => {
      const points = pointsFrom([1, 3, 5, 8], [2, 4, 6, 8]);
      const before = JSON.stringify(points);
      linearRegression(points);
      expect(JSON.stringify(points)).toBe(before);
    });
  });
});
