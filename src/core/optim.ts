/**
 * General-purpose minimization, the port of R's `optim(method = "BFGS")`.
 *
 * R's `optim` is the workhorse behind every model this package cannot fit in
 * closed form. This port offers the one method a caller here has needed,
 * BFGS, in R's call shape: a starting vector, an objective, an optional
 * gradient, and a `control` list. It returns R's fields, `par`, `value`,
 * `counts`, `convergence` and `message`, plus the gradient norm it stopped
 * at.
 *
 * Verified against R in `optim.test.ts`. The pinned values come from
 * `.claude/plans/004-PLAN-seminr-utilities/optim-fixtures.md`, the captured
 * output of `../compstatslib/conformance-fixtures/optim.R`.
 *
 * How far this stands from R. R runs Nash's algorithm 21: Nash's line search,
 * and a relative tolerance on the objective as the sole stopping rule. This
 * port carries over the quasi-Newton routine written for `seminr-ts`
 * (`../../sem-in-r/seminr-ts/src/math/optimize.ts`), which differs in four
 * ways that a reader must know about:
 *
 * - The line search is Armijo backtracking, which halves the step until the
 *   objective falls by enough. Nash's search fits a parabola instead.
 * - The stopping rule reads the gradient first. A run converges when the
 *   largest absolute gradient element falls below `gradTol`. R's `reltol`
 *   stands behind it: a run whose objective stops improving on R's bound
 *   stops as well, and counts as converged, as it does in R. Read `gradNorm`
 *   to see how small the gradient was. A run without `gr` needs that
 *   reading, because a finite-difference gradient has a noise floor of its
 *   own, which the fixture's Rosenbrock case shows at about 2e-6.
 * - A search direction that does not go downhill resets the inverse Hessian
 *   to the identity, which restarts the method from steepest descent. A line
 *   search that finds no step downhill does the same. When even the gradient
 *   direction offers no step downhill, the run stops, and it counts as
 *   converged only if the gradient is below the looser `stallGradTol`. A
 *   larger gradient there means the objective is too rough for the method to
 *   read.
 * - The counts therefore differ from R's. A different line search asks for a
 *   different number of evaluations. Read `counts` as this port's own work,
 *   not as a number to compare with R.
 *
 * What does not differ is where the runs land. On the fixture cases with an
 * analytic gradient, `par` agrees with R to 1e-6 and `value` to 1e-10. The
 * one exception is the logistic fit, whose likelihood is flat near its
 * maximum. There R's own `optim` stops 5e-5 short of the optimum, and this
 * port reaches the point `glm()` reports.
 *
 * The counts follow R's own accounting. A gradient asked for without `gr` is
 * built from central finite differences, and those objective evaluations
 * count as one gradient call, not as function calls, which is how R reports a
 * stationary start as one call of each.
 */

import { sum, zipWith } from "./arith";
import type { Vector } from "./linalg/vector";

/** R's `control` list, with the two tolerances this port adds. */
export interface OptimControl {
  /** The cap on iterations. R's BFGS default is 100. */
  readonly maxit?: number;
  /**
   * The step of the central finite differences used when `gr` is absent.
   * One step for all parameters, or one per parameter. R's default is 1e-3,
   * which is coarse enough to show in the answer. See the fixture note on
   * Rosenbrock.
   */
  readonly ndeps?: number | Vector;
  /**
   * The relative improvement below which the objective counts as stalled.
   * R stops on this rule alone. Here it stands behind the gradient rule: a
   * run stalled for eight iterations in a row stops as converged. R's
   * default is the square root of the machine epsilon.
   */
  readonly reltol?: number;
  /**
   * The convergence bound on the largest absolute gradient element. This
   * port's own rule, carried over from `seminr-ts`.
   */
  readonly gradTol?: number;
  /**
   * The gradient bound that a run must meet to count as converged when no
   * step downhill is left at all. This port's own rule, carried over from
   * `seminr-ts`.
   */
  readonly stallGradTol?: number;
}

/** The optional arguments of R's `optim`, for the one method offered here. */
export interface OptimOptions {
  /** The gradient. Left out, central finite differences stand in for it. */
  readonly gr?: (par: number[]) => number[];
  /** The method. Only `"BFGS"` is offered. */
  readonly method?: "BFGS";
  /** R's `control` list. */
  readonly control?: OptimControl;
}

/** What R's `optim` returns, plus the gradient norm the run stopped at. */
export interface OptimResult {
  /** The best parameters found. */
  readonly par: number[];
  /** The objective at `par`. */
  readonly value: number;
  /** How often the objective and the gradient were asked for. */
  readonly counts: { readonly function: number; readonly gradient: number };
  /** 0 when the run converged, 1 when it reached `maxit`, as in R. */
  readonly convergence: 0 | 1;
  /** R carries a string here for some methods. BFGS leaves it empty. */
  readonly message: string | null;
  /** The largest absolute gradient element at `par`. */
  readonly gradNorm: number;
}

/** R's BFGS defaults, and the two tolerances this port adds. */
const DEFAULT_MAXIT = 100;
const DEFAULT_NDEPS = 1e-3;
const DEFAULT_RELTOL = Math.sqrt(Number.EPSILON);
const DEFAULT_GRAD_TOL = 1e-10;
const DEFAULT_STALL_GRAD_TOL = 1e-6;

/** The Armijo constant, and the cap on halvings of one step. */
const ARMIJO_DECREASE = 1e-4;
const MAX_HALVINGS = 60;

/** How many stalled iterations in a row end the run. */
const STALL_LIMIT = 8;

/** The smallest curvature that still earns an inverse-Hessian update. */
const MIN_CURVATURE = 1e-12;

/** Return the largest absolute element, the infinity norm of a gradient. */
function infinityNorm(gradient: readonly number[]): number {
  return gradient.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
}

/** Spread R's `ndeps` over the parameters, as one step each. */
function resolveSteps(ndeps: number | Vector | undefined, length: number): number[] {
  if (ndeps === undefined) {
    return Array.from({ length }, () => DEFAULT_NDEPS);
  }
  if (typeof ndeps === "number") {
    return Array.from({ length }, () => ndeps);
  }
  if (ndeps.length !== length) {
    throw new RangeError(
      `ndeps must hold one step per parameter, got ${ndeps.length} for ${length}`,
    );
  }
  return [...ndeps];
}

/**
 * Return R's central finite differences, the gradient it uses without `gr`.
 *
 * Each element moves one parameter by its step in both directions. The
 * difference of the two values, over twice the step, is the derivative.
 */
function centralDifferences(
  fn: (par: number[]) => number,
  par: readonly number[],
  steps: readonly number[],
): number[] {
  return par.map((value, index) => {
    const step = steps[index] as number;
    const above = [...par];
    const below = [...par];
    above[index] = value + step;
    below[index] = value - step;
    return (fn(above) - fn(below)) / (2 * step);
  });
}

/** Return an identity matrix of the given order, the first inverse Hessian. */
function identity(order: number): number[][] {
  return Array.from({ length: order }, (_, row) =>
    Array.from({ length: order }, (_, column) => (row === column ? 1 : 0)),
  );
}

/** Multiply a symmetric matrix by a vector, row by row. */
function multiply(matrix: readonly number[][], vector: readonly number[]): number[] {
  return matrix.map((row) => sum(zipWith(row, vector, (a, b) => a * b)));
}

/**
 * Minimize a function of several parameters, R's `optim(method = "BFGS")`.
 *
 * @param par The starting parameters. They are not modified.
 * @param fn The objective to minimize.
 * @param options The gradient, the method, and R's `control` list.
 * @returns R's result fields, plus the gradient norm at the end.
 * @throws RangeError If `method` is anything other than `"BFGS"`, or if a
 *   vector `ndeps` does not hold one step per parameter.
 */
export function optim(
  par: Vector,
  fn: (par: number[]) => number,
  options: OptimOptions = {},
): OptimResult {
  const method = options.method ?? "BFGS";
  if (method !== "BFGS") {
    throw new RangeError(
      `method must be "BFGS", the one method this port offers, got ${String(method)}`,
    );
  }

  const control = options.control ?? {};
  const maxit = control.maxit ?? DEFAULT_MAXIT;
  const reltol = control.reltol ?? DEFAULT_RELTOL;
  const gradTol = control.gradTol ?? DEFAULT_GRAD_TOL;
  const stallGradTol = control.stallGradTol ?? DEFAULT_STALL_GRAD_TOL;
  const steps = resolveSteps(control.ndeps, par.length);
  const order = par.length;

  // The counts follow R: a gradient built from finite differences reports as
  // one gradient call, and the objective evaluations inside it stay hidden.
  let functionCount = 0;
  let gradientCount = 0;
  const objective = (x: number[]): number => {
    functionCount += 1;
    return fn(x);
  };
  const gradientAt = (x: number[]): number[] => {
    gradientCount += 1;
    return options.gr === undefined
      ? centralDifferences(fn, x, steps)
      : options.gr(x);
  };

  /**
   * Halve the step until the objective falls by its Armijo share of the
   * slope. Return the point reached, or null when no step qualifies.
   *
   * Written as an index loop because each pass halves the step of the pass
   * before it, which a `map` cannot carry.
   */
  const lineSearch = (
    from: readonly number[],
    fromValue: number,
    direction: readonly number[],
    slope: number,
  ): { readonly par: number[]; readonly value: number } | null => {
    let step = 1;
    for (let halving = 0; halving < MAX_HALVINGS; halving += 1) {
      const candidate = zipWith(from, direction, (start, move) => start + step * move);
      const candidateValue = objective(candidate);
      if (candidateValue <= fromValue + ARMIJO_DECREASE * step * slope) {
        return { par: candidate, value: candidateValue };
      }
      step /= 2;
    }
    return null;
  };

  let x = [...par];
  let value = objective(x);
  let gradient = gradientAt(x);
  let inverseHessian = identity(order);

  let iterations = 0;
  let converged = infinityNorm(gradient) < gradTol;
  let stalled = 0;

  while (!converged && iterations < maxit) {
    let direction = multiply(inverseHessian, gradient).map((element) => -element);
    let slope = sum(zipWith(direction, gradient, (a, b) => a * b));
    let steepest = false;

    if (slope >= 0) {
      // The direction climbs, which means the stored curvature has broken
      // down. Drop it and restart the method from steepest descent.
      inverseHessian = identity(order);
      direction = gradient.map((element) => -element);
      slope = -sum(gradient.map((element) => element * element));
      steepest = true;
    }

    if (slope === 0) {
      // The gradient is zero, so no direction goes downhill.
      converged = true;
      break;
    }

    let taken = lineSearch(x, value, direction, slope);
    if (taken === null && !steepest) {
      // The stored curvature pointed where the objective does not fall.
      // Drop it and search along the gradient itself.
      inverseHessian = identity(order);
      direction = gradient.map((element) => -element);
      slope = -sum(gradient.map((element) => element * element));
      taken = slope === 0 ? null : lineSearch(x, value, direction, slope);
    }
    if (taken === null) {
      // Not one step down the gradient lowers the objective. Below the
      // looser bound that is a stationary point. Above it the objective is
      // too rough for the method to read, and the run reports failure.
      converged = infinityNorm(gradient) < stallGradTol;
      break;
    }

    const candidate = taken.par;
    const candidateValue = taken.value;

    // R's `reltol` rule, read as a stall test rather than as the sole
    // stopping rule.
    stalled = value - candidateValue <= reltol * (Math.abs(value) + reltol) ? stalled + 1 : 0;

    const candidateGradient = gradientAt(candidate);
    const move = zipWith(candidate, x, (to, from) => to - from);
    const change = zipWith(candidateGradient, gradient, (to, from) => to - from);
    const curvature = sum(zipWith(move, change, (a, b) => a * b));

    if (curvature > MIN_CURVATURE) {
      // The BFGS update of the inverse Hessian,
      // H = (I - r s yᵀ) H (I - r y sᵀ) + r s sᵀ with r = 1 / sᵀy.
      // Written as index loops: every element of the new matrix reads four
      // vectors and the old matrix at the same pair of indices, and a
      // `map` over rows and columns would rebuild those reads element by
      // element without making the algebra any clearer.
      const rate = 1 / curvature;
      const hessianChange = multiply(inverseHessian, change);
      const changeCurvature = sum(zipWith(change, hessianChange, (a, b) => a * b));
      const updated: number[][] = Array.from({ length: order }, () =>
        new Array<number>(order).fill(0),
      );
      for (let row = 0; row < order; row += 1) {
        for (let column = 0; column < order; column += 1) {
          const moveRow = move[row] as number;
          const moveColumn = move[column] as number;
          (updated[row] as number[])[column] =
            (inverseHessian[row] as number[])[column] as number -
            rate * (moveRow * (hessianChange[column] as number) +
              (hessianChange[row] as number) * moveColumn) +
            rate * rate * changeCurvature * moveRow * moveColumn +
            rate * moveRow * moveColumn;
        }
      }
      inverseHessian = updated;
    }

    x = candidate;
    value = candidateValue;
    gradient = candidateGradient;
    iterations += 1;
    converged = infinityNorm(gradient) < gradTol;

    if (!converged && stalled >= STALL_LIMIT) {
      // The objective has stopped improving on R's own bound. R stops here
      // and calls the run a success, and so does this port. A run without
      // `gr` needs that: its gradient carries the truncation error of the
      // finite differences, so the norm can hold above `gradTol` at a point
      // the objective cannot improve on. `gradNorm` reports where it stood.
      converged = true;
      break;
    }
  }

  return {
    par: x,
    value,
    counts: { function: functionCount, gradient: gradientCount },
    convergence: converged ? 0 : 1,
    message: null,
    gradNorm: infinityNorm(gradient),
  };
}
