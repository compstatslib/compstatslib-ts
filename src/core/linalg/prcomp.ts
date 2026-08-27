/**
 * R's `prcomp()`: principal components of a matrix or a data frame, any
 * number of variables.
 *
 * R centers (and optionally scales) the columns and takes the singular
 * value decomposition of the result. The port centers and scales the same
 * way and then decomposes the covariance matrix with `eigenSymmetric`: the
 * standard deviations are the square roots of its eigenvalues, the rotation
 * its eigenvectors, and the scores the centered data times the rotation.
 * The two routes agree to a relative `1e-12` on the standard deviations and
 * up to the sign of each component on the rest (plan Q1), which the SVD
 * leaves arbitrary as well; the port's sign rule is `eigenSymmetric`'s.
 * Verified in `prcomp.test.ts`, including agreement with the two-variable
 * `principalComponents` of `pca.ts` on the bundled `pcaDegenerate` points.
 *
 * As `pca.ts` does, the port returns one component per variable and never
 * reduces the rank: a collinear input reports a near-zero standard
 * deviation rather than a shorter result. R's `prcomp` returns `min(n, p)`
 * components, which is the same unless there are fewer rows than columns.
 */

import type { DataFrame } from "../frame";
import { sum } from "../arith";
import { eigenSymmetric } from "./eigen";
import { fromFrame, make, type Matrix } from "./matrix";
import { matmul } from "./ops";

export interface PrcompOptions {
  /** Subtract the column means first. True by default, as R's is. */
  readonly center?: boolean;
  /**
   * Divide each column by its root mean square after centering — its
   * standard deviation, when centered. False by default, as R's is.
   */
  readonly scale?: boolean;
}

/** R's `prcomp` result. */
export interface Prcomp {
  /** The standard deviation along each component, largest first. */
  readonly sdev: readonly number[];
  /**
   * The loadings: one row per variable, one column per component, named
   * `PC1`, `PC2`, … with the variable names as row names when the input
   * has column names.
   */
  readonly rotation: Matrix;
  /** The value subtracted from each column; zeros when not centered. */
  readonly center: readonly number[];
  /** The value each column was divided by, or null when not scaled. */
  readonly scale: readonly number[] | null;
  /**
   * The scores: the centered, scaled data in component coordinates, with
   * the row names of the input and `PC1`, `PC2`, … as column names, as R's
   * are (fixture 5e).
   */
  readonly x: Matrix;
}

/**
 * Compute the principal components, as R's `prcomp()` does.
 *
 * @param input A matrix with one column per variable, or a data frame whose
 *   numeric columns are the variables.
 * @param options Whether to center and whether to scale.
 * @returns The standard deviations, the rotation, the centering and scaling
 *   applied, and the scores.
 * @throws RangeError If any value is missing or infinite (R's `svd` refuses
 *   the same), or if a column to be scaled is constant, in R's words.
 */
export function prcomp(input: Matrix | DataFrame, options: PrcompOptions = {}): Prcomp {
  const { center = true, scale = false } = options;
  const m = isMatrixLike(input) ? input : fromFrame(input);
  const { nrow: n, ncol: p } = m;
  if (!m.data.every(Number.isFinite)) {
    throw new RangeError("infinite or missing values in 'x'");
  }

  const columns = Array.from({ length: p }, (_, j) =>
    Array.from(m.data.subarray(j * n, (j + 1) * n)),
  );
  const centers = columns.map((column) => (center ? sum(column) / n : 0));
  const centered = columns.map((column, j) => column.map((value) => value - (centers[j] as number)));
  // R's scale(): the root mean square with the n - 1 divisor, which is the
  // standard deviation of a centered column.
  const scales = scale
    ? centered.map((column) => Math.sqrt(sum(column.map((value) => value * value)) / Math.max(1, n - 1)))
    : null;
  if (scales !== null && scales.some((value) => value === 0)) {
    throw new RangeError("cannot rescale a constant/zero column to unit variance");
  }
  const prepared = centered.map((column, j) =>
    scales === null ? column : column.map((value) => value / (scales[j] as number)),
  );

  // The covariance of the prepared columns, with R's max(1, n - 1) divisor.
  const divisor = Math.max(1, n - 1);
  const covariance = new Float64Array(p * p);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let total = 0;
      for (let k = 0; k < n; k++) {
        total += ((prepared[i] as number[])[k] as number) * ((prepared[j] as number[])[k] as number);
      }
      covariance[j * p + i] = total / divisor;
      covariance[i * p + j] = total / divisor;
    }
  }
  const variables = m.dimnames?.[1] ?? null;
  const eigen = eigenSymmetric(make(p, p, covariance, variables === null ? null : [variables, variables]));

  const components = Array.from({ length: p }, (_, k) => `PC${k + 1}`);
  const rotation = make(p, p, Float64Array.from(eigen.vectors.data), [variables, components]);
  const data = new Float64Array(n * p);
  prepared.forEach((column, j) => {
    data.set(column, j * n);
  });
  const scores = matmul(make(n, p, data, null), rotation);

  return {
    sdev: eigen.values.map((value) => Math.sqrt(Math.max(value, 0))),
    rotation,
    center: centers,
    scale: scales,
    x: make(n, p, scores.data, [m.dimnames?.[0] ?? null, components]),
  };
}

/** A matrix carries its data in a typed array; a data frame does not. */
function isMatrixLike(input: Matrix | DataFrame): input is Matrix {
  return (
    "data" in input &&
    (input as { data: unknown }).data instanceof Float64Array &&
    typeof (input as { nrow: unknown }).nrow === "number"
  );
}
