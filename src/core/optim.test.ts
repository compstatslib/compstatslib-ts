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

  test("3a: with the analytic gradient it reaches R's optimum", () => {
    // The bar here is 1e-4, not the 1e-6 the other analytic runs meet. The
    // fixture note explains why: the likelihood is flat near its maximum, and
    // R's optim stops on reltol 5.3e-5 short of the true optimum, where glm's
    // IRLS lands. This port stops on the gradient, so it lands on glm's point
    // and reads a value 1.9e-9 below R's. The last assertion holds it to that:
    // the run may not do worse than R's optim.
    const result = optim(start, negativeLogLikelihood, {
      gr: negativeLogLikelihoodGradient,
    });
    expectParCloseToR(result.par, [-0.33829959201916576, 1.3533969489399535], 1e-4);
    expectCloseToR(result.value, 4.3351114392059635, 1e-8);
    expect(result.value).toBeLessThanOrEqual(4.3351114392059635);
    expectParCloseToR(result.par, [-0.33835288042773098, 1.3534115217109235], 1e-6);
    expect(result.convergence).toBe(0);
    expect(result.message).toBeNull();
    expectPlausibleCounts(result.counts);
  });

  test("3b: without a gradient it stays near R's optim, not near glm", () => {
    // The likelihood is flat near its maximum. R's optim and glm's IRLS stop
    // on different rules and their coefficients differ by 5e-5, so the bar
    // here is R's optim run 3b.
    const result = optim(start, negativeLogLikelihood);
    expectParCloseToR(result.par, [-0.33829964955531128, 1.3533971783013963], 1e-4);
    expectCloseToR(result.value, 4.3351114392007162, 1e-8);
    expect(result.convergence).toBe(0);
    expectPlausibleCounts(result.counts);
  });
});

// ---------------------------------------------------------------------------
// Section 4 — a stationary start
// ---------------------------------------------------------------------------

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
