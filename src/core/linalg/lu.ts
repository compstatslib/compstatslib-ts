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
 * Every routine here takes `fma`, the option `FmaOption` describes. The
 * default, `true`, keeps R's doubles. `false` rounds each product twice,
 * which runs much faster and lands a few units in the last place away.
 * A pivot carries that distance too, so a singular matrix can change the
 * class of its error: an exactly zero pivot under one rounding may come
 * out small and nonzero under two, and `solve` then reports a
 * computationally singular system in place of R's exactly singular one.
 * On `matrix(1:9, 3)`, R's own singular case, both paths reach the
 * exactly zero pivot and both give R's message; `lu.test.ts` pins that.
 * See the README's linear algebra section for the measured ratios.
 *
 * Provenance: `dgetrf`, `dgetrs`, `dgesv` and `dgecon` are LAPACK, under a
 * three-clause BSD license. See NOTICE.
 *
 * The setting is read once, at the entry of the routine, and kept as a
 * boolean on the decomposition so that every reader rounds the way the
 * factorization did. Each innermost loop is then written twice, once for
 * each rounding, with the branch on that boolean around the loop rather
 * than inside it. One shared call site would go polymorphic as soon as a
 * program uses both settings, and the engine would stop inlining it.
 *
 * Three departures from R, each stated where it applies: `rcond` is the
 * exact one-norm ratio rather than `dgecon`'s estimate; a vector right-hand
 * side comes back as a plain array rather than R's named vector; and a
 * negative or NaN tolerance is refused where R would skip the check.
 *
 * Index loops throughout: a factorization addresses single entries by
 * position, and this one follows `dgetf2` and `dtrsm` as written.
 */

import { fusedMultiplyAdd, resolveFma, type FmaOption } from "../arith";
import { make, type Dimnames, type Matrix } from "./matrix";
import { isMatrix, t, type MatrixOrVector } from "./ops";
import { qr, qrR } from "./qr";
import type { Vector } from "./vector";

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
   * `P` such that `P A = L U`. Plural, and not `pivot` as in
   * `QrDecomposition`, because this is a list of interchanges rather than
   * a column order.
   */
  readonly pivots: readonly number[];
  /**
   * The zero-based index of the first exactly zero pivot — LAPACK's `info`,
   * less one — or null if the factorization completed. R reports it as
   * `U[i,i] = 0`, one-based.
   */
  readonly zeroPivot: number | null;
  /**
   * The arithmetic the factorization used, so that every reader of it
   * rounds the way it did.
   */
  readonly fma: boolean;
}

/** The arithmetic option of `lu()`, `det()`, `determinant()` and `rcond()`. */
export interface LuOptions extends FmaOption {}

/**
 * Factor a square matrix, as LAPACK's `dgetrf` does.
 *
 * @param a The matrix. The function does not modify it.
 * @param options The arithmetic. `{ fma: false }` rounds each product
 *   twice, which is faster and a few units in the last place away from R.
 * @returns The compact factorization, the row interchanges, the first
 *   zero pivot if any, and the arithmetic used. A zero pivot does not stop
 *   the factorization, as it does not in LAPACK.
 * @throws RangeError If the matrix is not square.
 * @throws TypeError If `a` is not a matrix, or `fma` is not a boolean.
 */
export function lu(a: Matrix, options: LuOptions = {}): LuDecomposition {
  // The arithmetic is read here, before the loops, and never per entry.
  const fma = resolveFma(options.fma);
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

    // The rank-one update of the trailing block, `dger`: under the default
    // each product is rounded once into the entry it updates. The loop is
    // written twice, and the branch sits around it.
    for (let jj = j + 1; jj < n; jj++) {
      const factor = -entry(j, jj);
      if (fma) {
        for (let i = j + 1; i < n; i++) {
          data[jj * n + i] = fusedMultiplyAdd(entry(i, j), factor, entry(i, jj));
        }
      } else {
        for (let i = j + 1; i < n; i++) {
          data[jj * n + i] = entry(i, j) * factor + entry(i, jj);
        }
      }
    }
  }

  return { lu: make(n, n, data, null), pivots, zeroPivot, fma };
}

/** Exchange two rows of a column-major square buffer in place. */
function swapRows(data: Float64Array, n: number, i: number, p: number): void {
  for (let j = 0; j < n; j++) {
    const held = data[j * n + i] as number;
    data[j * n + i] = data[j * n + p] as number;
    data[j * n + p] = held;
  }
}

export interface SolveOptions extends FmaOption {
  /**
   * The reciprocal condition number below which the system is refused as
   * computationally singular. R's default is `.Machine$double.eps`; zero
   * skips the check, as it does in R. R also skips it for a negative or
   * NA `tol`; the port refuses those with a `RangeError` — a deliberate
   * narrowing, as `matrix()` narrows R's recycling.
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
 * @param b The right-hand side, or the options when only the inverse is
 *   wanted. A vector gives a plain array (R names it by the column names of
 *   `a`; the port carries no names on a bare array — plan Q11). A matrix
 *   gives a matrix whose row names are the column names of `a` and whose
 *   column names are those of `b`; the inverse has the column names of `a`
 *   as rows and the row names of `a` as columns, as R's does.
 * @param options The singularity tolerance and the arithmetic. Under
 *   `{ fma: false }` a matrix whose pivot R makes exactly zero can come
 *   back computationally singular instead, as the module comment says.
 * @returns The solution.
 * @throws RangeError If `a` is not square or has no rows, `b` does not
 *   conform or has no columns, the factorization meets an exactly zero
 *   pivot, or the reciprocal condition number is below the tolerance —
 *   each in R's own words. As in R, a non-finite entry in `a` leaves the
 *   condition unchecked: R's `dgecon` reports a bad norm and `solve()`
 *   goes on.
 * @throws TypeError If `a` or `b` is neither a matrix nor an array, or
 *   `fma` is not a boolean.
 */
export function solve(a: Matrix, options?: SolveOptions): Matrix;
export function solve(a: Matrix, b: Vector, options?: SolveOptions): number[];
export function solve(a: Matrix, b: Matrix, options?: SolveOptions): Matrix;
export function solve(
  a: Matrix,
  second?: MatrixOrVector | SolveOptions,
  third: SolveOptions = {},
): Matrix | number[] {
  const [b, options] = splitArguments(second, third);
  const { tolerance = DEFAULT_SOLVE_TOLERANCE } = options;
  if (!(tolerance >= 0)) {
    throw new RangeError(`tolerance must be a non-negative number, got ${tolerance}`);
  }
  requireSquare(a, "a");
  const n = a.nrow;
  if (n === 0) {
    throw new RangeError("'a' is 0-diml");
  }

  const rhs: Matrix =
    b === undefined
      ? identityData(n)
      : isMatrix(b)
        ? b
        : make(b.length, 1, Float64Array.from(b), null);
  if (rhs.ncol === 0) {
    throw new RangeError("no right-hand side in 'b'");
  }
  if (rhs.nrow !== n) {
    throw new RangeError(
      `'b' (${rhs.nrow} x ${rhs.ncol}) must be compatible with 'a' (${n} x ${n})`,
    );
  }

  const factored = lu(a, { fma: options.fma });
  if (factored.zeroPivot !== null) {
    const i = factored.zeroPivot + 1;
    throw new RangeError(
      `Lapack routine dgesv: system is exactly singular: U[${i},${i}] = 0`,
    );
  }
  const solution = substitute(factored, rhs);
  const anorm = oneNorm(a.data, n, n);
  if (tolerance > 0 && Number.isFinite(anorm)) {
    // The inverse is the solution itself when that is what was asked for.
    const inverse = b === undefined ? solution : substitute(factored, identityData(n));
    const reciprocal = 1 / (anorm * oneNorm(inverse, n, n));
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

/** Tell `solve(a, options)` from `solve(a, b, options)`. */
function splitArguments(
  second: MatrixOrVector | SolveOptions | undefined,
  third: SolveOptions,
): [MatrixOrVector | undefined, SolveOptions] {
  if (second === undefined) {
    return [undefined, third];
  }
  if (Array.isArray(second) || (typeof second === "object" && "data" in second && "nrow" in second)) {
    return [second as MatrixOrVector, third];
  }
  if (typeof second === "object" && second !== null && !ArrayBuffer.isView(second)) {
    return [undefined, second as SolveOptions];
  }
  throw new TypeError("expected a Matrix, an array of numbers, or the options");
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
 * the unit lower triangle and back through the upper one (`dtrsm`). A zero
 * entry is skipped as `dtrsm` skips it, which is how a negative zero on
 * the right-hand side survives, as it does in R.
 *
 * The arithmetic is the one the factorization used, read here once off the
 * decomposition. Each sweep's innermost loop is written twice, and the
 * branch sits around it, for the reason the module comment gives.
 */
function substitute(factored: LuDecomposition, rhs: Matrix): Float64Array {
  const { lu: compact, pivots, fma } = factored;
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
        if (fma) {
          for (let i = k + 1; i < n; i++) {
            data[j * n + i] = fusedMultiplyAdd(-at(k), entry(i, k), at(i));
          }
        } else {
          for (let i = k + 1; i < n; i++) {
            data[j * n + i] = -at(k) * entry(i, k) + at(i);
          }
        }
      }
    }
    for (let k = n - 1; k >= 0; k--) {
      if (at(k) !== 0) {
        data[j * n + k] = at(k) / entry(k, k);
        if (fma) {
          for (let i = 0; i < k; i++) {
            data[j * n + i] = fusedMultiplyAdd(-at(k), entry(i, k), at(i));
          }
        } else {
          for (let i = 0; i < k; i++) {
            data[j * n + i] = -at(k) * entry(i, k) + at(i);
          }
        }
      }
    }
  }

  return data;
}

/**
 * R's `det()`: the determinant, through the factorization and a sum of
 * logarithms, as R computes it. A 0 × 0 matrix has determinant 1, as in R.
 *
 * @param a The square matrix.
 * @param options The arithmetic of the factorization.
 * @throws RangeError If the matrix is not square.
 * @throws TypeError If `a` is not a matrix, or `fma` is not a boolean.
 */
export function det(a: Matrix, options: LuOptions = {}): number {
  const { modulus, sign } = determinant(a, options);
  return sign * Math.exp(modulus);
}

/**
 * R's `determinant()`: the logarithm of the absolute determinant and its
 * sign. An exactly singular matrix reports `-Infinity` and sign 1, so that
 * `det()` is a positive zero, as R's is.
 *
 * @param a The square matrix.
 * @param options The arithmetic of the factorization.
 * @throws RangeError If the matrix is not square.
 * @throws TypeError If `a` is not a matrix, or `fma` is not a boolean.
 */
export function determinant(
  a: Matrix,
  options: LuOptions = {},
): { readonly modulus: number; readonly sign: 1 | -1 } {
  requireSquare(a, "x");
  const factored = lu(a, options);
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
 * The reciprocal condition number in the one-norm, R's `rcond(x)`:
 * `1 / (norm(x) * norm(solve(x)))` for a square matrix, 0 when it is
 * exactly singular, and Infinity for a 0 × 0 matrix. A matrix that is not
 * square goes through the triangular factor of its QR, as R's does
 * (`rcond(qr.R(qr(x)))`, transposed first when wide).
 *
 * R's `rcond()` and `solve()` read an estimate of this number from LAPACK's
 * `dgecon` rather than computing it, and the port computes it exactly. On
 * the fixtures the two agree to the last bit for most matrices (3a, 3c, 3d,
 * 3e, 3i) and differ by one unit in the last place on two (3b, 3h);
 * `solve()`'s error message matches R's to the six digits it prints on
 * every singular case pinned. The estimate bounds the norm of the inverse
 * from below, so R's number is never smaller than the port's.
 *
 * @param a The matrix.
 * @param options The arithmetic. The QR of a matrix that is not square
 *   takes it too, so one setting covers the whole path.
 * @throws RangeError If an entry is not finite — R's "error code -5 from
 *   Lapack routine 'dgecon()'", because `dgecon` refuses a norm it cannot
 *   read.
 * @throws TypeError If `a` is not a matrix, or `fma` is not a boolean.
 */
export function rcond(a: Matrix, options: LuOptions = {}): number {
  if (!isMatrix(a)) {
    throw new TypeError("expected a Matrix");
  }
  if (a.nrow !== a.ncol) {
    const wide = a.nrow < a.ncol;
    return rcond(qrR(qr(wide ? t(a) : a, { fma: options.fma })), options);
  }
  const n = a.nrow;
  if (n === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const anorm = oneNorm(a.data, n, n);
  if (!Number.isFinite(anorm)) {
    throw new RangeError("error code -5 from Lapack routine 'dgecon()'");
  }
  const factored = lu(a, options);
  if (factored.zeroPivot !== null) {
    return 0;
  }
  return 1 / (anorm * oneNorm(substitute(factored, identityData(n)), n, n));
}

/**
 * R's `norm()` types. `"O"` is R's default; the letters are accepted in
 * either case, as R's `lsame` accepts them. R's `"2"`, the spectral norm,
 * needs a singular value decomposition, which this plan leaves out.
 */
export type MatrixNormType = "O" | "1" | "I" | "F" | "E" | "M" | "o" | "i" | "f" | "e" | "m";

/**
 * R's `norm(x, type)`: the one-norm (`"O"` or `"1"`, the largest absolute
 * column sum), the infinity norm (`"I"`, the largest absolute row sum), the
 * Frobenius norm (`"F"` or `"E"`), or the largest absolute entry (`"M"`).
 * Named `matrixNorm` because `norm` in this entry is the vector length.
 *
 * @throws RangeError If the type is none of those, in R's words.
 * @throws TypeError If `a` is not a matrix.
 */
export function matrixNorm(a: Matrix, type: MatrixNormType = "O"): number {
  if (!isMatrix(a)) {
    throw new TypeError("expected a Matrix");
  }
  const { nrow, ncol, data } = a;
  switch (type.toUpperCase()) {
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
    default:
      throw new RangeError(
        `argument type[1]='${type}' must be one of 'M','1','O','I','F' or 'E'`,
      );
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

/** Refuse a non-matrix, then a matrix that is not square, in R's words for the argument. */
function requireSquare(a: Matrix, name: string): void {
  if (!isMatrix(a)) {
    throw new TypeError("expected a Matrix");
  }
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
 * condition number in: the value rounded to six digits, in exponent
 * notation when that rounded value's exponent is below -4 or 6 or more,
 * with trailing zeros dropped and at least two exponent digits.
 */
function formatG(value: number): string {
  if (value === 0 || !Number.isFinite(value)) {
    return String(value);
  }
  // Rounding first, as C does: 9.9999999e-5 is 0.0001, not 1e-04.
  const [mantissa, power] = value.toExponential(5).split("e") as [string, string];
  const exponent = Number(power);
  const trim = (digits: string): string =>
    digits.includes(".") ? digits.replace(/0+$/, "").replace(/\.$/, "") : digits;
  if (exponent < -4 || exponent >= 6) {
    const sign = exponent < 0 ? "-" : "+";
    return `${trim(mantissa)}e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  return trim(value.toFixed(Math.max(0, 5 - exponent)));
}
