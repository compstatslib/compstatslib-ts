/**
 * The LU factorization with partial pivoting, and what R reads off it:
 * `solve()`, `det()`, `determinant()`, `rcond()` and `norm()`.
 *
 * R's `solve(a, b)` is LAPACK `dgesv` — `dgetrf` to factor, `dgetrs` to
 * substitute — followed by `dgecon`'s condition estimate and an error when
 * that estimate falls below `tol`. `det()` factors the same way and then
 * exponentiates a sum of logarithms of the diagonal, which is why the
 * determinant of an integer matrix comes back as `30.000000000000004`. This
 * module follows those routines step for step, with the arithmetic of the
 * reference BLAS build the fixtures come from (each product rounded once
 * into its sum — see `fusedMultiplyAdd`), so that the factorization, the
 * solves and the determinant pin bit for bit. Verified in `lu.test.ts`.
 * The 2 × 2 special case in `../matrix.ts` is the same algorithm and the
 * two agree exactly on every fixture of the interactive demo.
 *
 * Two departures from R, both stated where they apply: `rcond` is the exact
 * one-norm ratio rather than `dgecon`'s estimate, and a vector right-hand
 * side comes back as a plain array rather than R's named vector.
 *
 * Index loops throughout: a factorization addresses single entries by
 * position, and this one follows `dgetf2` and `dtrsm` as written.
 */

import { fusedMultiplyAdd, withoutNegativeZero } from "../arith";
import { make, type Dimnames, type Matrix } from "./matrix";
import { isMatrix, type MatrixOrVector } from "./ops";

/**
 * The smallest normal double, LAPACK's `dlamch("S")`.
 *
 * Below it, `dgetf2` divides the column by the pivot instead of multiplying
 * by the reciprocal, because the reciprocal would overflow.
 */
const SMALLEST_NORMAL = 2.2250738585072014e-308;

/** R's `solve()` result on a square matrix, factored. */
export interface LuDecomposition {
  /**
   * The compact factorization, LAPACK's: `U` on and above the diagonal, the
   * multipliers of the unit lower triangle `L` below it, rows already
   * interchanged.
   */
  readonly lu: Matrix;
  /**
   * The row interchanges, LAPACK's `ipiv` **zero-based**: at step `i` row
   * `i` was swapped with row `pivots[i]`. Apply them in order to recover
   * `P` such that `P A = L U`.
   */
  readonly pivots: readonly number[];
  /**
   * The zero-based index of the first exactly zero pivot — LAPACK's `info`,
   * less one — or null if the factorization completed. R reports it as
   * `U[i,i] = 0`, one-based.
   */
  readonly zeroPivot: number | null;
}

/**
 * Factor a square matrix, as LAPACK's `dgetrf` does.
 *
 * @param a The matrix. The function does not modify it.
 * @returns The compact factorization, the row interchanges, and the first
 *   zero pivot if any. A zero pivot does not stop the factorization, as it
 *   does not in LAPACK.
 * @throws RangeError If the matrix is not square.
 */
export function lu(a: Matrix): LuDecomposition {
  requireSquare(a, "a");
  const n = a.nrow;
  const data = Float64Array.from(a.data);
  const pivots = new Array<number>(n).fill(0);
  let zeroPivot: number | null = null;
  const entry = (i: number, j: number): number => data[j * n + i] as number;

  for (let j = 0; j < n; j++) {
    // Partial pivoting: the largest entry on or below the diagonal leads;
    // the first of equals, as `idamax` picks it.
    let p = j;
    for (let i = j + 1; i < n; i++) {
      if (Math.abs(entry(i, j)) > Math.abs(entry(p, j))) {
        p = i;
      }
    }
    pivots[j] = p;

    if (entry(p, j) !== 0) {
      if (p !== j) {
        swapRows(data, n, j, p);
      }
      // `dgetf2` scales by the reciprocal of the pivot, and divides only
      // where the reciprocal would overflow. The difference reaches the
      // result: see the note on `../matrix.ts`.
      const pivot = entry(j, j);
      if (Math.abs(pivot) >= SMALLEST_NORMAL) {
        const reciprocal = 1 / pivot;
        for (let i = j + 1; i < n; i++) {
          data[j * n + i] = entry(i, j) * reciprocal;
        }
      } else {
        for (let i = j + 1; i < n; i++) {
          data[j * n + i] = entry(i, j) / pivot;
        }
      }
    } else if (zeroPivot === null) {
      zeroPivot = j;
    }

    // The rank-one update of the trailing block, `dger`: each product is
    // rounded once into the entry it updates.
    for (let jj = j + 1; jj < n; jj++) {
      const factor = -entry(j, jj);
      for (let i = j + 1; i < n; i++) {
        data[jj * n + i] = fusedMultiplyAdd(entry(i, j), factor, entry(i, jj));
      }
    }
  }

  return { lu: make(n, n, data, null), pivots, zeroPivot };
}

/** Exchange two rows of a column-major square buffer in place. */
function swapRows(data: Float64Array, n: number, i: number, p: number): void {
  for (let j = 0; j < n; j++) {
    const held = data[j * n + i] as number;
    data[j * n + i] = data[j * n + p] as number;
    data[j * n + p] = held;
  }
}

export interface SolveOptions {
  /**
   * The reciprocal condition number below which the system is refused as
   * computationally singular. R's default is `.Machine$double.eps`; zero
   * skips the check, as it does in R.
   */
  readonly tolerance?: number;
}

/** The singularity tolerance of R's `solve()`: one machine epsilon. */
export const DEFAULT_SOLVE_TOLERANCE = Number.EPSILON;

/**
 * R's `solve(a)`, `solve(a, b)` and `solve(a, B)`: the inverse, the solution
 * of `a x = b` for a vector, or the solution of `a X = B` for a matrix.
 *
 * @param a The square coefficient matrix.
 * @param b The right-hand side, or undefined for the inverse. A vector gives
 *   a plain array (R names it by the column names of `a`; the port carries
 *   no names on a bare array — plan Q11). A matrix gives a matrix whose row
 *   names are the column names of `a` and whose column names are those of
 *   `b`; the inverse has the column names of `a` as rows and the row names
 *   of `a` as columns, as R's does.
 * @param options The singularity tolerance.
 * @returns The solution.
 * @throws RangeError If `a` is not square, `b` does not conform, the
 *   factorization meets an exactly zero pivot, or the reciprocal condition
 *   number is below the tolerance — each in R's own words.
 */
export function solve(a: Matrix, b?: undefined, options?: SolveOptions): Matrix;
export function solve(a: Matrix, b: readonly number[], options?: SolveOptions): number[];
export function solve(a: Matrix, b: Matrix, options?: SolveOptions): Matrix;
export function solve(
  a: Matrix,
  b?: MatrixOrVector,
  options: SolveOptions = {},
): Matrix | number[] {
  const { tolerance = DEFAULT_SOLVE_TOLERANCE } = options;
  if (!(tolerance >= 0)) {
    throw new RangeError(`tolerance must be a non-negative number, got ${tolerance}`);
  }
  requireSquare(a, "a");
  const n = a.nrow;

  const rhs: Matrix =
    b === undefined
      ? identityData(n)
      : isMatrix(b)
        ? b
        : make(b.length, 1, Float64Array.from(b), null);
  if (rhs.nrow !== n) {
    throw new RangeError(
      `'b' (${rhs.nrow} x ${rhs.ncol}) must be compatible with 'a' (${n} x ${n})`,
    );
  }

  const factored = lu(a);
  if (factored.zeroPivot !== null) {
    const i = factored.zeroPivot + 1;
    throw new RangeError(
      `Lapack routine dgesv: system is exactly singular: U[${i},${i}] = 0`,
    );
  }
  const solution = substitute(factored, rhs);
  if (tolerance > 0) {
    const reciprocal = rcondOf(a, factored);
    if (reciprocal < tolerance) {
      throw new RangeError(
        `system is computationally singular: reciprocal condition number = ${formatG(reciprocal)}`,
      );
    }
  }

  if (b !== undefined && !isMatrix(b)) {
    return Array.from(solution);
  }
  const aColumns = a.dimnames?.[1] ?? null;
  const dimnames: Dimnames | null =
    b === undefined
      ? a.dimnames === null
        ? null
        : [aColumns, a.dimnames[0]]
      : aColumns === null && (rhs.dimnames?.[1] ?? null) === null
        ? null
        : [aColumns, rhs.dimnames?.[1] ?? null];
  return make(n, rhs.ncol, solution, dimnames);
}

/** The identity as a matrix, the right-hand side of `solve(a)`. */
function identityData(n: number): Matrix {
  const data = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    data[i * n + i] = 1;
  }
  return make(n, n, data, null);
}

/**
 * Solve the factored system against a right-hand side, as `dgetrs` does:
 * the row interchanges applied to `B`, then each column forward through
 * the unit lower triangle and back through the upper one (`dtrsm`).
 */
function substitute(factored: LuDecomposition, rhs: Matrix): Float64Array {
  const { lu: compact, pivots } = factored;
  const n = compact.nrow;
  const entry = (i: number, j: number): number => compact.data[j * n + i] as number;
  const data = Float64Array.from(rhs.data);
  const width = rhs.ncol;

  pivots.forEach((p, i) => {
    if (p !== i) {
      for (let j = 0; j < width; j++) {
        const held = data[j * n + i] as number;
        data[j * n + i] = data[j * n + p] as number;
        data[j * n + p] = held;
      }
    }
  });

  for (let j = 0; j < width; j++) {
    const at = (i: number): number => data[j * n + i] as number;
    for (let k = 0; k < n; k++) {
      if (at(k) !== 0) {
        for (let i = k + 1; i < n; i++) {
          data[j * n + i] = fusedMultiplyAdd(-at(k), entry(i, k), at(i));
        }
      }
    }
    for (let k = n - 1; k >= 0; k--) {
      if (at(k) !== 0) {
        data[j * n + k] = at(k) / entry(k, k);
        for (let i = 0; i < k; i++) {
          data[j * n + i] = fusedMultiplyAdd(-at(k), entry(i, k), at(i));
        }
      }
    }
  }

  // The substitution can leave a zero entry with a sign; R's never carry one.
  return data.map(withoutNegativeZero);
}

/**
 * R's `det()`: the determinant, through the factorization and a sum of
 * logarithms, as R computes it.
 *
 * @throws RangeError If the matrix is not square.
 */
export function det(a: Matrix): number {
  const { modulus, sign } = determinant(a);
  return sign * Math.exp(modulus);
}

/**
 * R's `determinant()`: the logarithm of the absolute determinant and its
 * sign. An exactly singular matrix reports `-Infinity` and sign 1, so that
 * `det()` is a positive zero, as R's is.
 *
 * @throws RangeError If the matrix is not square.
 */
export function determinant(a: Matrix): { readonly modulus: number; readonly sign: 1 | -1 } {
  requireSquare(a, "x");
  const factored = lu(a);
  if (factored.zeroPivot !== null) {
    return { modulus: Number.NEGATIVE_INFINITY, sign: 1 };
  }
  const n = a.nrow;
  let modulus = 0;
  let sign: 1 | -1 = 1;
  for (let i = 0; i < n; i++) {
    const pivot = factored.lu.data[i * n + i] as number;
    if (factored.pivots[i] !== i) {
      sign = -sign as 1 | -1;
    }
    if (pivot < 0) {
      sign = -sign as 1 | -1;
    }
    modulus += Math.log(Math.abs(pivot));
  }
  return { modulus, sign };
}

/**
 * The reciprocal condition number in the one-norm, R's `rcond(a)`:
 * `1 / (norm(a) * norm(solve(a)))`, and 0 for an exactly singular matrix.
 *
 * R's `rcond()` and `solve()` read an estimate of this number from LAPACK's
 * `dgecon` rather than computing it. Near the singularity bar the two agree
 * to the last bit — every fixture at the edge does — while for a well
 * conditioned matrix R's estimate can sit a bit or two away, because the
 * estimator only bounds the norm of the inverse from below. `solve()`
 * compares this value with its tolerance, so a matrix R refuses is refused
 * here with the same six-digit number in the message.
 *
 * @throws RangeError If the matrix is not square.
 */
export function rcond(a: Matrix): number {
  requireSquare(a, "x");
  const factored = lu(a);
  if (factored.zeroPivot !== null) {
    return 0;
  }
  return rcondOf(a, factored);
}

/** The exact one-norm reciprocal condition number of a factored matrix. */
function rcondOf(a: Matrix, factored: LuDecomposition): number {
  const inverse = substitute(factored, identityData(a.nrow));
  return 1 / (oneNorm(a.data, a.nrow, a.nrow) * oneNorm(inverse, a.nrow, a.nrow));
}

/** R's `norm()` types. `"O"` is R's default. */
export type MatrixNormType = "O" | "1" | "I" | "F" | "E" | "M";

/**
 * R's `norm(x, type)`: the one-norm (`"O"` or `"1"`, the largest absolute
 * column sum), the infinity norm (`"I"`, the largest absolute row sum), the
 * Frobenius norm (`"F"` or `"E"`), or the largest absolute entry (`"M"`).
 * Named `matrixNorm` because `norm` in this entry is the vector length.
 */
export function matrixNorm(a: Matrix, type: MatrixNormType = "O"): number {
  const { nrow, ncol, data } = a;
  switch (type) {
    case "O":
    case "1":
      return oneNorm(data, nrow, ncol);
    case "I": {
      let largest = 0;
      for (let i = 0; i < nrow; i++) {
        let total = 0;
        for (let j = 0; j < ncol; j++) {
          total += Math.abs(data[j * nrow + i] as number);
        }
        largest = Math.max(largest, total);
      }
      return largest;
    }
    case "F":
    case "E": {
      let squares = 0;
      data.forEach((value) => {
        squares += value * value;
      });
      return Math.sqrt(squares);
    }
    case "M":
      return data.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
  }
}

/** The largest absolute column sum of a column-major buffer. */
function oneNorm(data: Float64Array, nrow: number, ncol: number): number {
  let largest = 0;
  for (let j = 0; j < ncol; j++) {
    let total = 0;
    for (let i = 0; i < nrow; i++) {
      total += Math.abs(data[j * nrow + i] as number);
    }
    largest = Math.max(largest, total);
  }
  return largest;
}

/** Refuse a matrix that is not square, in R's words for the argument. */
function requireSquare(a: Matrix, name: string): void {
  if (a.nrow !== a.ncol) {
    throw new RangeError(
      name === "a"
        ? `'a' (${a.nrow} x ${a.ncol}) must be square`
        : "'x' must be a square matrix",
    );
  }
}

/**
 * C's `%g` with six significant digits, the form R prints a reciprocal
 * condition number in: exponent notation below 1e-4 or from 1e6 up, with
 * trailing zeros dropped and at least two exponent digits.
 */
function formatG(value: number): string {
  if (value === 0 || !Number.isFinite(value)) {
    return String(value);
  }
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const precise = value.toPrecision(6);
  if (exponent < -4 || exponent >= 6) {
    const [mantissa, power] = precise.includes("e")
      ? precise.split("e")
      : [precise, String(exponent)];
    const trimmed = (mantissa as string).includes(".")
      ? (mantissa as string).replace(/0+$/, "").replace(/\.$/, "")
      : (mantissa as string);
    const digits = Number(power);
    const sign = digits < 0 ? "-" : "+";
    return `${trimmed}e${sign}${String(Math.abs(digits)).padStart(2, "0")}`;
  }
  return precise.includes(".") ? precise.replace(/0+$/, "").replace(/\.$/, "") : precise;
}
