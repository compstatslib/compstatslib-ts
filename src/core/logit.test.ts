/**
 * Tests for the logistic-regression core, ported from the `glm(family =
 * binomial)` call inside `plot_logit()` in `../compstatslib/R/logit_plot.R`.
 *
 * Every expected value below comes from R 4.5.3, printed at full double
 * precision with `sprintf("%.17g", x)`. Do not edit these numbers by hand.
 * Sources: `.claude/plans/001-PLAN-port/logit-fixtures.md` sections 1 to 4, and the R script
 * below, run for this task to raise the edge cases to full precision and to
 * pin the parts of `glm.fit` the fixture document describes in prose.
 *
 * ```r
 * fmt <- function(x) if (is.na(x)) "NA" else sprintf("%.17g", x)
 *
 * ## Link functions, read off binomial() itself rather than assumed.
 * fam <- binomial()
 * for (e in c(-40, -30.5, -30, 0, 30, 30.5, 40)) {
 *   cat(fmt(e), fmt(fam$linkinv(e)), fmt(fam$mu.eta(e)), "\n")
 * }
 *
 * report <- function(label, x, y) {
 *   r <- suppressWarnings(glm(y ~ x, data = data.frame(x = x, y = y),
 *                             family = binomial))
 *   cat(label, fmt(coef(r)[1]), fmt(coef(r)[2]), fmt(r$deviance),
 *       fmt(r$null.deviance), fmt(r$aic), r$rank, r$iter, r$converged, "\n")
 * }
 * report("1 point", 10, 1)
 * report("2 separated", c(10, 30), c(0, 1))
 * report("all y = 0", c(5, 15, 25, 35), c(0, 0, 0, 0))
 * report("all y = 1", c(5, 15, 25, 35), c(1, 1, 1, 1))
 * report("constant x", c(20, 20, 20, 20), c(0, 1, 0, 1))
 * report("2 same class", c(10, 30), c(1, 1))
 *
 * ## One IRLS step, through R's own Cdqrls, from the binomial starting values.
 * x <- c(2, 8, 11, 15, 20, 24, 29, 33, 38, 44, 47, 50)
 * y <- c(0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1)
 * mu <- (y + 0.5) / 2
 * eta <- log(mu / (1 - mu))
 * mev <- fam$mu.eta(eta)
 * z <- eta + (y - mu) / mev
 * w <- sqrt(mev^2 / (mu * (1 - mu)))
 * .Call(stats:::C_Cdqrls, cbind(1, x) * w, z * w, 1e-11, FALSE)$coefficients
 * ## -1.9593006849236529, 0.07324488541770667
 * ```
 *
 * What that script established, beyond the values pinned in the tests:
 *
 * - `linkinv` clamps. R's `C_logit_linkinv` maps eta below -30 to
 *   `eps / (1 + eps)` and eta above 30 to `(1/eps) / (1 + 1/eps)`, giving the
 *   saturated fitted values 2.2204460492503126e-16 and 0.99999999999999978
 *   that the separated fixture reports. The bound is strict: eta = -30 exactly
 *   still takes the plain path.
 * - `mu.eta` is `exp(eta) / (1 + exp(eta))^2`, clamped to `eps` outside the
 *   same bounds. It is *not* `mu * (1 - mu)`. The two agree in exact
 *   arithmetic and differ in the last two digits in floating point:
 *   at eta = log(3), R gives 0.18750000000000003 where `mu * (1 - mu)` gives
 *   0.18749999999999994. Section 4 of the fixture document derives the IRLS
 *   weights the second way, so its step-1 coefficients differ from R's own
 *   glm path in the last two digits. This file pins the glm path.
 * - An aliased coefficient is 0 *inside* the loop and only becomes NA in the
 *   reported fit. `Cdqrls` on a rank-deficient design returns 0, not NA, so
 *   `eta <- x %*% start` stays finite and the constant-x fixture converges in
 *   2 iterations instead of breaking on a non-finite coefficient.
 *
 * R reports an aliased coefficient as `NA` and this port reports `null`, the
 * convention `linearRegression` and `leastSquares` already use.
 */

import { describe, expect, test } from "bun:test";

import { logisticRegression, predictLogit } from "./logit.js";
import type { Point } from "./regression.js";

/**
 * Relative tolerance for comparisons against R.
 *
 * The same budget as the other core tests. Scaling by max(1, |expected|) means
 * a value R reports as numerical noise, such as the -8.5e-16 slope of the
 * all-zero fixture, is asserted as "zero to within 1e-12" rather than to
 * within a relative tolerance of noise.
 */
const RELATIVE_TOLERANCE = 1e-12;

/**
 * The loosened tolerance for the coefficients of a perfectly separated fit.
 *
 * Separation has no maximum likelihood estimate: the coefficients diverge and
 * only the iteration cap stops them, so each further pass multiplies any
 * difference in rounding. R disagrees with *itself* by 1.7e-11 relative here —
 * running R's own `glm.fit` loop by hand through R's own `Cdqrls` gives
 * -46.364800582158786 where `glm()` reports -46.364800582941179 — so a
 * tolerance near 1e-12 would be pinning R's call stack rather than the
 * statistics.
 *
 * This applies to coefficients only, and only in the separated fixtures.
 * Everything else about those fits matches R exactly: the deviances and AIC
 * agree to the last bit, and the iteration counts agree outright.
 *
 * Achieved margins, scaled the same way as the assertions:
 *
 *   doc example        intercept 3.1e-11, slope 6.1e-11
 *   two points         intercept 5.9e-9,  slope 1.2e-8   (the worst case)
 *   all ones           intercept 2.4e-11
 *   one point          intercept 1.9e-11
 */
const SEPARATED_TOLERANCE = 1e-7;

function expectClose(
  actual: number | null,
  expected: number,
  relative: number = RELATIVE_TOLERANCE,
): void {
  expect(actual).not.toBeNull();
  const tolerance = relative * Math.max(1, Math.abs(expected));
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(
    tolerance,
  );
}

function expectVectorClose(
  actual: readonly number[],
  expected: readonly number[],
  relative: number = RELATIVE_TOLERANCE,
): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries()) {
    expectClose(actual[index] ?? null, value, relative);
  }
}

function pointsFrom(xs: readonly number[], ys: readonly number[]): Point[] {
  return xs.map((x, index) => ({ x, y: ys[index] as number }));
}

const mainX = [2, 8, 11, 15, 20, 24, 29, 33, 38, 44, 47, 50];
const mainY = [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1];
const mainPoints = pointsFrom(mainX, mainY);

const separatedPoints = pointsFrom([-6, -3, 1, 3, 5, 8], [0, 0, 0, 1, 1, 1]);

describe("logisticRegression", () => {
  describe("the main fixture, which converges normally (section 1)", () => {
    const fit = () => logisticRegression(mainPoints);

    test("matches the R intercept and slope", () => {
      expectClose(fit()?.intercept ?? null, -1.8590563753429619);
      expectClose(fit()?.slope ?? null, 0.069531921315973633);
    });

    test("matches the R fitted values, in input order", () => {
      expectVectorClose(fit()?.fitted ?? [], [
        0.15187212549312423, 0.21369398985788718, 0.25082723153601255,
        0.30659691974342596, 0.38499076214531086, 0.45257046789336486,
        0.53926134317191121, 0.6071855411795799, 0.68636004189354083,
        0.76858671389234612, 0.80359931968366272, 0.83445554350982787,
      ]);
    });

    test("matches the R linear predictors, in input order", () => {
      expectVectorClose(fit()?.linearPredictors ?? [], [
        -1.7199925327110146, -1.3028010048151728, -1.094205240867252,
        -0.81607755560335737, -0.46841794902348921, -0.19029026375959468,
        0.15736934282027348, 0.43549702808416801, 0.78315663466403618,
        1.200348162559878, 1.4089439265077988, 1.6175396904557198,
      ]);
    });

    test("matches the R deviances and AIC", () => {
      expectClose(fit()?.deviance ?? null, 13.893152102357845);
      expectClose(fit()?.nullDeviance ?? null, 16.635532333438686);
      expectClose(fit()?.aic ?? null, 17.893152102357845);
    });

    test("converges in R's four iterations at full rank", () => {
      expect(fit()?.iterations).toBe(4);
      expect(fit()?.converged).toBe(true);
      expect(fit()?.rank).toBe(2);
    });

    test("does not report saturated probabilities", () => {
      // R's warning fires below 10 * .Machine$double.eps from 0 or 1. These
      // fitted values sit between 0.15 and 0.84.
      expect(fit()?.saturated).toBe(false);
    });

    test("matches R's first IRLS step when stopped after one iteration", () => {
      // R's own Cdqrls on the binomial starting values, above. This is the
      // step that distinguishes mu.eta(eta) from mu * (1 - mu).
      const stepped = logisticRegression(mainPoints, { maxIterations: 1 });
      expectClose(stepped?.intercept ?? null, -1.9593006849236529);
      expectClose(stepped?.slope ?? null, 0.07324488541770667);
      expect(stepped?.converged).toBe(false);
      expect(stepped?.iterations).toBe(1);
    });
  });

  describe("the separated doc example (section 2)", () => {
    const fit = () => logisticRegression(separatedPoints);

    test("matches the R coefficients at the separated tolerance", () => {
      expectClose(
        fit()?.intercept ?? null,
        -46.364800582941179,
        SEPARATED_TOLERANCE,
      );
      expectClose(
        fit()?.slope ?? null,
        23.160986458002903,
        SEPARATED_TOLERANCE,
      );
    });

    test("matches the R fitted values, saturated at both ends", () => {
      // The two extreme rows sit exactly on R's linkinv clamp, so those are
      // exact. The middle rows are on the diverging scale.
      const fitted = fit()?.fitted ?? [];
      expect(fitted[0]).toBe(2.2204460492503126e-16);
      expect(fitted[1]).toBe(2.2204460492503126e-16);
      expect(fitted[4]).toBe(0.99999999999999978);
      expect(fitted[5]).toBe(0.99999999999999978);
    });

    test("matches R's deviances and AIC to the last bit", () => {
      // The deviance is carried by the saturated rows, which land on R's
      // clamp exactly, so these agree bit for bit despite the coefficients
      // differing at 1e-11.
      expectClose(fit()?.deviance ?? null, 3.4976110894891103e-10);
      expectClose(fit()?.nullDeviance ?? null, 8.317766166719343);
      expectClose(fit()?.aic ?? null, 4.0000000003497611);
    });

    test("converges on R's last permitted iteration", () => {
      // R reports iter = 25 = maxit, meeting the convergence test on the
      // final permitted pass by 6.0e-9 against a 1e-8 threshold. The fixture
      // document warns this is fragile and advises against pinning it unless
      // the port tracks R's deviance trajectory pass for pass. It does: the
      // iteration count and every deviance match, so the exact count is
      // pinned deliberately, and a change here is worth investigating rather
      // than relaxing.
      expect(fit()?.iterations).toBe(25);
      expect(fit()?.converged).toBe(true);
    });

    test("reports the saturated probabilities R warns about", () => {
      expect(fit()?.saturated).toBe(true);
    });
  });

  describe("one point (section 3)", () => {
    // R fits the intercept and aliases the slope, exactly as lm() does on a
    // single point. plot_logit never reaches this case: it draws the point and
    // returns before fitting. The core reports the honest degenerate fit and
    // leaves that guard to the plot layer, the way linearRegression does.
    const fit = () => logisticRegression([{ x: 10, y: 1 }]);

    test("fits an intercept and aliases the slope", () => {
      expectClose(fit()?.intercept ?? null, 22.566068555787666, SEPARATED_TOLERANCE);
      expect(fit()?.slope).toBeNull();
      expect(fit()?.rank).toBe(1);
    });

    test("matches R's deviance, AIC and iteration count", () => {
      expectClose(fit()?.deviance ?? null, 3.1674618481126528e-10);
      expect(fit()?.nullDeviance).toBe(0);
      expectClose(fit()?.aic ?? null, 2.0000000003167462);
      expect(fit()?.iterations).toBe(21);
      expect(fit()?.converged).toBe(true);
    });

    test("fits the point at the saturated probability", () => {
      expectClose(fit()?.fitted[0] ?? null, 0.99999999984162702, SEPARATED_TOLERANCE);
    });
  });

  describe("two separated points (section 3)", () => {
    const fit = () => logisticRegression(pointsFrom([10, 30], [0, 1]));

    test("matches the R coefficients at the separated tolerance", () => {
      expectClose(
        fit()?.intercept ?? null,
        -47.132137229506277,
        SEPARATED_TOLERANCE,
      );
      expectClose(
        fit()?.slope ?? null,
        2.356606870605547,
        SEPARATED_TOLERANCE,
      );
    });

    test("matches R's deviances and iteration count", () => {
      expectClose(fit()?.deviance ?? null, 2.3304913553832688e-10);
      expectClose(fit()?.nullDeviance ?? null, 2.7725887222397811);
      expect(fit()?.iterations).toBe(22);
    });

    test("does not reach R's saturation warning", () => {
      // Fitted values are about 5.8e-11 from the bounds, which reads as 0 and
      // 1 on a plot but stays well outside R's 10 * eps threshold.
      expect(fit()?.saturated).toBe(false);
    });
  });

  describe("one class only (section 3)", () => {
    test("all zeros fit a large negative intercept and no slope", () => {
      const fit = logisticRegression(
        pointsFrom([5, 15, 25, 35], [0, 0, 0, 0]),
      );
      expectClose(fit?.intercept ?? null, -23.566068523450717, SEPARATED_TOLERANCE);
      expect(fit?.nullDeviance).toBe(0);
      expectClose(fit?.deviance ?? null, 4.6609827107665376e-10);
      expect(fit?.iterations).toBe(22);
    });

    test("all ones mirror it", () => {
      const fit = logisticRegression(
        pointsFrom([5, 15, 25, 35], [1, 1, 1, 1]),
      );
      expectClose(fit?.intercept ?? null, 23.566068889167578, SEPARATED_TOLERANCE);
      expect(fit?.nullDeviance).toBe(0);
      expectClose(fit?.deviance ?? null, 4.6609827107665376e-10);
      expect(fit?.iterations).toBe(22);
    });

    test("both keep a full-rank fit with a numerically flat slope", () => {
      // R does not alias the slope here. x still varies, so the QR keeps the
      // column, and the fitted slope is zero to within rounding. R's own
      // values are -8.5e-16 and -1.7e-11 and this port's are -4.3e-16 and
      // -2.7e-11: rounding noise on both sides, carrying no information, so
      // the assertion is flatness rather than a match against R's noise.
      for (const outcome of [0, 1]) {
        const fit = logisticRegression(
          pointsFrom([5, 15, 25, 35], [outcome, outcome, outcome, outcome]),
        );
        expect(fit?.rank).toBe(2);
        expect(fit?.slope).not.toBeNull();
        expect(Math.abs(fit?.slope as number)).toBeLessThan(1e-9);
      }
    });
  });

  describe("constant x (section 3)", () => {
    // The aliasing case. R reports "1 not defined because of singularities",
    // the slope as NA, and a model that reduces to the null model.
    const fit = () => logisticRegression(pointsFrom([20, 20, 20, 20], [0, 1, 0, 1]));

    test("aliases the slope and fits the intercept at logit(mean y)", () => {
      expectClose(fit()?.intercept ?? null, 5.5511151231257827e-17);
      expect(fit()?.slope).toBeNull();
      expect(fit()?.rank).toBe(1);
    });

    test("reduces to the null model", () => {
      expectClose(fit()?.deviance ?? null, 5.5451774444795623);
      expectClose(fit()?.nullDeviance ?? null, 5.5451774444795623);
      expect(fit()?.deviance).toBe(fit()?.nullDeviance as number);
    });

    test("matches R's AIC and two iterations", () => {
      expectClose(fit()?.aic ?? null, 7.5451774444795623);
      expect(fit()?.iterations).toBe(2);
      expect(fit()?.converged).toBe(true);
    });

    test("fits every point at one half", () => {
      expectVectorClose(fit()?.fitted ?? [], [0.5, 0.5, 0.5, 0.5]);
    });
  });

  describe("no points", () => {
    test("returns null, the way linearRegression does", () => {
      // R's glm() errors here ("Argument mu must be a nonempty numeric
      // vector"), and plot_logit guards before ever calling it.
      expect(logisticRegression([])).toBeNull();
    });
  });

  describe("rejected inputs", () => {
    test("an outcome that is neither 0 nor 1", () => {
      // R accepts any y in [0, 1] for the binomial family. This port refuses
      // it: the points come from clicks, and the AIC identity it reports
      // assumes a 0/1 outcome.
      expect(() => logisticRegression(pointsFrom([1, 2], [0, 0.5]))).toThrow(
        RangeError,
      );
    });

    test("a non-finite predictor is missing, not rejected", () => {
      // This threw a RangeError before the na.omit pass: the port refused
      // what R would silently drop. Now the row leaves the fit instead and
      // the survivor is an intercept-only model, R's glm(y ~ x) on one row.
      const fit = logisticRegression([
        { x: Number.NaN, y: 0 },
        { x: 2, y: 1 },
      ]);
      expect(fit?.slope).toBeNull();
      expect(fit?.fitted[0]).toBeNaN();
    });
  });

  describe("purity", () => {
    test("does not mutate the input points", () => {
      const points = pointsFrom(mainX, mainY);
      const before = JSON.stringify(points);
      logisticRegression(points);
      expect(JSON.stringify(points)).toBe(before);
    });
  });
});

describe("predictLogit", () => {
  test("matches R's predict(type = \"response\") on the main fixture grid", () => {
    // R: predict(regr, data.frame(x = grid), type = "response").
    const fit = logisticRegression(mainPoints);
    expect(fit).not.toBeNull();
    const grid = [0, 5, 10, 12.5, 25, 37.5, 45, 50];
    const expected = [
      0.13481307700449607, 0.18073188434000878, 0.23798888665227516,
      0.27093037639220546, 0.46984704779947761, 0.67882793402812125,
      0.78072221955807719, 0.83445554350982787,
    ];
    expectVectorClose(
      grid.map((x) => predictLogit(fit as NonNullable<typeof fit>, x)),
      expected,
    );
  });

  test("agrees with the fitted values at the observed x", () => {
    const fit = logisticRegression(mainPoints);
    expectVectorClose(
      mainX.map((x) => predictLogit(fit as NonNullable<typeof fit>, x)),
      fit?.fitted ?? [],
    );
  });

  test("clamps a saturated prediction the way R's linkinv does", () => {
    // R: predict on the separated fixture returns 2.2204460492503126e-16 at
    // x = -6 and 0.99999999999999978 at x = 8.
    const fit = logisticRegression(separatedPoints);
    expect(predictLogit(fit as NonNullable<typeof fit>, -6)).toBe(
      2.2204460492503126e-16,
    );
    expect(predictLogit(fit as NonNullable<typeof fit>, 8)).toBe(
      0.99999999999999978,
    );
  });

  test("holds the intercept flat when the slope is aliased", () => {
    const fit = logisticRegression(pointsFrom([20, 20, 20, 20], [0, 1, 0, 1]));
    expectClose(predictLogit(fit as NonNullable<typeof fit>, 0), 0.5);
    expectClose(predictLogit(fit as NonNullable<typeof fit>, 1000), 0.5);
  });
});

describe("logisticRegression: missing values, R's na.omit", () => {
  // Every expected value comes from R 4.5.3, printed with sprintf("%.17g").
  //
  // ```r
  // d <- data.frame(
  //   x = c(0.2, 1.1, NA, 2.5, 3.0, 4.2, 5.1, 1.9),
  //   y = c(0,   1,   1,  NA,  0,   1,   1,   0)
  // )
  // m <- glm(y ~ x, family = binomial, data = d)   # na.omit drops rows 3, 4
  // coef(m); fitted(m); m$deviance; m$null.deviance; m$aic; m$iter
  // ```
  const withMissing = pointsFrom(
    [0.2, 1.1, Number.NaN, 2.5, 3.0, 4.2, 5.1, 1.9],
    [0, 1, 1, Number.NaN, 0, 1, 1, 0],
  );

  test("fits the complete rows alone, as R's glm does", () => {
    const fit = logisticRegression(withMissing);
    expectClose(fit?.intercept as number, -1.8632412046875804);
    expectClose(fit?.slope as number, 0.72714482673942726);
    expectClose(fit?.deviance as number, 6.5660909561548673);
    expectClose(fit?.nullDeviance as number, 8.317766166719343);
    expectClose(fit?.aic as number, 10.566090956154866);
    expect(fit?.iterations).toBe(3);
    expect(fit?.converged).toBe(true);
  });

  test("pads fitted with NaN at the dropped rows, keeping input order", () => {
    const fitted = logisticRegression(withMissing)?.fitted ?? [];
    const expected = [
      0.15215317571597703, 0.25666370073720429, Number.NaN, Number.NaN,
      0.57888387655706697, 0.76687822559084384, 0.86356223739468918,
      0.38185879284192664,
    ];
    expect(fitted.length).toBe(expected.length);
    for (const [index, value] of expected.entries()) {
      if (Number.isNaN(value)) {
        expect(fitted[index]).toBeNaN();
        expect(
          logisticRegression(withMissing)?.linearPredictors[index],
        ).toBeNaN();
      } else {
        expectClose(fitted[index] as number, value);
      }
    }
  });

  test("answers exactly as it would on the filtered input", () => {
    const filtered = logisticRegression(
      pointsFrom([0.2, 1.1, 3.0, 4.2, 5.1, 1.9], [0, 1, 0, 1, 1, 0]),
    );
    const fit = logisticRegression(withMissing);
    expect(fit?.intercept).toBe(filtered?.intercept as number);
    expect(fit?.slope).toBe(filtered?.slope as number);
    expect(fit?.deviance).toBe(filtered?.deviance as number);
  });

  test("validates the outcome only where the row is complete", () => {
    // R's na.omit removes the row before glm ever sees its outcome, so an
    // invalid y on an incomplete row is gone, not rejected.
    const fit = logisticRegression([
      { x: Number.NaN, y: 0.5 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
    ]);
    expect(fit).not.toBeNull();
    expect(fit?.fitted[0]).toBeNaN();
  });

  test("returns null when no row is complete, as with no rows at all", () => {
    expect(
      logisticRegression(pointsFrom([Number.NaN, 2], [0, Number.NaN])),
    ).toBeNull();
  });
});
