/**
 * Principal components of a set of two-dimensional points.
 *
 * This is the statistics half of `plot_pca()` in the R package, which calls
 * `prcomp(mc_points, scale. = FALSE)`. Verified against R in `pca.test.ts`.
 *
 * Three things are worth knowing before reading the code.
 *
 * **The data is always centered.** R's `plot_pca()` has a `meancenter`
 * argument, but it does not decide whether the components are computed on
 * centered data: `prcomp()` centers again on its own, so `sdev`, `rotation`
 * and the scores come out identical either way (fixture F7 shows the two runs
 * bit for bit). All `meancenter` changes is where the arrows are anchored on
 * screen, which is a drawing decision. So this module has no such option, and
 * the plot layer owns the anchor.
 *
 * **The method is a closed form, not R's SVD.** R decomposes the centered
 * data matrix; this port takes the eigenvectors of the 2x2 covariance matrix,
 * which for two dimensions is a few lines of algebra with no iteration. The
 * covariance route squares the data and so gives up a few bits that an SVD
 * keeps, but at two dimensions the results agree with R far inside the
 * tolerance the tests demand.
 *
 * **Signs are this port's own.** `?prcomp` states that the signs of the
 * rotation columns are arbitrary and vary between programs and even between
 * builds of R. Rather than chase LAPACK, this module fixes its own rule: in
 * each column, the loading of larger magnitude is non-negative, and a tie
 * goes to a non-negative x. Nothing on screen changes — `plot_pca()` draws
 * each component as a two-headed arrow through the center, which is symmetric
 * under a sign flip — but a caller reading the numbers gets one answer for
 * one input instead of a platform's answer.
 */

import { mean, sum, withoutNegativeZero, zipWith } from "./arith";
import { completePointRows } from "./regression";
import type { Point } from "./regression";

/**
 * One component's loading vector, as `[x, y]`.
 *
 * These are the two entries of one *column* of R's `rotation` matrix: R
 * prints that matrix with a row per input variable, so R's `rotation["x",
 * "PC1"]` is `rotation[0][0]` here and `rotation["y", "PC1"]` is
 * `rotation[0][1]`.
 */
export type Loadings = readonly [number, number];

/** The components of a point set, in the shape of R's `prcomp` result. */
export interface PcaResult {
  /**
   * The standard deviation along each component, largest first. R's `sdev`,
   * computed with the n − 1 divisor.
   */
  readonly sdev: readonly [number, number];
  /**
   * The two loading vectors: `rotation[0]` is PC1, `rotation[1]` is PC2.
   * They are orthonormal, so `rotation[1]` is `rotation[0]` turned a quarter
   * turn, up to the sign rule described above.
   */
  readonly rotation: readonly [Loadings, Loadings];
  /**
   * The mean of each coordinate — the point the components pass through.
   *
   * R's own `pca$center` reports whatever `prcomp` had left to subtract,
   * which is near zero when `plot_pca()` centered the data first. This field
   * is instead the true column mean, which R prints as `mc_diff`.
   */
  readonly center: Point;
  /**
   * The points in component coordinates, in input order. R's `pca$x`, with
   * `x` holding the PC1 score and `y` the PC2 score. Both coordinates are
   * NaN where the point was dropped for a missing value.
   */
  readonly scores: readonly Point[];
}

/**
 * Compute the two principal components of the points.
 *
 * A single point is a valid input: it has no spread, so both standard
 * deviations are 0 and the components fall back to the coordinate axes,
 * which is what `prcomp` reports for the one component it returns at that
 * size. (R returns `min(n, p)` components and so gives one column there;
 * this port always returns two, matching its behavior on every other
 * degenerate input — see the note on rank below.) `plot_pca()` never gets
 * that far anyway: it draws points and no arrows below three of them.
 *
 * Rank is never reduced. R's `prcomp` drops a component only when given a
 * `tol`, which `plot_pca()` never passes, so collinear, identical and
 * constant-column inputs all still return two components. This function does
 * the same and lets a near-zero `sdev[1]` say that the second direction
 * carries no spread.
 *
 * A point with a non-finite coordinate is dropped before the components are
 * computed, R's `na.omit`; its scores report NaN in both coordinates,
 * keeping input order (the `na.exclude` padding `moderationSurface` uses).
 * R's own `prcomp()` errors on a missing value, so the R usage this mirrors
 * is `prcomp(na.omit(points))` — the fold-in keeps a spreadsheet with one
 * missing row from blanking the whole picture.
 *
 * @param points The observations. The function does not modify them.
 * @returns The components, or null if no point is complete.
 */
export function principalComponents(
  points: readonly Point[],
): PcaResult | null {
  const rows = completePointRows(points);
  if (rows.length === 0) {
    return null;
  }
  const complete = rows.map((row) => points[row] as Point);

  const centerX = mean(complete.map((point) => point.x));
  const centerY = mean(complete.map((point) => point.y));
  const devX = complete.map((point) => point.x - centerX);
  const devY = complete.map((point) => point.y - centerY);

  // R's `prcomp` divides the singular values by sqrt(max(1, n - 1)), so the
  // variances carry the n - 1 divisor with the same guard at one point.
  const divisor = Math.max(1, complete.length - 1);
  const varX = sum(devX.map((d) => d * d)) / divisor;
  const varY = sum(devY.map((d) => d * d)) / divisor;
  const covariance = sum(zipWith(devX, devY, (dx, dy) => dx * dy)) / divisor;

  const [first, second] = componentsOf(varX, varY, covariance);

  // R's na.exclude padding: scores in input order, NaN where a point was
  // dropped.
  const scores = points.map(() => ({ x: Number.NaN, y: Number.NaN }));
  rows.forEach((row, survivor) => {
    const dx = devX[survivor] as number;
    const dy = devY[survivor] as number;
    scores[row] = {
      x: dx * first.loadings[0] + dy * first.loadings[1],
      y: dx * second.loadings[0] + dy * second.loadings[1],
    };
  });

  return {
    sdev: [sdevOf(first.variance), sdevOf(second.variance)],
    rotation: [first.loadings, second.loadings],
    center: { x: centerX, y: centerY },
    scores,
  };
}

/** One eigenpair of the covariance matrix. */
interface Component {
  readonly variance: number;
  readonly loadings: Loadings;
}

/**
 * Eigendecompose the symmetric 2x2 covariance matrix, larger eigenvalue
 * first.
 *
 * The eigenvalues of `[[a, b], [b, d]]` are `(a + d)/2 ± hypot((a - d)/2, b)`
 * and an eigenvector of `λ` solves `b·vy = (λ − a)·vx`.
 *
 * A zero off-diagonal is handled on its own path rather than falling out of
 * the formula. It is the case where the components are the coordinate axes
 * exactly — every point sharing one coordinate, which is a classroom input,
 * not a rarity — and the general formula would return the axes only to
 * within a rounding of `hypot`. Taking the branch keeps the answer exact:
 * an axis-aligned rotation of literal 0 and 1, and a literal zero second
 * standard deviation.
 */
function componentsOf(
  varX: number,
  varY: number,
  covariance: number,
): readonly [Component, Component] {
  if (covariance === 0) {
    const alongX: Component = { variance: varX, loadings: [1, 0] };
    const alongY: Component = { variance: varY, loadings: [0, 1] };
    return varX >= varY ? [alongX, alongY] : [alongY, alongX];
  }

  const middle = (varX + varY) / 2;
  const spread = Math.hypot((varX - varY) / 2, covariance);
  const larger = middle + spread;
  const smaller = middle - spread;

  // Both rows of (C − λI) give an eigenvector of the larger eigenvalue. They
  // agree in exact arithmetic; the longer one keeps more digits.
  const fromRowX = larger - varX;
  const fromRowY = larger - varY;
  const direction: Loadings =
    fromRowX >= fromRowY ? [covariance, fromRowX] : [fromRowY, covariance];
  const leading = signed(unit(direction));

  // A quarter turn of the leading direction: orthonormal by construction,
  // with no second normalization to drift from it.
  const trailing = signed([negated(leading[1]), leading[0]]);

  return [
    { variance: larger, loadings: leading },
    { variance: smaller, loadings: trailing },
  ];
}

/** Scale a vector to unit length. */
function unit(vector: Loadings): Loadings {
  const length = Math.hypot(vector[0], vector[1]);
  return [vector[0] / length, vector[1] / length];
}

/**
 * Apply the sign rule: the loading of larger magnitude is non-negative, and a
 * tie goes to a non-negative x.
 */
function signed(vector: Loadings): Loadings {
  const dominant =
    Math.abs(vector[0]) >= Math.abs(vector[1]) ? vector[0] : vector[1];
  return dominant >= 0 ? vector : [negated(vector[0]), negated(vector[1])];
}

/** Negate, mapping zero to positive zero so that no −0 reaches a caller. */
function negated(value: number): number {
  return withoutNegativeZero(-value);
}

/**
 * Turn a variance into a standard deviation.
 *
 * Cancellation can push the smaller eigenvalue a hair below zero on data
 * that has no spread in that direction; the clamp reports the zero that is
 * meant rather than a NaN.
 */
function sdevOf(variance: number): number {
  return Math.sqrt(Math.max(0, variance));
}
