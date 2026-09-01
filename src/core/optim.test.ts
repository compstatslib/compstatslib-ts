/**
 * Tests for `optim(method = "BFGS")`, the port of R's quasi-Newton minimizer.
 *
 * Every expected value below comes from R 4.5.3, printed at full double
 * precision with `sprintf("%.17g", x)`. Do not edit these numbers by hand.
 * Source: `.claude/plans/004-PLAN-seminr-utilities/optim-fixtures.md`, all
 * five sections. The R script that produced them is
 * `../compstatslib/conformance-fixtures/optim.R`.
 *
 * R's BFGS is Nash's algorithm 21 with Nash's line search and a relative
 * tolerance on the function value. This port uses an Armijo backtracking line
 * search and a gradient-norm stopping rule, so it reaches the same optimum by
 * another path. That fixes what the fixture can pin:
 *
 * - `par` at 1e-6 and `value` at 1e-10 on the runs with an analytic gradient,
 *   and `convergence` exactly. Those are properties of the optimum.
 * - `counts` only for the stationary start of section 4, where R evaluates the
 *   function once and the gradient once and stops. Every other case asserts
 *   that both counts are positive whole numbers, because the line search
 *   differs and the call totals with it.
 * - The finite-difference runs by shape. R's default step is `ndeps = 1e-3`,
 *   which is coarse, so its Rosenbrock answer (1b) is only good to about 2e-4
 *   in `par`. A port with the same step lands near it, not on it.
 *
 * The four cases at the foot of this file come from seminr-ts's own tests for
 * the `bfgs` routine this port carries over
 * (`../../sem-in-r/seminr-ts/tests/math/optimize.test.ts`). They hold no R
 * values. They guard the behavior seminr-ts relies on today.
 */

import { describe, expect, test } from "bun:test";

import { sum } from "./arith.js";
import { optim } from "./optim.js";

/** Assert that a value agrees with R to a relative tolerance. */
function expectCloseToR(actual: number, expected: number, tolerance: number): void {
  const bound = tolerance * Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(bound);
}

/** Assert that a parameter vector agrees with R's, element by element. */
function expectParCloseToR(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    expectCloseToR(value, expected[index] as number, tolerance);
  });
}

/**
 * The bar the counts meet on every run but the stationary start: two positive
 * whole numbers. The port's line search is not R's, so the totals are its own.
 */
function expectPlausibleCounts(counts: { readonly function: number; readonly gradient: number }): void {
  expect(Number.isInteger(counts.function)).toBe(true);
  expect(Number.isInteger(counts.gradient)).toBe(true);
  expect(counts.function).toBeGreaterThan(0);
  expect(counts.gradient).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// The objectives, copied from the fixture script.
// ---------------------------------------------------------------------------

/** Rosenbrock's banana valley: `100 (x2 - x1²)² + (1 - x1)²`. */
function rosenbrock(p: number[]): number {
  const x1 = p[0] as number;
  const x2 = p[1] as number;
  return 100 * (x2 - x1 * x1) ** 2 + (1 - x1) ** 2;
}

/** The analytic gradient of `rosenbrock`. */
function rosenbrockGradient(p: number[]): number[] {
  const x1 = p[0] as number;
  const x2 = p[1] as number;
  return [-400 * x1 * (x2 - x1 * x1) - 2 * (1 - x1), 200 * (x2 - x1 * x1)];
}

/** A convex quadratic with a cross term, minimized at `c(1, -2)`. */
function quadratic(p: number[]): number {
  const u = (p[0] as number) - 1;
  const v = (p[1] as number) + 2;
  return 2 * u * u + v * v + 0.5 * u * v;
}

/** The analytic gradient of `quadratic`. */
function quadraticGradient(p: number[]): number[] {
  const u = (p[0] as number) - 1;
  const v = (p[1] as number) + 2;
  return [4 * u + 0.5 * v, 2 * v + 0.5 * u];
}

/** The ten observations of the logistic fit, section 3 of the fixture. */
const LOGISTIC_X = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5];
const LOGISTIC_Y = [0, 0, 0, 1, 0, 1, 0, 1, 1, 1];

/** The negative log-likelihood of the two-parameter logistic model. */
function negativeLogLikelihood(b: number[]): number {
  const intercept = b[0] as number;
  const slope = b[1] as number;
  const eta = LOGISTIC_X.map((x) => intercept + slope * x);
  return (
    sum(eta.map((e) => Math.log1p(Math.exp(e)))) -
    sum(eta.map((e, index) => (LOGISTIC_Y[index] as number) * e))
  );
}

/** The analytic gradient of `negativeLogLikelihood`. */
function negativeLogLikelihoodGradient(b: number[]): number[] {
  const intercept = b[0] as number;
  const slope = b[1] as number;
  const residual = LOGISTIC_X.map((x, index) => {
    const p = 1 / (1 + Math.exp(-(intercept + slope * x)));
    return p - (LOGISTIC_Y[index] as number);
  });
  return [sum(residual), sum(residual.map((r, index) => r * (LOGISTIC_X[index] as number)))];
}

// ---------------------------------------------------------------------------
// Section 1 — Rosenbrock
// ---------------------------------------------------------------------------

describe("optim on Rosenbrock (fixture section 1)", () => {
  const start = [-1.2, 1];

  test("the objective and its gradient match R at the start", () => {
    expectCloseToR(rosenbrock(start), 24.199999999999996, 1e-15);
    expectParCloseToR(
      rosenbrockGradient(start),
      [-215.59999999999999, -87.999999999999986],
      1e-15,
    );
  });

  test("1a: with the analytic gradient it reaches R's optimum", () => {
    const result = optim(start, rosenbrock, { gr: rosenbrockGradient });
    expectParCloseToR(result.par, [0.99999999690491426, 0.99999999379741933], 1e-6);
    expectCloseToR(result.value, 9.5949545448136196e-18, 1e-10);
    expect(result.convergence).toBe(0);
    expect(result.message).toBeNull();
    expectPlausibleCounts(result.counts);
    expect(Number.isFinite(result.gradNorm)).toBe(true);
    expect(result.gradNorm).toBeGreaterThanOrEqual(0);
  });

  test("1d: a tighter reltol still lands on the same optimum", () => {
    const result = optim(start, rosenbrock, {
      gr: rosenbrockGradient,
      control: { reltol: 1e-12 },
    });
    expectParCloseToR(result.par, [1.0000000000001319, 1.0000000000002658], 1e-6);
    expectCloseToR(result.value, 1.8471375310976297e-26, 1e-10);
    expect(result.convergence).toBe(0);
    expect(result.message).toBeNull();
    expectPlausibleCounts(result.counts);
  });

  test("1b: without a gradient it converges to the shape R reports", () => {
    // R's default step is ndeps = 1e-3, so its own answer is good to about
    // 2e-4 in par and 4e-8 in value. This case pins the shape, not the digits.
    const result = optim(start, rosenbrock);
    expect(result.convergence).toBe(0);
    expect(result.message).toBeNull();
    expect(result.value).toBeLessThan(1e-7);
    expectParCloseToR(result.par, [1, 1], 1e-3);
    expectPlausibleCounts(result.counts);
  });

  test("1c: five iterations stop on the cap with convergence 1", () => {
    const result = optim(start, rosenbrock, {
      gr: rosenbrockGradient,
      control: { maxit: 5 },
    });
    expect(result.convergence).toBe(1);
    expect(result.message).toBeNull();
    expectPlausibleCounts(result.counts);
  });
});

// ---------------------------------------------------------------------------
// Section 2 — a convex quadratic
// ---------------------------------------------------------------------------

describe("optim on a convex quadratic (fixture section 2)", () => {
  const start = [5, -3];
  const rPar = [0.99999999997173594, -1.9999999999409681];
  const rValue = 4.2483812898510989e-21;

  test("the objective and its gradient match R at the start", () => {
    expectCloseToR(quadratic(start), 31, 1e-15);
    expectParCloseToR(quadraticGradient(start), [15.5, 0], 1e-15);
  });

  test("2a: with the analytic gradient it reaches R's optimum", () => {
    const result = optim(start, quadratic, { gr: quadraticGradient });
    expectParCloseToR(result.par, rPar, 1e-6);
    expectCloseToR(result.value, rValue, 1e-10);
    expect(result.convergence).toBe(0);
    expect(result.message).toBeNull();
    expectPlausibleCounts(result.counts);
  });

  test("2b: without a gradient it reaches the same optimum", () => {
    // Central differences are exact for a quadratic up to rounding, so R's 2b
    // matches its 2a bit for bit.
    const result = optim(start, quadratic);
    expectParCloseToR(result.par, rPar, 1e-6);
    expectCloseToR(result.value, rValue, 1e-10);
    expect(result.convergence).toBe(0);
    expectPlausibleCounts(result.counts);
  });

  test("the finite-difference gradient follows the analytic one", () => {
    // The module exports no gradient helper, so the finite differences are
    // read through the run they drive. The quadratic is the case that isolates
    // them: central differences carry no truncation error here, so the two
    // runs may only differ by rounding.
    const analytic = optim(start, quadratic, { gr: quadraticGradient });
    const differences = optim(start, quadratic);
    expectParCloseToR(differences.par, analytic.par, 1e-8);
    expect(differences.convergence).toBe(analytic.convergence);
  });
});

// ---------------------------------------------------------------------------
// Section 3 — logistic maximum likelihood
// ---------------------------------------------------------------------------

describe("optim on a logistic fit (fixture section 3)", () => {
  const start = [0, 0];

  test("the objective and its gradient match R at the start", () => {
    expectCloseToR(negativeLogLikelihood(start), 6.9314718055994531, 1e-15);
    expectParCloseToR(negativeLogLikelihoodGradient(start), [0, -4.75], 1e-15);
  });

  /**
   * **The exception the 0.5.0 docstring recorded, now the other way round.**
   *
   * The likelihood is flat near its maximum, and R's `optim` stops about
   * 5.3e-5 short of the point `glm()`'s IRLS reaches. Through 0.5.0 this port
   * ran its own search with a gradient-norm rule and went *past* R to `glm()`'s
   * answer, which the docstring recorded as an advantage. Under `vmmin` it
   * stops where R stops — bit for bit, counts included — which is a step away
   * from the optimum and not toward it. That is correct for this package,
   * which pins R rather than the truth, and it is stated here rather than
   * quietly dropped. A caller fitting a logistic model should reach for
   * `logisticRegression`, which is R's `glm`.
   */
  test("3a: with the analytic gradient it is R's optimum, bit for bit", () => {
    const result = optim(start, negativeLogLikelihood, {
      gr: negativeLogLikelihoodGradient,
    });
    expect(result.par).toEqual([-0.33829959201916576, 1.3533969489399535]);
    expect(result.value).toBe(4.3351114392059635);
    expect(result.counts).toEqual({ function: 21, gradient: 8 });
    expect(result.convergence).toBe(0);
    expect(result.message).toBeNull();

    // Where it now stands relative to `glm()`: 5.3e-5 away in `par`, and
    // 1.9e-9 *above* it in the objective. `gradNorm` reports the gradient it
    // stopped at, 2.6e-4, which is the point of carrying that field —
    // `vmmin` stops on `reltol`, never on the gradient.
    const glmPar = [-0.33835288042773098, 1.3534115217109235];
    expect(Math.abs((result.par[0] as number) - (glmPar[0] as number))).toBeGreaterThan(5e-5);
    expect(result.value).toBeGreaterThan(4.3351114373346951);
    expect(result.gradNorm).toBeGreaterThan(1e-4);
  });

  /**
   * **The one case whose counts are not pinned, and why.**
   *
   * Every other fixture case reproduces R's `fncount` and `grcount` exactly,
   * including the 180 / 62 and 196 / 62 of section 6. This one runs 23 / 8
   * against R's 22 / 8: one extra line-search reduction.
   *
   * It was traced rather than tolerated. Logging every objective evaluation
   * of the run as raw bits, R's and this port's agree exactly through call 16
   * of 54 and part company at call 17, on the **first coordinate of a trial
   * point**, by one unit in the last place — 0.3618690110785126 against
   * 0.36186901107851255. The objective itself is not the cause: it agrees
   * bit for bit at every point either run visits, and section 3a, the same
   * problem with an analytic gradient, reproduces R's `par`, `value` and
   * counts exactly. What differs is the inverse Hessian feeding that trial
   * point, and behind it the arithmetic contraction R's compiler applied
   * inside the BFGS update. Three candidate contractions were tried against
   * the fixtures; each fixed this case and broke a section 6 one, so the port
   * keeps the arrangement that matches R everywhere else and leaves this
   * count unpinned. `par` still lands within 1e-10 of R's.
   */
  test("3b: without a gradient it follows R's 3b to 1e-10", () => {
    const result = optim(start, negativeLogLikelihood);
    expectParCloseToR(result.par, [-0.33829964955531128, 1.3533971783013963], 1e-10);
    expectCloseToR(result.value, 4.3351114392007162, 1e-14);
    expect(result.convergence).toBe(0);
    expect(result.counts.gradient).toBe(8);
    // Within one of R's 22. See the note above.
    expect(Math.abs(result.counts.function - 22)).toBeLessThanOrEqual(1);
  });
});

describe("optim from a stationary start (fixture section 4)", () => {
  const start = [1, -2];

  test("4b: with the analytic gradient it returns the start unchanged", () => {
    const result = optim(start, quadratic, { gr: quadraticGradient });
    expect(result.par).toEqual([1, -2]);
    expect(result.value).toBe(0);
    expect(result.counts.function).toBe(1);
    expect(result.counts.gradient).toBe(1);
    expect(result.convergence).toBe(0);
    expect(result.message).toBeNull();
  });

  test("4a: without a gradient it stops at the start as well", () => {
    // R returns 1.0000000000000002 for the first parameter here. Its
    // finite-difference gradient is not exactly zero, so it takes one tiny
    // step before it stops.
    const result = optim(start, quadratic);
    expectParCloseToR(result.par, [1, -2], 1e-12);
    expectCloseToR(result.value, 0, 1e-12);
    expect(result.counts.function).toBe(1);
    expect(result.counts.gradient).toBe(1);
    expect(result.convergence).toBe(0);
    expect(result.message).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 5 — an unknown method
// ---------------------------------------------------------------------------

/**
 * Section 6 — R's own path, not only R's optimum.
 *
 * `.claude/plans/004-PLAN-seminr-utilities/optim-fixtures.md`, section 6.
 *
 * These pin `counts` exactly. That is the strongest single check available:
 * `fncount` and `grcount` are integers, so they cannot agree by luck the way a
 * converged `par` can. They count the line-search step reductions (`stepredn`
 * 0.2 each), the acceptance test at `acctol` 1e-4, the inverse-Hessian resets
 * on an uphill direction and on `D1 <= 0`, and the periodic restart when
 * `grcount - ilast` exceeds `2n`. A port that gets any of those wrong misses
 * the count even when it lands on the same optimum.
 */
/**
 * The three doubles quoted in `centralDifferences`'s docstring.
 *
 * They are the reason this port forms its finite-difference points from `par`
 * rather than by walking a working copy, and the difference decides whether
 * `counts` matches R. A docstring number that is a double can be pinned, so
 * it is: if the arithmetic ever stops behaving this way, or someone edits the
 * paragraph, this fails rather than the claim quietly becoming false.
 */
describe("the finite-difference points the docstring quotes", () => {
  const v = -1.2;
  const eps = 1e-3;

  test("R's form and the walk reach different doubles", () => {
    expect(v - eps).toBe(-1.2009999999999998);
    expect((v + eps) - 2 * eps).toBe(-1.201);
    expect(v - eps).not.toBe((v + eps) - 2 * eps);
  });

  /**
   * `-1.201` and `-1.2010000000000001` are one value: the first is the
   * shortest round-tripping spelling, the second the 17-digit expansion.
   * Pinned because the docstring quotes both and a reader will meet the
   * second while checking the first.
   */
  test("the two spellings of the walk's value are the same double", () => {
    expect((v + eps) - 2 * eps).toBe(-1.2010000000000001);
    expect(-1.201).toBe(-1.2010000000000001);
  });

  test("the walk does not restore the original", () => {
    expect(((v + eps) - 2 * eps) + eps).toBe(-1.2000000000000002);
    expect(((v + eps) - 2 * eps) + eps).not.toBe(v);
  });
});

describe("section 6 — the vmmin path", () => {
  /** The extended Rosenbrock: four coupled banana valleys, minimum 0 at 1s. */
  const fr5 = (x: readonly number[]): number =>
    sum(
      Array.from({ length: 4 }, (_, i) => {
        const lo = x[i] as number;
        const hi = x[i + 1] as number;
        // Written with explicit products, not `** 2`. R's `^` special-cases
        // an exponent of 2 to `x * x`; JavaScript's `**` goes through pow,
        // which need not give the same last bit, and the line search reads
        // the difference.
        const inner = hi - lo * lo;
        const offset = 1 - lo;
        return 100 * (inner * inner) + offset * offset;
      }),
    );

  const gr5 = (x: readonly number[]): number[] => {
    const g = new Array<number>(5).fill(0);
    for (let i = 0; i < 4; i++) {
      const lo = x[i] as number;
      const hi = x[i + 1] as number;
      g[i] = (g[i] as number) - 400 * lo * (hi - lo * lo) - 2 * (1 - lo);
      g[i + 1] = (g[i + 1] as number) + 200 * (hi - lo * lo);
    }
    return g;
  };

  const start5 = [-1.2, 1, -1.2, 1, -1.2];

  const R_6A_PAR = [
    1.000000000011706, 0.99999999969512587, 0.9999999997482768,
    0.99999999879867152, 0.99999999795489447,
  ];
  const R_6A_VALUE = 8.6683251167254054e-17;

  test("6a five parameters, analytic gradient: R's counts exactly", () => {
    const result = optim(start5, fr5, { gr: gr5 });
    expect(result.counts).toEqual({ function: 180, gradient: 62 });
    expect(result.convergence).toBe(0);
    expectParCloseToR(result.par, R_6A_PAR, 1e-12);
    expectCloseToR(result.value, R_6A_VALUE, 1e-12);
  });

  test("6b raising maxit past the default changes nothing", () => {
    const capped = optim(start5, fr5, { gr: gr5 });
    const raised = optim(start5, fr5, { gr: gr5, control: { maxit: 500 } });
    expect(raised.counts).toEqual(capped.counts);
    expect(raised.par).toEqual(capped.par);
    expect(raised.value).toBe(capped.value);
  });

  /**
   * R's finite-difference gradient spends `2n` objective evaluations per
   * gradient and charges none of them to `fncount`. The extra 16 function
   * calls over 6a are the line search working on a slightly different
   * gradient, not the differencing.
   */
  test("6c no gradient: the differencing is not charged to fncount", () => {
    const result = optim(start5, fr5, { control: { maxit: 500 } });
    expect(result.counts).toEqual({ function: 196, gradient: 62 });
    expect(result.convergence).toBe(0);
    expectParCloseToR(
      result.par,
      [
        0.99996396213931327, 0.99992874317270153, 0.99985853997467755,
        0.99971792941312687, 0.99943592591559705,
      ],
      1e-9,
    );
    expectCloseToR(result.value, 1.0619662463436598e-7, 1e-9);
  });

  /**
   * A finer `ndeps` moves the answer, not the path: the counts are 6a's
   * exactly, and `value` falls from 1.06e-07 to 1.20e-15. R's default step of
   * 1e-3 is the dominant error in a no-gradient run.
   */
  test("6d a finer ndeps keeps R's path and improves the answer", () => {
    const result = optim(start5, fr5, {
      control: { maxit: 500, ndeps: 1e-5 },
    });
    expect(result.counts).toEqual({ function: 180, gradient: 62 });
    expectCloseToR(result.value, 1.2020107265150863e-15, 1e-6);
  });

  test("6e a per-parameter ndeps vector is taken as given", () => {
    const result = optim([5, -3], quadratic, { control: { ndeps: [1e-2, 1e-6] } });
    expect(result.counts).toEqual({ function: 31, gradient: 15 });
    expectParCloseToR(
      result.par,
      [0.99999999997173594, -1.9999999999409679],
      1e-12,
    );
  });

  /**
   * A steeply scaled quadratic from far away. The first direction overshoots,
   * so the line search reduces the step several times before the acceptance
   * test passes and `fncount` runs well ahead of `grcount`.
   */
  test("6f a steep quadratic: the line search reductions are counted", () => {
    const fsteep = (p: readonly number[]): number =>
      1e4 * ((p[0] as number) - 3) ** 2 + 1e-2 * ((p[1] as number) + 7) ** 2;
    const gsteep = (p: readonly number[]): number[] => [
      2e4 * ((p[0] as number) - 3),
      2e-2 * ((p[1] as number) + 7),
    ];
    const result = optim([-40, 900], fsteep, { gr: gsteep });
    expect(result.counts).toEqual({ function: 31, gradient: 10 });
    expectParCloseToR(result.par, [2.9999999999999996, -7], 1e-12);
  });

  /** n = 1: the periodic restart fires every other gradient call. */
  test("6g one parameter, a quartic", () => {
    const result = optim(
      [2],
      (p) => ((p[0] as number) - 1) ** 4,
      { gr: (p) => [4 * ((p[0] as number) - 1) ** 3] },
    );
    expect(result.counts).toEqual({ function: 27, gradient: 25 });
    expectParCloseToR(result.par, [1.0013752674682894], 1e-12);
    expectCloseToR(result.value, 3.5772449545447906e-12, 1e-9);
  });

  /** Flat in the second coordinate, so `D1 <= 0` resets the Hessian. */
  test("6h a flat direction resets the inverse Hessian", () => {
    const result = optim(
      [0, 5],
      (p) => ((p[0] as number) - 2) ** 2,
      { gr: (p) => [2 * ((p[0] as number) - 2), 0] },
    );
    expect(result.counts).toEqual({ function: 4, gradient: 3 });
    expect(result.par).toEqual([2, 5]);
    expect(result.value).toBe(0);
  });

  /**
   * `maxit = 0`: R returns the start, both counts zero — it does not evaluate
   * the objective at all — and still reports `convergence: 0`.
   */
  test("6i maxit = 0 returns the start with both counts zero", () => {
    const result = optim([5, -3], quadratic, { gr: quadraticGradient, control: { maxit: 0 } });
    expect(result.counts).toEqual({ function: 0, gradient: 0 });
    expect(result.par).toEqual([5, -3]);
    expect(result.value).toBe(31);
    expect(result.convergence).toBe(0);
  });
});

describe("optim with an unknown method (fixture section 5)", () => {
  test("5a: any method but BFGS is refused", () => {
    // R lists all six of its methods. This port has one, so it names that one.
    const call = (): unknown =>
      optim([1, 1], rosenbrock, { method: "Nope" as unknown as "BFGS" });
    expect(call).toThrow(RangeError);
    expect(call).toThrow(/BFGS/);
  });
});

// ---------------------------------------------------------------------------
// The seminr-ts cases this port carries over
// ---------------------------------------------------------------------------

describe("optim on seminr-ts's own cases", () => {
  test("it minimizes a convex quadratic exactly", () => {
    const fn = (p: number[]): number =>
      ((p[0] as number) - 1) ** 2 + 2 * ((p[1] as number) + 0.5) ** 2;
    const gr = (p: number[]): number[] => [
      2 * ((p[0] as number) - 1),
      4 * ((p[1] as number) + 0.5),
    ];
    const result = optim([0, 0], fn, { gr });
    expect(result.convergence).toBe(0);
    expectParCloseToR(result.par, [1, -0.5], 1e-8);
    expectCloseToR(result.value, 0, 1e-12);
  });

  test("it minimizes Rosenbrock from the standard start", () => {
    const result = optim([-1.2, 1], rosenbrock, { gr: rosenbrockGradient });
    expect(result.convergence).toBe(0);
    expectParCloseToR(result.par, [1, 1], 1e-6);
  });

  test("it respects maxit and reports non-convergence", () => {
    const result = optim([-1.2, 1], rosenbrock, {
      gr: rosenbrockGradient,
      control: { maxit: 2 },
    });
    expect(result.convergence).toBe(1);
    expect(result.message).toBeNull();
  });

  test("it stays exactly at a stationary start", () => {
    const fn = (p: number[]): number => (p[0] as number) ** 2;
    const gr = (p: number[]): number[] => [2 * (p[0] as number)];
    const result = optim([0], fn, { gr });
    expect(result.convergence).toBe(0);
    expect(result.par).toEqual([0]);
    expect(result.counts.function).toBe(1);
    expect(result.counts.gradient).toBe(1);
  });
});
