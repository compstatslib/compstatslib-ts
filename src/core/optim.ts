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
 * **This is R's algorithm, not merely R's answer.** The routine below is
 * `vmmin` from R's `src/main/optim.c`, R Core's arrangement of Nash (1990)
 * algorithm 21, followed line for line: Nash's step-reduction line search at
 * `stepredn = 0.2` with the acceptance test
 * `f <= Fmin + gradproj * steplength * acctol` at `acctol = 1e-4`; the
 * `reltest = 10` guard that ends a search when every coordinate stops moving;
 * `reltol` on the objective as the **sole** stopping rule; the inverse
 * Hessian held as a lower triangle and reset to the identity on an uphill
 * direction, on a curvature `D1 <= 0`, and periodically once `grcount`
 * exceeds `ilast` by `2n`; and R's accounting of `fncount` and `grcount`.
 *
 * So `counts` is a value to compare with R's, not this port's own work.
 * `optim.test.ts` pins it exactly on every fixture case, which is the
 * strongest check available here: two integers cannot agree by luck the way a
 * converged `par` can, and a port that misplaces one step reduction or one
 * reset misses them even while landing on the same optimum.
 *
 * Verified against R in `optim.test.ts`. The pinned values come from
 * `.claude/plans/004-PLAN-seminr-utilities/optim-fixtures.md`, the captured
 * output of `../compstatslib/conformance-fixtures/optim.R`; section 6 was
 * added for this routine and reaches the parts of `vmmin` the earlier
 * sections do not.
 *
 * **What moved in 0.6.0.** Through 0.5.0 this was the quasi-Newton routine
 * written for `seminr-ts` (`../../sem-in-r/seminr-ts/src/math/optimize.ts`),
 * with R's `reltol` expression bolted on as a stall test: Armijo backtracking
 * by halves, a gradient-norm convergence rule, and counts that were its own.
 * It reached R's optimum by another path. Every `optim` result therefore moves
 * in this release, and a caller who pinned 0.5.0's output re-pins. Two
 * controls went with it — `gradTol` and `stallGradTol` were this port's own
 * rules and now control nothing — and `abstol`, which is R's and which
 * `vmmin` reads, took their place.
 *
 * One consequence worth stating plainly, because the earlier docstring
 * recorded it as this port's advantage. On the logistic fit of fixture
 * section 3 the likelihood is flat near its maximum; R's own `optim` stops
 * about 5e-5 short of the point `glm()` reaches, and the routine this
 * replaced went past R to `glm()`'s answer. Under `vmmin` the port now stops
 * where R stops. That is correct for this package, which pins R rather than
 * the truth, but it is a step away from the optimum and not toward it. A
 * caller fitting a logistic model should use `logisticRegression`, which is
 * R's `glm` and does not have this property.
 *
 * The finite-difference gradient is R's: central differences at `ndeps`,
 * default 1e-3, taken when `gr` is absent. Its `2n` objective evaluations are
 * **not** charged to `fncount`, which is why R reports a stationary start as
 * one call of each, and why fixture 6c costs 196 function calls where 6a with
 * an analytic gradient costs 180 — the extra 16 are the line search working
 * on a slightly different gradient, not the differencing.
 *
 * **One rounding, in one place.** The build of R the fixtures come from
 * contracts `b[l[i]] = X[i] + steplength * t[i]` — the line search's trial
 * point — into a single hardware fused multiply-add, so this port computes it
 * through `fusedMultiplyAdd` rather than as `X + step * t`. That is not a
 * guess: written plainly, the second trial of fixture 6c lands one unit in
 * the last place away on two of five coordinates, and sixty iterations later
 * the line search has taken two reductions too few and `counts` reads 194
 * against R's 196.
 *
 * The accumulation loops are **not** contracted, and that was measured the
 * same way rather than assumed. Rounding `D1 += t[i] * c[i]`,
 * `D2 += s * c[i]` and the inner products behind them once instead of twice
 * takes fixture 6c back to 194, and contracting the inverse-Hessian update's
 * numerator breaks 6h as well. The arrangement here is the one that
 * reproduces R's counts on every fixture case but one; section 3b's function
 * count runs one ahead of R's, and `optim.test.ts` records where that run
 * parts company with R and why the three candidate fixes were rejected.
 *
 * Index loops throughout, and the inverse Hessian is a lower-triangular
 * `number[][]` rather than a `Matrix`. Both are deliberate: the arithmetic is
 * ported line for line from C, and the order in which the sums accumulate is
 * part of the answer, so `map`/`sum` would obscure the correspondence and
 * risk reassociating it. (CLAUDE.md allows an index loop with a stated
 * reason; that is the reason.) Dropping the `Matrix` also takes `core/linalg`
 * out of this module's import graph, which is why the `./stats` entry does
 * not carry it.
 *
 * Provenance: `vmmin` is R Core's arrangement of Nash (1990), *Compact
 * Numerical Methods for Computers*, algorithm 21. See NOTICE.
 */

import { fusedMultiplyAdd } from "./arith.js";
import type { Vector } from "./linalg/vector.js";

/**
 * R's `control` list for BFGS.
 *
 * **R's defaults are R's, and they are not a hand-rolled optimizer's.** A
 * caller migrating from its own BFGS should set every one of these
 * explicitly rather than inherit them, and `reltol` is the one that bites.
 * R's default is `sqrt(.Machine$double.eps)`, 1.49e-8, where a hand-written
 * routine commonly uses 1e-14. A consumer that inherited it reported its fit
 * stopping **21 iterations early**, at a gradient norm of 1.6e-5 instead of
 * 1.5e-8, moving parameters by 2.5e-4 — five times its own fixture tolerance
 * — and still reporting `convergence: 0`, because stopping on `reltol` *is*
 * convergence in R. `maxit` is the same trap one order down: R's BFGS default
 * is 100, and a run that hits it reports `convergence: 1`.
 */
export interface OptimControl {
  /** The cap on iterations. R's BFGS default is 100. */
  readonly maxit?: number;
  /**
   * The step of the central finite differences used when `gr` is absent.
   * One step for all parameters, or one per parameter. R's default is 1e-3,
   * which is coarse enough to show in the answer: on fixture section 6 it is
   * the dominant error, and 1e-5 takes the same path to a value 1e8 times
   * smaller.
   */
  readonly ndeps?: number | Vector;
  /**
   * The relative improvement below which the run stops. This is `vmmin`'s
   * **only** stopping rule besides `maxit`: a step whose
   * `|f - Fmin| <= reltol * (|Fmin| + reltol)` ends the run, and the run
   * counts as converged. R's default is `sqrt(.Machine$double.eps)`. Read
   * the warning on this interface before inheriting it.
   */
  readonly reltol?: number;
  /**
   * The objective value below which the run stops, whatever the relative
   * improvement. R's default is `-Infinity`, which never fires. R's, and
   * read by `vmmin` in the same test as `reltol`.
   */
  readonly abstol?: number;
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
  /**
   * How often the objective and the gradient were asked for, R's own
   * accounting. These match R exactly; see the module docstring.
   */
  readonly counts: { readonly function: number; readonly gradient: number };
  /** 0 when the run converged, 1 when it reached `maxit`, as in R. */
  readonly convergence: 0 | 1;
  /** R carries a string here for some methods. BFGS leaves it empty. */
  readonly message: string | null;
  /**
   * The largest absolute gradient element at the last gradient `vmmin`
   * asked for, and 0 when it asked for none. Diagnostic only: `vmmin` stops
   * on `reltol`, never on the gradient, so a converged run may leave this
   * well above zero — which is the point of reporting it.
   */
  readonly gradNorm: number;
}

/** R's BFGS `control` defaults. Fixture section 6j prints them from R. */
const DEFAULT_MAXIT = 100;
const DEFAULT_NDEPS = 1e-3;
const DEFAULT_RELTOL = Math.sqrt(Number.EPSILON);
const DEFAULT_ABSTOL = Number.NEGATIVE_INFINITY;

/**
 * The three constants `vmmin` holds and R's `control` list does not expose.
 *
 * `STEP_REDUCTION` is the factor the line search shrinks a rejected step by,
 * `ACCTOL` the share of the projected decrease an accepted step must deliver,
 * and `RELTEST` the offset that decides when a coordinate has stopped moving:
 * `RELTEST + x == RELTEST + candidate` is true once the step is below the
 * spacing of doubles near 10.
 */
const STEP_REDUCTION = 0.2;
const ACCTOL = 0.0001;
const RELTEST = 10.0;

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
 * Each element moves one parameter by its step in both directions, and the
 * difference of the two values over twice the step is the derivative.
 *
 * The two evaluation points are formed **from the original**, `par[i] + eps`
 * and `par[i] - eps`, as `fmingr` in R's `src/main/optim.c` forms them. The
 * tempting alternative — walk one working copy, `x[i] += eps`, then
 * `x[i] -= 2 * eps`, then `x[i] += eps` to restore it — is a different
 * calculation in doubles, and the difference is visible on the third
 * objective evaluation of a run. At `par[0] = -1.2` with `eps = 1e-3`:
 *
 * - R's form, `v - eps`, gives `-1.2009999999999998`.
 * - The walk, `(v + eps) - 2 * eps`, gives `-1.201` — the same double that
 *   prints as `-1.2010000000000001` at 17 significant digits, which is worth
 *   saying because a reader checking this at full precision will otherwise
 *   think one of the two spellings is a typo. They are one value.
 * - Restoring, `((v + eps) - 2 * eps) + eps`, leaves `-1.2000000000000002`
 *   rather than `-1.2`, so the drift persists into the next coordinate.
 *
 * Sixty iterations later that costs two line-search reductions and the counts
 * no longer match R's. Form the points from `par`. All three values are pinned
 * in `optim.test.ts`, so this paragraph cannot drift from the arithmetic.
 *
 * @throws Error If a difference is not finite, in R's own words.
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
    const df = (fn(above) - fn(below)) / (2 * step);
    if (!Number.isFinite(df)) {
      throw new Error(`non-finite finite-difference value [${index + 1}]`);
    }
    return df;
  });
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
 * @throws Error If the objective at the starting parameters is not finite,
 *   in R's own words.
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
  const abstol = control.abstol ?? DEFAULT_ABSTOL;
  const steps = resolveSteps(control.ndeps, par.length);
  const n = par.length;

  // R's `mask` marks the parameters `vmmin` is free to move. `optim()` fills
  // it with TRUE for BFGS, so the index vector `l` it builds is the identity
  // and is dropped here. Every `b[l[i]]` in the C is `b[i]`.

  let functionCount = 0;
  let gradientCount = 0;
  const b = [...par];

  const objective = (x: number[]): number => {
    functionCount += 1;
    return fn(x);
  };
  // R's finite differences spend 2n objective evaluations and charge none of
  // them to `fncount`; only the gradient call itself is counted.
  const gradientAt = (x: number[]): number[] => {
    gradientCount += 1;
    return options.gr === undefined
      ? centralDifferences(fn, x, steps)
      : options.gr(x);
  };

  // `maxit <= 0`: R evaluates the objective once, returns the start, and
  // reports both counts as zero and the run as converged.
  if (maxit <= 0) {
    return {
      par: b,
      value: fn(b),
      counts: { function: 0, gradient: 0 },
      convergence: 0,
      message: null,
      gradNorm: 0,
    };
  }

  let f = objective(b);
  if (!Number.isFinite(f)) {
    throw new Error("initial value in 'vmmin' is not finite");
  }
  let fMin = f;
  // R sets both counts to 1 here: the objective call above, and the gradient
  // call below.
  let g = gradientAt(b);

  // The inverse Hessian, as R holds it: the lower triangle only, read
  // symmetrically. `B[i][j]` for `j <= i`, `B[j][i]` for `j > i`.
  const B: number[][] = Array.from({ length: n }, (_, i) =>
    new Array<number>(i + 1).fill(0),
  );
  const t = new Array<number>(n).fill(0);
  const X = new Array<number>(n).fill(0);
  const c = new Array<number>(n).fill(0);

  let iter = 1;
  let ilast = gradientCount;
  let count = 0;

  do {
    if (ilast === gradientCount) {
      for (let i = 0; i < n; i++) {
        const row = B[i] as number[];
        for (let j = 0; j < i; j++) {
          row[j] = 0;
        }
        row[i] = 1;
      }
    }
    for (let i = 0; i < n; i++) {
      X[i] = b[i] as number;
      c[i] = g[i] as number;
    }

    let gradproj = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j <= i; j++) {
        s -= ((B[i] as number[])[j] as number) * (g[j] as number);
      }
      for (let j = i + 1; j < n; j++) {
        s -= ((B[j] as number[])[i] as number) * (g[j] as number);
      }
      t[i] = s;
      gradproj += s * (g[i] as number);
    }

    if (gradproj < 0) {
      // The search direction goes downhill. Reduce the step by
      // `STEP_REDUCTION` until the objective falls by its `ACCTOL` share of
      // the projected decrease, or until no coordinate moves any more.
      let steplength = 1;
      let accpoint = false;
      do {
        count = 0;
        for (let i = 0; i < n; i++) {
          // One rounding, not two. R's own line here is
          // `b[l[i]] = X[i] + steplength * t[i]`, and the compiler of the
          // build the fixtures come from contracts it into a single fused
          // multiply-add. Written as plain `X + step * t` the trial point
          // lands one unit in the last place away on some coordinates -
          // at the second trial of fixture 6c, on two of five - and sixty
          // iterations later the line search has taken two reductions too
          // few and `counts` no longer matches R.
          b[i] = fusedMultiplyAdd(steplength, t[i] as number, X[i] as number);
          if (RELTEST + (X[i] as number) === RELTEST + (b[i] as number)) {
            count++;
          }
        }
        if (count < n) {
          f = objective(b);
          accpoint =
            Number.isFinite(f) && f <= fMin + gradproj * steplength * ACCTOL;
          if (!accpoint) {
            steplength *= STEP_REDUCTION;
          }
        }
      } while (!(count === n || accpoint));

      // `vmmin`'s only stopping rule: the objective is small enough, or it
      // stopped improving relative to where it stands.
      const enough =
        f > abstol && Math.abs(f - fMin) > reltol * (Math.abs(fMin) + reltol);
      if (!enough) {
        count = n;
        fMin = f;
      }

      if (count < n) {
        // Making progress. Take the step, ask for a gradient, and update the
        // inverse Hessian by BFGS.
        fMin = f;
        g = gradientAt(b);
        iter++;
        let D1 = 0;
        for (let i = 0; i < n; i++) {
          t[i] = steplength * (t[i] as number);
          c[i] = (g[i] as number) - (c[i] as number);
          D1 += (t[i] as number) * (c[i] as number);
        }
        if (D1 > 0) {
          let D2 = 0;
          for (let i = 0; i < n; i++) {
            let s = 0;
            for (let j = 0; j <= i; j++) {
              s += ((B[i] as number[])[j] as number) * (c[j] as number);
            }
            for (let j = i + 1; j < n; j++) {
              s += ((B[j] as number[])[i] as number) * (c[j] as number);
            }
            X[i] = s;
            D2 += s * (c[i] as number);
          }
          D2 = 1 + D2 / D1;
          for (let i = 0; i < n; i++) {
            const row = B[i] as number[];
            for (let j = 0; j <= i; j++) {
              row[j] =
                (row[j] as number) +
                (D2 * (t[i] as number) * (t[j] as number) -
                  (X[i] as number) * (t[j] as number) -
                  (t[i] as number) * (X[j] as number)) /
                  D1;
            }
          }
        } else {
          // The curvature condition failed. Restart from the identity.
          ilast = gradientCount;
        }
      } else if (ilast < gradientCount) {
        // No progress, and the Hessian was not just reset. Reset and retry.
        count = 0;
        ilast = gradientCount;
      }
    } else {
      // The direction goes uphill. Reset unless it has just been reset, in
      // which case there is nothing left to try and the run ends.
      count = 0;
      if (ilast === gradientCount) {
        count = n;
      } else {
        ilast = gradientCount;
      }
    }

    if (iter >= maxit) {
      break;
    }
    if (gradientCount - ilast > 2 * n) {
      // Periodic restart.
      ilast = gradientCount;
    }
  } while (count !== n || ilast !== gradientCount);

  return {
    par: b,
    value: fMin,
    counts: { function: functionCount, gradient: gradientCount },
    convergence: iter < maxit ? 0 : 1,
    message: null,
    gradNorm: infinityNorm(g),
  };
}
