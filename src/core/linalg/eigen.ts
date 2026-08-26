/**
 * The eigendecomposition of a symmetric matrix, R's
 * `eigen(x, symmetric = TRUE)`.
 *
 * R goes through LAPACK's `dsyevr`. The port uses cyclic Jacobi rotations,
 * which for the matrices a teaching library sees — a covariance of a handful
 * of variables — converge to machine precision in a few sweeps and are
 * short enough to read. Eigenvalues come back descending, as R's do, and
 * the eigenvectors are orthonormal columns. Verified against R in
 * `eigen.test.ts`: the eigenvalues to a relative `1e-12`, the vectors up to
 * sign (plan Q1).
 *
 * **Signs are this port's own.** LAPACK leaves the sign of each eigenvector
 * to the arithmetic; the port makes the entry of largest magnitude positive
 * (a tie goes to the first), which is the rule `pca.ts` already uses, so
 * that the same input gives the same picture every time.
 *
 * Two departures from R, both stated: a matrix that is not symmetric is
 * refused, where R silently reads its lower triangle; and the eigenvector
 * matrix carries the row names of the input as its row names, where R's
 * carries none — a loading without its variable is unreadable.
 *
 * Index loops throughout: a rotation addresses entries by position.
 */

import { make, type Matrix } from "./matrix";

/** R's `eigen()` result for a symmetric matrix. */
export interface SymmetricEigen {
  /** The eigenvalues, largest first. */
  readonly values: readonly number[];
  /**
   * The eigenvectors as columns, in the order of the values, each of unit
   * length with its largest entry positive. Row names are the input's.
   */
  readonly vectors: Matrix;
}

/**
 * R's `isSymmetric()`: whether a square matrix equals its transpose to a
 * relative tolerance, R's `all.equal()` default of `100 * eps`.
 */
export function isSymmetric(m: Matrix, tolerance = 100 * Number.EPSILON): boolean {
  const { nrow, ncol, data } = m;
  if (nrow !== ncol) {
    return false;
  }
  for (let j = 0; j < ncol; j++) {
    for (let i = 0; i < j; i++) {
      const a = data[j * nrow + i] as number;
      const b = data[i * nrow + j] as number;
      if (Math.abs(a - b) > tolerance * Math.max(Math.abs(a), Math.abs(b))) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Decompose a symmetric matrix, as R's `eigen(x, symmetric = TRUE)` does.
 *
 * @param m The symmetric matrix. The function does not modify it.
 * @returns The eigenvalues, descending, and the eigenvectors as columns.
 * @throws RangeError If the matrix is not square or not symmetric.
 */
export function eigenSymmetric(m: Matrix): SymmetricEigen {
  if (m.nrow !== m.ncol) {
    throw new RangeError(`'x' (${m.nrow} x ${m.ncol}) must be a square matrix`);
  }
  if (!isSymmetric(m)) {
    throw new RangeError("'x' must be symmetric");
  }
  const n = m.nrow;
  const a = Float64Array.from(m.data);
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    v[i * n + i] = 1;
  }
  jacobi(a, v, n);

  const order = Array.from({ length: n }, (_, i) => i).sort(
    (i, j) => (a[j * n + j] as number) - (a[i * n + i] as number) || i - j,
  );
  const values = order.map((i) => a[i * n + i] as number);
  const vectors = new Float64Array(n * n);
  order.forEach((from, k) => {
    const columnVector = v.subarray(from * n, (from + 1) * n);
    let largest = 0;
    columnVector.forEach((entry) => {
      if (Math.abs(entry) > Math.abs(largest)) {
        largest = entry;
      }
    });
    const sign = largest < 0 ? -1 : 1;
    columnVector.forEach((entry, i) => {
      vectors[k * n + i] = sign * entry + 0;
    });
  });

  const rows = m.dimnames?.[0] ?? null;
  return { values, vectors: make(n, n, vectors, rows === null ? null : [rows, null]) };
}

/**
 * Cyclic Jacobi: rotate each off-diagonal pair to zero in turn until the
 * off-diagonal mass is negligible against the diagonal. `a` ends up
 * diagonal and `v` accumulates the rotations, both in place.
 */
function jacobi(a: Float64Array, v: Float64Array, n: number): void {
  const at = (i: number, j: number): number => a[j * n + i] as number;
  const set = (i: number, j: number, value: number): void => {
    a[j * n + i] = value;
  };

  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        off += at(p, q) * at(p, q);
      }
    }
    if (off === 0) {
      return;
    }
    let diagonal = 0;
    for (let p = 0; p < n; p++) {
      diagonal += at(p, p) * at(p, p);
    }
    if (off <= Number.EPSILON * Number.EPSILON * diagonal) {
      return;
    }

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = at(p, q);
        if (apq === 0) {
          continue;
        }
        // The rotation angle, in the form that stays accurate when the
        // diagonal entries are far apart (Rutishauser's).
        const theta = (at(q, q) - at(p, p)) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let k = 0; k < n; k++) {
          const akp = at(k, p);
          const akq = at(k, q);
          set(k, p, c * akp - s * akq);
          set(k, q, s * akp + c * akq);
        }
        for (let k = 0; k < n; k++) {
          const apk = at(p, k);
          const aqk = at(q, k);
          set(p, k, c * apk - s * aqk);
          set(q, k, s * apk + c * aqk);
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[p * n + k] as number;
          const vkq = v[q * n + k] as number;
          v[p * n + k] = c * vkp - s * vkq;
          v[q * n + k] = s * vkp + c * vkq;
        }
      }
    }
  }
}
