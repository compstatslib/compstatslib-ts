/**
 * Tests for `lm()`, R's linear model over a data frame, and `NamedVector`.
 *
 * Expected values come from R 4.5.3, `../compstatslib/conformance-fixtures/linalg.R`
 * section 4, captured in `.claude/plans/003-PLAN-linalg/linalg-fixtures.md`.
 *
 * Coefficients, fitted values and residuals pin exactly: `lm.fit()` is
 * `dqrls`, which is the `qr()` of Slice 2 followed by `dqrsl`'s
 * coefficients and residuals, and the port runs the same arithmetic. The
 * summary statistics — R², σ, the standard errors, t and p — are compared at
 * a stated tolerance (plan Q1): R's `summary.lm()` reaches them through
 * `chol2inv` and `pt`, whose rounding the port does not follow step for
 * step.
 *
 * `predictLm()` is pinned against `../compstatslib/conformance-fixtures/linalg.R`
 * section 8, captured in
 * `.claude/plans/004-PLAN-seminr-utilities/linalg-fixtures.md`. R's
 * `predict.lm()` rebuilds the design over the new frame and multiplies it by
 * the coefficients, so the predictions pin bit for bit. That product is why
 * `predict(fit)` on the training frame is not `fitted(fit)`: the fitted
 * values are what `dqrsl` returned during the fit, and the two agree only to
 * about 1e-14.
 */

import { describe, expect, test } from "bun:test";
import { moderationData } from "../../data/moderationData";
import { moderationSurface } from "../moderation";
import { linearRegression } from "../regression";
import { lm, predictLm } from "./lm";
import { lookup, namedVector, type NamedVector } from "./namedVector";

/** Compare at a relative tolerance, the way plan Q1 asks for values above 1. */
function relativelyClose(actual: number, expected: number, tolerance = 1e-12): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(expected)));
}

function values(v: NamedVector): readonly (number | null)[] {
  return v.values;
}

describe("NamedVector", () => {
  test("pairs names with values and refuses a mismatch", () => {
    const v = namedVector(["a", "b"], [1, null]);
    expect(v.names).toEqual(["a", "b"]);
    expect(v.values).toEqual([1, null]);
    expect(() => namedVector(["a"], [1, 2])).toThrow(RangeError);
  });

  test("lookup() reads by name, null for R's NA, undefined for an absent name", () => {
    const v = namedVector(["(Intercept)", "x:z", "1"], [1.5, null, 3]);
    expect(lookup(v, "(Intercept)")).toBe(1.5);
    expect(lookup(v, "x:z")).toBeNull();
    expect(lookup(v, "1")).toBe(3);
    expect(lookup(v, "nope")).toBeUndefined();
  });

  test("keeps an integer-like name in its position, which a plain object would not", () => {
    const v = namedVector(["x", "1", "z"], [1, 2, 3]);
    expect(v.names).toEqual(["x", "1", "z"]);
    expect(Object.keys({ x: 1, "1": 2, z: 3 })).toEqual(["1", "x", "z"]);
  });
});

describe("lm() — fixture 4a, y ~ x * z + w", () => {
  const fit = lm(moderationData, { outcome: "y", terms: ["x", "z", "w", ["x", "z"]] });

  test("coefficients, named as R names them, pin exactly", () => {
    expect(fit.coefficients.names).toEqual(["(Intercept)", "x", "z", "w", "x:z"]);
    expect(values(fit.coefficients)).toEqual([
      -0.046252109941790048, 0.47180209229612374, 0.31363421997396679,
      -0.003665271584484884, 0.84815858062951188,
    ]);
    expect(fit.rank).toBe(5);
    expect(fit.dfResidual).toBe(195);
  });

  test("fitted values and residuals pin exactly", () => {
    expect(fit.fitted.length).toBe(200);
    expect(fit.fitted.slice(0, 5)).toEqual([
      -9.3125516279148464, -1.0122867640124298, 2.4669205719678167,
      6.2586562854248644, -2.4120159769736449,
    ]);
    expect(fit.residuals.slice(0, 5)).toEqual([
      2.0396544278436499, -0.82456364654119363, 0.015582454953279921,
      -0.1701060382090408, -0.36937728164794625,
    ]);
  });

  test("R², adjusted R², sigma", () => {
    relativelyClose(fit.rSquared, 0.92040019588477451);
    relativelyClose(fit.adjRSquared, 0.91876737939010322);
    relativelyClose(fit.sigma, 1.0327642158597454);
  });

  test("standard errors, t and p values", () => {
    expect(fit.standardErrors.names).toEqual(fit.coefficients.names);
    const se = [0.074031725245280455, 0.037760431953416169, 0.0396454065908158, 0.039477170658436041, 0.019921957949769309];
    const tv = [-0.62476066562745181, 12.494615868753058, 7.9109850785745977, -0.092845346395199091, 42.574057367656138];
    const pv = [0.53285849237485605, 1.063321573890875e-26, 1.865566554738025e-13, 0.92612174436957528, 1.1135588279324392e-100];
    se.forEach((v, i) => relativelyClose(values(fit.standardErrors)[i] as number, v));
    tv.forEach((v, i) => relativelyClose(values(fit.tValues)[i] as number, v));
    pv.forEach((v, i) => relativelyClose(values(fit.pValues)[i] as number, v, 1e-9));
  });

  test("the F statistic", () => {
    expect(fit.fStatistic).not.toBeNull();
    const f = fit.fStatistic as { value: number; numdf: number; dendf: number };
    relativelyClose(f.value, 563.68869305798114);
    expect([f.numdf, f.dendf]).toEqual([4, 195]);
  });

  test("agrees with moderationSurface, which fits the same model", () => {
    const surface = moderationSurface(moderationData, {
      outcome: "y",
      iv: "x",
      mod: "z",
      controls: ["w"],
    });
    expect(surface.coefficients.map((term) => term.name)).toEqual([...fit.coefficients.names]);
    expect(surface.coefficients.map((term) => term.value)).toEqual([...values(fit.coefficients)]);
  });
});

describe("lm() — fixture 4b, other shapes", () => {
  test("no intercept", () => {
    const fit = lm(moderationData, { outcome: "y", terms: ["x", "z"], intercept: false });
    expect(fit.coefficients.names).toEqual(["x", "z"]);
    expect(values(fit.coefficients)).toEqual([0.51249221497106079, 0.66355249047187304]);
    expect(fit.dfResidual).toBe(198);
    expect(fit.fitted.slice(0, 2)).toEqual([-1.2502320954864947, -0.13584945205824162]);
    relativelyClose(fit.rSquared, 0.17958561576478654);
    relativelyClose(fit.adjRSquared, 0.17129860178261269);
    relativelyClose(fit.sigma, 3.3029043915751939);
    relativelyClose(values(fit.standardErrors)[0] as number, 0.12046578943356853);
    const f = fit.fStatistic as { value: number; numdf: number; dendf: number };
    relativelyClose(f.value, 21.670726772163249);
    expect([f.numdf, f.dendf]).toEqual([2, 198]);
  });

  test("intercept only", () => {
    const fit = lm(moderationData, { outcome: "y", terms: [] });
    expect(fit.coefficients.names).toEqual(["(Intercept)"]);
    expect(values(fit.coefficients)).toEqual([-0.31562302098439893]);
    expect(fit.fitted.slice(0, 2)).toEqual([-0.31562302098439421, -0.31562302098439865]);
    expect(fit.residuals[0]).toBe(-6.9572741790868022);
    expect(fit.rSquared).toBe(0);
    expect(fit.adjRSquared).toBe(0);
    relativelyClose(fit.sigma, 3.6235641115369814);
    relativelyClose(values(fit.standardErrors)[0] as number, 0.25622467553320066);
    relativelyClose(values(fit.pValues)[0] as number, 0.21946942238836148);
    expect(fit.fStatistic).toBeNull();
  });
});

describe("lm() — fixture 4c, an aliased column", () => {
  const aliased = {
    y: moderationData.y,
    x: moderationData.x,
    x2: moderationData.x.map((v) => 2 * v),
  };
  const fit = lm(aliased, { outcome: "y", terms: ["x", "x2"] });

  test("reports null for the aliased coefficient and rank 2", () => {
    expect(fit.coefficients.names).toEqual(["(Intercept)", "x", "x2"]);
    expect(values(fit.coefficients)).toEqual([-0.29054220305114831, 0.45627294314681255, null]);
    expect(fit.rank).toBe(2);
    expect(fit.dfResidual).toBe(198);
  });

  test("the summary statistics skip the aliased term", () => {
    expect(values(fit.standardErrors)[2]).toBeNull();
    expect(values(fit.tValues)[2]).toBeNull();
    expect(values(fit.pValues)[2]).toBeNull();
    relativelyClose(values(fit.standardErrors)[1] as number, 0.12807438646817032);
    relativelyClose(fit.rSquared, 0.060238913668862026);
    relativelyClose(fit.sigma, 3.5215886187279457);
    const f = fit.fStatistic as { value: number; numdf: number; dendf: number };
    relativelyClose(f.value, 12.691848045123169);
    expect([f.numdf, f.dendf]).toEqual([1, 198]);
  });

  test("fitted values ignore the aliased column", () => {
    expect(fit.fitted.slice(0, 2)).toEqual([0.9605202881720496, -0.80585519635618263]);
  });
});

describe("lm() — fixture 4d, missing values", () => {
  const holed = {
    ...moderationData,
    y: moderationData.y.map((v, i) => (i === 2 ? Number.NaN : v)),
    x: moderationData.x.map((v, i) => (i === 4 ? Number.NaN : v)),
  };
  const fit = lm(holed, { outcome: "y", terms: ["x", "z", ["x", "z"]] });

  test("fits the complete rows, as na.omit does", () => {
    expect(values(fit.coefficients)).toEqual([
      -0.043464456591341946, 0.47232152274800415, 0.31221938676247363,
      0.8480666406012124,
    ]);
    expect(fit.dfResidual).toBe(194);
    expect(fit.rows.length).toBe(198);
    relativelyClose(fit.rSquared, 0.92002297117824028);
  });

  test("pads the fit with NaN in input order, as na.exclude does", () => {
    expect(fit.fitted.length).toBe(200);
    expect(fit.fitted.slice(0, 6)).toEqual([
      -9.3034904558486371, -1.0078650771569042, Number.NaN, 6.2619194140016239,
      Number.NaN, -0.44804203019077071,
    ]);
    expect(fit.residuals.slice(0, 6)).toEqual([
      2.0305932557774411, -0.8289853333967192, Number.NaN, -0.17336916678580003,
      Number.NaN, -0.9565057132942042,
    ]);
  });
});

describe("lm() — fixture 4e, agreement with linearRegression", () => {
  test("y ~ x gives the simple regression's intercept and slope", () => {
    const fit = lm(moderationData, { outcome: "y", terms: ["x"] });
    expect(values(fit.coefficients)).toEqual([-0.29054220305114831, 0.45627294314681255]);
    const simple = linearRegression(
      moderationData.y.map((y, i) => ({ x: moderationData.x[i] as number, y })),
    );
    expect(simple).not.toBeNull();
    relativelyClose(simple?.intercept as number, lookup(fit.coefficients, "(Intercept)") as number);
    relativelyClose(simple?.slope as number, lookup(fit.coefficients, "x") as number);
    relativelyClose(simple?.rSquared as number, fit.rSquared);
  });
});

describe("lm() — refusals", () => {
  test("every row incomplete, in R's words — fixture 4f", () => {
    expect(() => lm({ y: [Number.NaN, Number.NaN], x: [1, 2] }, { outcome: "y", terms: ["x"] })).toThrow(
      /0 \(non-NA\) cases/,
    );
  });

  test("an absent column", () => {
    expect(() => lm(moderationData, { outcome: "y", terms: ["nope"] })).toThrow(/"nope"/);
  });
});

describe("lm() — fixture 4g, the edges of the residual degrees of freedom", () => {
  const saturated = { y: [1, 3, 2], x: [1, 2, 3], z: [2, 1, 4] };

  test("a saturated fit reports NaN for sigma, adjusted R² and every standard error", () => {
    const fit = lm(saturated, { outcome: "y", terms: ["x", "z"] });
    expect(values(fit.coefficients)).toEqual([
      1.2500000000000002, 1.2499999999999998, -0.74999999999999989,
    ]);
    expect(fit.rank).toBe(3);
    expect(fit.dfResidual).toBe(0);
    expect(fit.rSquared).toBe(1);
    expect(fit.sigma).toBeNaN();
    expect(fit.adjRSquared).toBeNaN();
    fit.standardErrors.values.forEach((se) => expect(se).toBeNaN());
    expect(fit.fStatistic?.value).toBeNaN();
    expect(fit.fStatistic?.numdf).toBe(2);
    expect(fit.fStatistic?.dendf).toBe(0);
    fit.residuals.forEach((residual) => expect(residual).toBe(0));
  });

  test("no intercept: R² is over the uncentered fit, so mss is the plain sum of squares", () => {
    const fit = lm(moderationData, { outcome: "y", terms: ["x"], intercept: false });
    expect(values(fit.coefficients)).toEqual([0.4604943433948091]);
    expect(fit.coefficients.names).toEqual(["x"]);
    relativelyClose(fit.rSquared, 0.060943071659733311);
    relativelyClose(fit.adjRSquared, 0.056224192622847613);
    relativelyClose(fit.sigma, 3.5247748975840953);
    relativelyClose(fit.fStatistic?.value as number, 12.914734873126323);
    expect(fit.fStatistic?.numdf).toBe(1);
    expect(fit.fStatistic?.dendf).toBe(199);
  });

  test("intercept only: summary.lm() reports 0 for both R² and no F statistic", () => {
    const fit = lm(moderationData, { outcome: "y", terms: [] });
    expect(values(fit.coefficients)).toEqual([-0.31562302098439893]);
    expect(fit.rSquared).toBe(0);
    expect(fit.adjRSquared).toBe(0);
    relativelyClose(fit.sigma, 3.6235641115369814);
    expect(fit.fStatistic).toBeNull();
  });
});

describe("lm() — the fma option (plan 004, slice 0)", () => {
  const model = { outcome: "y", terms: ["x", "z", "w", ["x", "z"]] } as const;
  const standard = lm(moderationData, { ...model, terms: [...model.terms] });
  const plain = lm(moderationData, { ...model, terms: [...model.terms], fma: false });

  /**
   * The two arithmetic paths round each product a different number of times,
   * so they agree to a few units in the last place, not bit for bit. See the
   * README's linear algebra section for the measured spread.
   */
  const AGREEMENT = 1e-14;

  test("the default still pins R's coefficients exactly", () => {
    const asked = lm(moderationData, { ...model, terms: [...model.terms], fma: true });
    expect(values(asked.coefficients)).toEqual([
      -0.046252109941790048, 0.47180209229612374, 0.31363421997396679,
      -0.003665271584484884, 0.84815858062951188,
    ]);
  });

  test("a plain fit gives the same coefficients, names and rank", () => {
    expect(plain.coefficients.names).toEqual([...standard.coefficients.names]);
    expect(plain.rank).toBe(standard.rank);
    expect(plain.dfResidual).toBe(standard.dfResidual);
    values(standard.coefficients).forEach((expected, index) => {
      relativelyClose(
        values(plain.coefficients)[index] as number,
        expected as number,
        AGREEMENT,
      );
    });
  });

  test("a plain fit gives the same fitted values and residuals", () => {
    expect(plain.fitted.length).toBe(standard.fitted.length);
    standard.fitted.forEach((expected, index) => {
      relativelyClose(plain.fitted[index] as number, expected, AGREEMENT);
    });
    standard.residuals.forEach((expected, index) => {
      relativelyClose(plain.residuals[index] as number, expected, AGREEMENT);
    });
  });

  test("a plain fit gives the same standard errors, R² and sigma", () => {
    values(standard.standardErrors).forEach((expected, index) => {
      relativelyClose(
        values(plain.standardErrors)[index] as number,
        expected as number,
        AGREEMENT,
      );
    });
    relativelyClose(plain.rSquared, standard.rSquared, AGREEMENT);
    relativelyClose(plain.sigma, standard.sigma, AGREEMENT);
  });

  test("refuses an fma that is not a boolean", () => {
    expect(() =>
      lm(moderationData, {
        ...model,
        terms: [...model.terms],
        fma: 1 as unknown as boolean,
      }),
    ).toThrow(TypeError);
  });
});

describe("predictLm() — fixture 8, R's predict.lm() over a new frame", () => {
  /** Fixture 8's new frame `nd`. It carries no outcome column, as R's does not. */
  const nd = {
    x: [-1, 0, 0.5, 2, 1.25],
    z: [0.5, -0.25, 1, -1, 0],
    w: [2, 1, -0.5, 0.75, -1.5],
  };

  /** The fit of section 4a and 8a, `y ~ x * z + w`. */
  const withControl = lm(moderationData, {
    outcome: "y",
    terms: ["x", "z", "w", ["x", "z"]],
  });
  /** The fit of section 4b and 8b, `y ~ x + z - 1`. */
  const noIntercept = lm(moderationData, {
    outcome: "y",
    terms: ["x", "z"],
    intercept: false,
  });
  /** The fit of section 4h and 8c, `y ~ x * z`, the moderation demo's model. */
  const moderation = lm(moderationData, {
    outcome: "y",
    terms: ["x", "z", ["x", "z"]],
  });

  test("the fit records the model it was built from", () => {
    expect(withControl.model.outcome).toBe("y");
    expect(withControl.model.terms).toEqual(["x", "z", "w", ["x", "z"]]);
    // The flag is the one the fit used, so a default reads as true.
    expect(withControl.model.intercept).toBe(true);
    expect(noIntercept.model.terms).toEqual(["x", "z"]);
    expect(noIntercept.model.intercept).toBe(false);
  });

  test("fixture 8a: y ~ x * z + w predicts nd bit for bit", () => {
    expect(predictLm(withControl, nd)).toEqual([
      -0.792646925734656, -0.12832593651976662, 0.92919508228723702,
      -1.1153482602708968, 0.54899841280509187,
    ]);
  });

  test("fixture 8b: the no-intercept fit predicts nd bit for bit", () => {
    expect(predictLm(noIntercept, nd)).toEqual([
      -0.18071596973512427, -0.16588812261796826, 0.91979859795740349,
      0.36143193947024854, 0.64061526871382601,
    ]);
  });

  test("fixture 8c: y ~ x * z predicts nd bit for bit", () => {
    expect(predictLm(moderation, nd)).toEqual([
      -0.78458977416299436, -0.12369957138455989, 0.9284241010678238,
      -1.1112524068949277, 0.54472295005409754,
    ]);
  });

  test("fixture 8d: a row with a missing value gives NaN, as R gives NA", () => {
    const holed = { ...nd, x: nd.x.map((v, i) => (i === 2 ? Number.NaN : v)) };
    expect(predictLm(withControl, holed)).toEqual([
      -0.792646925734656, -0.12832593651976662, Number.NaN,
      -1.1153482602708968, 0.54899841280509187,
    ]);
  });

  test("fixture 8e: a frame that lacks a column the terms need, in R's words", () => {
    const withoutW = { x: nd.x, z: nd.z };
    expect(() => predictLm(withControl, withoutW)).toThrow(RangeError);
    expect(() => predictLm(withControl, withoutW)).toThrow("object 'w' not found");
  });

  test("fixture 8f: an aliased coefficient adds nothing, whatever the new frame holds", () => {
    const aliased = {
      y: moderationData.y,
      x: moderationData.x,
      x2: moderationData.x.map((v) => 2 * v),
    };
    const fit = lm(aliased, { outcome: "y", terms: ["x", "x2"] });
    expect(values(fit.coefficients)).toEqual([
      -0.29054220305114831, 0.45627294314681255, null,
    ]);

    const expected = [
      -0.74681514619796086, -0.29054220305114831, -0.062405731477742032,
      0.62200368324247679, 0.27979897588236735,
    ];
    // R stays silent for a frame that keeps x2 = 2 * x, and warns for one
    // that breaks the relation. Both give these numbers, because the aliased
    // column never enters the product, and a library cannot warn.
    const keepsTheRelation = { x: nd.x, x2: nd.x.map((v) => 2 * v) };
    const breaksTheRelation = { x: nd.x, x2: [-2, 0, 1, 3, 2.5] };
    expect(predictLm(fit, keepsTheRelation)).toEqual(expected);
    expect(predictLm(fit, breaksTheRelation)).toEqual(expected);
  });

  test("fixture 8g: predicting the training frame is not the fitted values", () => {
    const predicted = predictLm(moderation, moderationData);
    expect(predicted.length).toBe(200);
    expect(predicted.slice(0, 5)).toEqual([
      -9.3130443937296761, -1.0085002297724956, 2.4752805151804051,
      6.2660758865938178, -2.415744455456081,
    ]);
    expect(moderation.fitted.slice(0, 5)).toEqual([
      -9.3130443937296636, -1.0085002297724963, 2.4752805151804269,
      6.2660758865938044, -2.4157444554560819,
    ]);

    const differences = predicted.map((value, index) =>
      Math.abs(value - (moderation.fitted[index] as number)),
    );
    expect(differences.filter((d) => d !== 0).length).toBe(189);
    expect(Math.max(...differences)).toBeLessThanOrEqual(2.1760371282653068e-14);
  });

  test("the fma option: plain arithmetic agrees with the default", () => {
    const standard = predictLm(withControl, nd);
    const plain = predictLm(withControl, nd, { fma: false });
    expect(plain.length).toBe(standard.length);
    standard.forEach((expected, index) => {
      relativelyClose(plain[index] as number, expected, 1e-14);
    });
  });
});
