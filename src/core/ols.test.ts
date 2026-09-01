/**
 * Tests for the general (weighted) least-squares core.
 *
 * This module is the equivalent of R's `lm.wfit()`, which is also the solver
 * inside every IRLS step of `glm(family = binomial)` (`glm.fit` calls
 * `C_Cdqrls` on the design and response pre-multiplied by the square-root
 * weights). Slice 3 (logit) and slice 7 (moderation) both build on it.
 *
 * Every expected value below comes from R 4.5.3, printed at full double
 * precision with `sprintf("%.17g", x)`. Do not edit these numbers by hand.
 *
 * Sources:
 *
 * - `.claude/plans/001-PLAN-port/logit-fixtures.md`, section 5 (weighted OLS fixtures) and
 *   section 4 (the `glm.fit` iteration-1 weighted solve).
 * - `.claude/plans/001-PLAN-port/regression-fixtures.md` (the slice-1 simple-regression
 *   fixtures, reused here for the matrix-versus-scalar agreement test that
 *   question Q6 of the port plan asks for).
 * - The R script below, run for this task, which covers rank deficiency,
 *   pivot order, zero weights, and the rank tolerance.
 *
 * ```r
 * ## Extra R-verified fixtures for core/ols.ts (rank deficiency, pivoting,
 * ## zero weights, tolerance sensitivity). R 4.5.3.
 *
 * fmt <- function(x) if (is.na(x)) "NA" else sprintf("%.17g", x)
 * fmtv <- function(v) paste(sapply(v, fmt), collapse = ", ")
 *
 * report <- function(label, fit) {
 *   cat("\n---- ", label, " ----\n", sep = "")
 *   cat("coefficients: ", fmtv(fit$coefficients), "\n", sep = "")
 *   cat("rank: ", fit$rank, "\n", sep = "")
 *   cat("fitted:    ", fmtv(fit$fitted.values), "\n", sep = "")
 *   cat("residuals: ", fmtv(fit$residuals), "\n", sep = "")
 * }
 *
 * x <- c(1, 3, 5, 8)
 * y <- c(2, 4, 6, 8)
 *
 * report("duplicate middle column", lm.fit(cbind(1, 1, x), y))
 * report("constant x", lm.fit(cbind(1, c(20, 20, 20, 20)), c(0, 1, 0, 1)))
 * report("n = 1, p = 2", lm.fit(matrix(c(1, 10), nrow = 1), 3))
 * report("zero weight", lm.wfit(cbind(1, x), y, c(1, 1, 0, 1)))
 * lm.fit(cbind(1, x[-3]), y[-3])$coefficients   ## same as the line above
 * lm.wfit(cbind(1, x), y, 10 * c(0.5, 2, 1, 4))$coefficients  ## scale free
 *
 * X_near <- cbind(1, c(1, 1, 1, 1 + 1e-8))
 * report("near collinear, tol = 1e-7", lm.fit(X_near, y, tol = 1e-7))
 * report("near collinear, tol = 1e-11", lm.fit(X_near, y, tol = 1e-11))
 *
 * lm.wfit(cbind(1, x), y, c(1, -1, 1, 1))  ## error
 * lm.fit(matrix(numeric(0), nrow = 0, ncol = 2), numeric(0))  ## error
 *
 * z <- c(2, 5, 1, 9, 4, 6)
 * xx <- c(1, 2, 3, 4, 5, 6)
 * yy <- c(3.1, 4.4, 2.2, 9.9, 5.5, 7.7)
 * report("moderation shaped", lm.fit(cbind(1, xx, z, xx * z), yy))
 * ```
 *
 * R output that the tests below pin:
 *
 *   duplicate middle column   coefficients 1.3457943925233646, NA,
 *                             0.85981308411214952; rank 2 — R aliases the
 *                             repeated column and keeps the other two in
 *                             their original positions.
 *   constant x                coefficients 0.5, NA; rank 1
 *   n = 1, p = 2              coefficients 3, NA; rank 1
 *   zero weight               coefficients 1.2820512820512839,
 *                             0.84615384615384592 — bit-identical to
 *                             `lm.fit()` on the three remaining rows
 *   10 * w                    1.5480225988700553, 0.81355932203389847
 *   near collinear tol 1e-7   coefficients 5, NA; rank 1
 *   near collinear tol 1e-11  rank 2, coefficients -400000000.4047181,
 *                             400000004.40471816 (values are meaningless at
 *                             this conditioning; only the rank is pinned)
 *   negative weights          error "missing or negative weights not allowed"
 *   zero rows                 error "0 (non-NA) cases"
 *   moderation shaped         coefficients 2.4894248862431185,
 *                             -0.36766225324164448, 0.26168702316192777,
 *                             0.17307297546956804; rank 4
 *
 * R reports an aliased coefficient as `NA`. This port reports `null`, the
 * same convention `linearRegression` uses.
 */

import { describe, expect, test } from "bun:test";

import { leastSquares } from "./ols.js";
import { linearRegression, type Point } from "./regression.js";

/**
 * Relative tolerance for all comparisons against R.
 *
 * Both sides solve by Householder QR, so they agree to a few units in the last
 * place. See the same constant in `regression.test.ts`.
 *
 * The unweighted fixtures come out bit-identical to R. The weighted intercept
 * lands one unit in the last place away from R's, in the direction of the exact
 * rational answer: against `274/177`, R is off by 4.7e-16 relative and this
 * port by 2.5e-16. The gap is rounding inside R's BLAS, not a disagreement
 * about the fit.
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

/** Assert that every value of a vector agrees with R. */
function expectVectorCloseToR(
  actual: readonly (number | null)[],
  expected: readonly number[],
): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries()) {
    expectCloseToR(actual[index] ?? null, value);
  }
}

/**
 * Assert that two computed vectors agree entry by entry, at a relative
 * tolerance. Both entries have to be null together, the way an aliased
 * column reports on either arithmetic path.
 */
function expectVectorsAgree(
  actual: readonly (number | null)[],
  expected: readonly (number | null)[],
  tolerance: number,
): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries()) {
    const other = actual[index] ?? null;
    if (value === null) {
      expect(other).toBeNull();
      continue;
    }
    expect(other).not.toBeNull();
    expect(Math.abs((other as number) - value)).toBeLessThanOrEqual(
      tolerance * Math.max(1, Math.abs(value)),
    );
  }
}

/** Build the design matrix of a simple regression: an intercept and one term. */
function simpleDesign(xs: readonly number[]): number[][] {
  return xs.map((x) => [1, x]);
}

const x = [1, 3, 5, 8];
const y = [2, 4, 6, 8];

describe("leastSquares", () => {
  describe("unweighted, X = cbind(1, x) (logit-fixtures section 5)", () => {
    const fit = () => leastSquares(simpleDesign(x), y);

    test("matches the R coefficients", () => {
      expectVectorCloseToR(fit().coefficients, [
        1.3457943925233646, 0.85981308411214952,
      ]);
    });

    test("matches the R fitted values, in input order", () => {
      expectVectorCloseToR(fit().fitted, [
        2.2056074766355138, 3.9252336448598135, 5.6448598130841123,
        8.2242990654205599,
      ]);
    });

    test("matches the R residuals, in input order", () => {
      expectVectorCloseToR(fit().residuals, [
        -0.20560747663551376, 0.074766355140186522, 0.35514018691588811,
        -0.22429906542056077,
      ]);
    });

    test("reports full rank", () => {
      expect(fit().rank).toBe(2);
    });

    test("treats unit weights as no weights", () => {
      const weighted = leastSquares(simpleDesign(x), y, {
        weights: [1, 1, 1, 1],
      });
      expect(weighted.coefficients).toEqual(fit().coefficients);
    });
  });

  describe("weighted, w = c(0.5, 2, 1, 4) (logit-fixtures section 5)", () => {
    const fit = () =>
      leastSquares(simpleDesign(x), y, { weights: [0.5, 2, 1, 4] });

    test("matches the R coefficients", () => {
      expectVectorCloseToR(fit().coefficients, [
        1.5480225988700558, 0.81355932203389825,
      ]);
    });

    test("matches the R fitted values, in input order", () => {
      expectVectorCloseToR(fit().fitted, [
        2.3615819209039555, 3.9887005649717513, 5.6158192090395476,
        8.0564971751412422,
      ]);
    });

    test("matches the R residuals, in input order", () => {
      expectVectorCloseToR(fit().residuals, [
        -0.36158192090395536, 0.011299435028248797, 0.38418079096045205,
        -0.056497175141242972,
      ]);
    });

    test("does not change when every weight is scaled", () => {
      // R: lm.wfit(cbind(1, x), y, 10 * w) gives the same coefficients to
      // within rounding.
      const scaled = leastSquares(simpleDesign(x), y, {
        weights: [5, 20, 10, 40],
      });
      expectVectorCloseToR(scaled.coefficients, [
        1.5480225988700553, 0.81355932203389847,
      ]);
    });
  });

  describe("the first IRLS step of the logit fixture (section 4)", () => {
    // glm.fit's iteration 1 on the main logit fixture. The working response z
    // is +/- 2.431945622001443 and every IRLS weight is mu * (1 - mu) = 0.1875,
    // because mustart only takes the values 0.25 and 0.75.
    const xMain = [2, 8, 11, 15, 20, 24, 29, 33, 38, 44, 47, 50];
    const yMain = [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1];
    const working = yMain.map((value) =>
      value === 1 ? 2.431945622001443 : -2.431945622001443,
    );
    const irlsWeights = yMain.map(() => 0.18749999999999997);

    test("matches R's lm.wfit step-1 coefficients", () => {
      const fit = leastSquares(simpleDesign(xMain), working, {
        weights: irlsWeights,
      });
      expectVectorCloseToR(fit.coefficients, [
        -1.9593006849236547, 0.073244885417706698,
      ]);
    });

    test("matches R's step-1 fitted values", () => {
      const fit = leastSquares(simpleDesign(xMain), working, {
        weights: irlsWeights,
      });
      expectVectorCloseToR(fit.fitted, [
        -1.8128109140882387, -1.3733416015820001, -1.1536069453288804,
        -0.8606274036580539, -0.49440297656952037, -0.20142343489869363,
        0.16480099218983968, 0.45778053386066664, 0.82400496094919995,
        1.2634742734554401, 1.4832089297085604, 1.7029435859616804,
      ]);
    });
  });

  describe("agreement with the scalar simple-regression form (plan Q6)", () => {
    // The two forms must give the same answer on the slice-1 fixtures, or
    // rebuilding linearRegression on this solver later would change results.
    const fixtures: ReadonlyArray<{
      readonly label: string;
      readonly xs: readonly number[];
      readonly ys: readonly number[];
    }> = [
      { label: "fixture A (R docs example)", xs: x, ys: y },
      {
        label: "fixture B (noisy)",
        xs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        ys: [3.2, 1.8, 6.5, 4.9, 8.1, 6.0, 10.3, 8.7, 12.2, 9.5],
      },
    ];

    for (const fixture of fixtures) {
      describe(fixture.label, () => {
        const points: Point[] = fixture.xs.map((value, index) => ({
          x: value,
          y: fixture.ys[index] as number,
        }));

        test("agrees on the intercept and the slope", () => {
          const scalar = linearRegression(points);
          const matrix = leastSquares(simpleDesign(fixture.xs), fixture.ys);
          expectCloseToR(
            matrix.coefficients[0] ?? null,
            scalar?.intercept as number,
          );
          expectCloseToR(
            matrix.coefficients[1] ?? null,
            scalar?.slope as number,
          );
        });

        test("agrees on the fitted values", () => {
          const scalar = linearRegression(points);
          const matrix = leastSquares(simpleDesign(fixture.xs), fixture.ys);
          expectVectorCloseToR(matrix.fitted, scalar?.fitted ?? []);
        });
      });
    }
  });

  describe("a four-column design (the shape slice 7 needs for y ~ x * z)", () => {
    const xs = [1, 2, 3, 4, 5, 6];
    const zs = [2, 5, 1, 9, 4, 6];
    const ys = [3.1, 4.4, 2.2, 9.9, 5.5, 7.7];
    const design = xs.map((value, index) => {
      const z = zs[index] as number;
      return [1, value, z, value * z];
    });

    test("matches the R coefficients", () => {
      expectVectorCloseToR(leastSquares(design, ys).coefficients, [
        2.4894248862431185, -0.36766225324164448, 0.26168702316192777,
        0.17307297546956804,
      ]);
    });

    test("matches the R fitted values", () => {
      expectVectorCloseToR(leastSquares(design, ys).fitted, [
        2.9912826302644633, 4.793265250265148, 2.1673440760888165,
        9.604586198638339, 5.1593212220739675, 8.0842006226692664,
      ]);
    });

    test("reports full rank", () => {
      expect(leastSquares(design, ys).rank).toBe(4);
    });
  });

  describe("constant x, the case that aliases a coefficient", () => {
    // R: lm.fit(cbind(1, 20), c(0, 1, 0, 1)) gives 0.5 and NA at rank 1. This
    // is the OLS shape of the constant-x glm fixture, where R reports
    // "1 not defined because of singularities".
    const design = [
      [1, 20],
      [1, 20],
      [1, 20],
      [1, 20],
    ];
    const values = [0, 1, 0, 1];

    test("fits the intercept at the mean of y", () => {
      expectCloseToR(leastSquares(design, values).coefficients[0] ?? null, 0.5);
    });

    test("reports no coefficient for the aliased column", () => {
      expect(leastSquares(design, values).coefficients[1]).toBeNull();
    });

    test("drops the aliased column from the rank", () => {
      expect(leastSquares(design, values).rank).toBe(1);
    });

    test("fits every row at the mean of y", () => {
      expectVectorCloseToR(
        leastSquares(design, values).fitted,
        [0.5, 0.5, 0.5, 0.5],
      );
    });
  });

  describe("a repeated column, which aliases a middle coefficient", () => {
    // R: lm.fit(cbind(1, 1, x), y) aliases the second column and leaves the
    // first and third in place. This is the test of pivot bookkeeping: a
    // solver that reordered the surviving columns would return the slope in
    // the wrong slot.
    const design = x.map((value) => [1, 1, value]);

    test("keeps the surviving coefficients in their original columns", () => {
      const fit = leastSquares(design, y);
      expectCloseToR(fit.coefficients[0] ?? null, 1.3457943925233646);
      expect(fit.coefficients[1]).toBeNull();
      expectCloseToR(fit.coefficients[2] ?? null, 0.85981308411214952);
    });

    test("reports the reduced rank", () => {
      expect(leastSquares(design, y).rank).toBe(2);
    });

    test("fits the same values as the design without the repeat", () => {
      expectVectorCloseToR(leastSquares(design, y).fitted, [
        2.2056074766355138, 3.9252336448598135, 5.6448598130841123,
        8.2242990654205599,
      ]);
    });
  });

  describe("more columns than rows", () => {
    // R: lm.fit(matrix(c(1, 10), nrow = 1), 3) gives 3 and NA at rank 1. This
    // is also what glm() does on a single point, per logit-fixtures section 3.
    const fit = () => leastSquares([[1, 10]], [3]);

    test("fits as many coefficients as there are rows", () => {
      expect(fit().rank).toBe(1);
      expectCloseToR(fit().coefficients[0] ?? null, 3);
      expect(fit().coefficients[1]).toBeNull();
    });

    test("fits the single row exactly", () => {
      expectVectorCloseToR(fit().fitted, [3]);
      expectVectorCloseToR(fit().residuals, [0]);
    });
  });

  describe("zero weights", () => {
    test("drop the row from the fit", () => {
      // R: lm.wfit(cbind(1, x), y, c(1, 1, 0, 1)) equals lm.fit() on the three
      // remaining rows, bit for bit.
      const fit = leastSquares(simpleDesign(x), y, { weights: [1, 1, 0, 1] });
      expectVectorCloseToR(fit.coefficients, [
        1.2820512820512839, 0.84615384615384592,
      ]);
    });

    test("still report a fitted value for the dropped row", () => {
      // R keeps the row in fitted.values and residuals, predicted from the
      // coefficients of the other rows.
      const fit = leastSquares(simpleDesign(x), y, { weights: [1, 1, 0, 1] });
      expectVectorCloseToR(fit.fitted, [
        2.1282051282051277, 3.8205128205128216, 5.5128205128205137,
        8.0512820512820511,
      ]);
    });
  });

  describe("the rank tolerance", () => {
    // A column that repeats the intercept to within 1e-8. Its norm after the
    // first reflector is about 4.3e-9 of its original norm, which falls below
    // the default tolerance but not below the one glm.fit uses.
    const design = [
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1 + 1e-8],
    ];

    test("aliases a near-collinear column at the default 1e-7", () => {
      // R: lm.fit(X_near, y, tol = 1e-7) gives 5, NA at rank 1.
      const fit = leastSquares(design, y);
      expect(fit.rank).toBe(1);
      expect(fit.coefficients[1]).toBeNull();
      expectCloseToR(fit.coefficients[0] ?? null, 5);
    });

    test("keeps the column at the tolerance glm.fit passes", () => {
      // R: lm.fit(X_near, y, tol = 1e-11) gives rank 2. The coefficients
      // themselves (about -4e8 and 4e8) carry no information at this
      // conditioning, so only the rank is pinned.
      const fit = leastSquares(design, y, { tolerance: 1e-11 });
      expect(fit.rank).toBe(2);
      expect(fit.coefficients[1]).not.toBeNull();
    });
  });

  describe("rejected inputs", () => {
    test("no rows, which R reports as \"0 (non-NA) cases\"", () => {
      expect(() => leastSquares([], [])).toThrow(RangeError);
    });

    test("a negative weight, which R also refuses", () => {
      expect(() =>
        leastSquares(simpleDesign(x), y, { weights: [1, -1, 1, 1] }),
      ).toThrow(RangeError);
    });

    test("a response of the wrong length", () => {
      expect(() => leastSquares(simpleDesign(x), [1, 2])).toThrow(RangeError);
    });

    test("a weight vector of the wrong length", () => {
      expect(() =>
        leastSquares(simpleDesign(x), y, { weights: [1, 1] }),
      ).toThrow(RangeError);
    });

    test("rows of differing widths", () => {
      expect(() => leastSquares([[1, 2], [1]], [1, 2])).toThrow(RangeError);
    });
  });

  describe("long inputs", () => {
    test("a million-row design does not overflow the stack", () => {
      // The column norm used to be `Math.hypot(...column)`, a spread that
      // dies at about a million arguments. A fold does not.
      const n = 1_000_000;
      const fit = leastSquares(
        Array.from({ length: n }, () => [1]),
        new Array<number>(n).fill(2),
      );
      expect(fit.rank).toBe(1);
      expect(Math.abs((fit.coefficients[0] as number) - 2)).toBeLessThan(1e-9);
    });
  });

  describe("the fma option (plan 004, slice 0)", () => {
    // The option reaches the factorization through `qr`. The two arithmetic
    // paths round each product a different number of times, so they agree to
    // a few units in the last place, not bit for bit.
    const AGREEMENT = 1e-14;

    const xs = [1, 2, 3, 4, 5, 6];
    const zs = [2, 5, 1, 9, 4, 6];
    const ys = [3.1, 4.4, 2.2, 9.9, 5.5, 7.7];
    const moderationShaped = xs.map((value, index) => {
      const z = zs[index] as number;
      return [1, value, z, value * z];
    });

    test("a plain fit gives the same coefficients, fit and residuals", () => {
      const standard = leastSquares(moderationShaped, ys);
      const plain = leastSquares(moderationShaped, ys, { fma: false });
      expect(plain.rank).toBe(standard.rank);
      expectVectorsAgree(plain.coefficients, standard.coefficients, AGREEMENT);
      expectVectorsAgree(plain.fitted, standard.fitted, AGREEMENT);
      expectVectorsAgree(plain.residuals, standard.residuals, AGREEMENT);
    });

    test("a plain fit aliases the same column of a rank-deficient design", () => {
      const repeated = x.map((value) => [1, 1, value]);
      const standard = leastSquares(repeated, y);
      const plain = leastSquares(repeated, y, { fma: false });
      expect(plain.rank).toBe(standard.rank);
      expect(plain.coefficients[1]).toBeNull();
      expectVectorsAgree(plain.coefficients, standard.coefficients, AGREEMENT);
      expectVectorsAgree(plain.fitted, standard.fitted, AGREEMENT);
    });

    test("weights combine with a plain fit", () => {
      const weights = [0.5, 2, 1, 4];
      const standard = leastSquares(simpleDesign(x), y, { weights });
      const plain = leastSquares(simpleDesign(x), y, { weights, fma: false });
      expect(plain.rank).toBe(standard.rank);
      expectVectorsAgree(plain.coefficients, standard.coefficients, AGREEMENT);
      expectVectorsAgree(plain.fitted, standard.fitted, AGREEMENT);
      expectVectorsAgree(plain.residuals, standard.residuals, AGREEMENT);
    });

    test("the default still pins R's coefficients exactly", () => {
      const asked = leastSquares(moderationShaped, ys, { fma: true });
      expect(asked.coefficients).toEqual([
        2.4894248862431185, -0.36766225324164448, 0.26168702316192777,
        0.17307297546956804,
      ]);
    });

    test("refuses an fma that is not a boolean", () => {
      expect(() =>
        leastSquares(moderationShaped, ys, {
          fma: "yes" as unknown as boolean,
        }),
      ).toThrow(TypeError);
    });
  });

  describe("purity", () => {
    test("does not modify the design, the response, or the weights", () => {
      const design = simpleDesign(x);
      const response = [...y];
      const weights = [0.5, 2, 1, 4];
      const before = JSON.stringify({ design, response, weights });
      leastSquares(design, response, { weights });
      expect(JSON.stringify({ design, response, weights })).toBe(before);
    });
  });
});
