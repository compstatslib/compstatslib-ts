/**
 * R's operators over vectors and matrices, by name.
 *
 * R vectors are not objects with methods: `a + 1`, `a * b` and `sum(a * b)`
 * are functions over plain vectors, with a scalar recycled to the length of
 * the other argument. This module is those functions with the operator
 * spelled out — `add(a, 1)`, `mul(a, b)`, `dot(a, b)` — over `Vector`,
 * which is `Vector` and nothing more: a bare array is a vector
 * (plan Q11, Q12).
 *
 * R recycles any shorter vector, with a warning when the lengths do not
 * divide. The port recycles a scalar only and refuses every other mismatch:
 * a silent recycle lets a typo fit the wrong model.
 *
 * `add`, `sub`, `mul` and `div` also carry R's elementwise `+ - * /` over a
 * `Matrix`: two matrices of the same extents, or a matrix and a number
 * (plan 004, Slice 7). `mul` is R's `*` there too, and not `%*%`.
 */

import { sum, zipWith } from "../arith";
import { make, type Dimnames, type Matrix } from "./matrix";
import { isMatrix } from "./ops";

/**
 * A numeric vector: R's atomic double vector, which here is a plain array of
 * numbers. `NaN` is the missing value, as `NA_real_` is in R.
 *
 * The name is erased at compile time and structural, not nominal. Any
 * `number[]` is a `Vector` and any `Vector` is an array, with nothing to wrap
 * at either end. It names the concept in a signature and carries this note to
 * every place one is taken; it constrains nothing, and in particular it does
 * not check a length.
 *
 * A function *takes* a `Vector` and *returns* a fresh `number[]` — R's
 * copy-on-modify, and the reason there is no mutable counterpart to this
 * name. A vector is never an object with methods (plan Q12).
 */
export type Vector = readonly number[];

/** A vector, or a scalar to recycle to the vector's length. */
export type VectorOrScalar = Vector | number;

/** Combine two vectors element by element, or a vector with a scalar. */
function elementwise(
  a: Vector,
  b: VectorOrScalar,
  combine: (x: number, y: number) => number,
): number[] {
  if (typeof b === "number") {
    return a.map((x) => combine(x, b));
  }
  requireSameLength(a, b);
  return zipWith(a, b, combine);
}

/** Refuse two vectors of different lengths. */
function requireSameLength(a: Vector, b: Vector): void {
  if (a.length !== b.length) {
    throw new RangeError(`vector lengths differ: ${a.length} and ${b.length}`);
  }
}

/**
 * Combine two matrices entry by entry, or a matrix with a scalar.
 *
 * The entries are in the same order in both operands, so one pass over the
 * data does it. An index loop reads the arrays by position, which is what a
 * `Float64Array` offers.
 */
function matrixElementwise(
  a: Matrix,
  b: Matrix | number,
  combine: (x: number, y: number) => number,
): Matrix {
  const scalar = typeof b === "number";
  if (!scalar && (a.nrow !== b.nrow || a.ncol !== b.ncol)) {
    throw new RangeError("non-conformable arrays");
  }
  const data = new Float64Array(a.data.length);
  for (let index = 0; index < data.length; index++) {
    const right = scalar ? b : (b.data[index] as number);
    data[index] = combine(a.data[index] as number, right);
  }
  return make(a.nrow, a.ncol, data, operandDimnames(a, scalar ? null : b));
}

/**
 * R keeps the dimnames of the first operand when it has any, and takes the
 * second operand's otherwise. A scalar carries no names.
 */
function operandDimnames(a: Matrix, b: Matrix | null): Dimnames | null {
  return a.dimnames ?? b?.dimnames ?? null;
}

/**
 * Send a pair of operands to the vector path or the matrix path.
 *
 * R recycles a vector against a matrix when the length divides, silently.
 * The port refuses that pairing in either order, as it refuses every other
 * recycle: a silent recycle lets a typo fit the wrong model.
 *
 * `isMatrix` runs on the right operand only after the scalar test, because
 * it throws on anything that is neither a matrix nor an array.
 */
function dispatch(
  a: Matrix | Vector,
  b: Matrix | VectorOrScalar,
  combine: (x: number, y: number) => number,
): Matrix | number[] {
  const scalar = typeof b === "number";
  const leftIsMatrix = isMatrix(a);
  const rightIsMatrix = !scalar && isMatrix(b);
  if (!scalar && leftIsMatrix !== rightIsMatrix) {
    throw new TypeError(
      "a vector and a matrix: R recycles the vector here, and the port refuses",
    );
  }
  if (leftIsMatrix) {
    return matrixElementwise(a, b as Matrix | number, combine);
  }
  return elementwise(a, b as VectorOrScalar, combine);
}

/** R's `a + b`. */
export function add(a: Matrix, b: Matrix): Matrix;
export function add(a: Matrix, b: number): Matrix;
export function add(a: Vector, b: VectorOrScalar): number[];
export function add(
  a: Matrix | Vector,
  b: Matrix | VectorOrScalar,
): Matrix | number[] {
  return dispatch(a, b, (x, y) => x + y);
}

/** R's `a - b`. */
export function sub(a: Matrix, b: Matrix): Matrix;
export function sub(a: Matrix, b: number): Matrix;
export function sub(a: Vector, b: VectorOrScalar): number[];
export function sub(
  a: Matrix | Vector,
  b: Matrix | VectorOrScalar,
): Matrix | number[] {
  return dispatch(a, b, (x, y) => x - y);
}

/** R's `a * b`, entry by entry. With a scalar, `2 * a`. Never `%*%`. */
export function mul(a: Matrix, b: Matrix): Matrix;
export function mul(a: Matrix, b: number): Matrix;
export function mul(a: Vector, b: VectorOrScalar): number[];
export function mul(
  a: Matrix | Vector,
  b: Matrix | VectorOrScalar,
): Matrix | number[] {
  return dispatch(a, b, (x, y) => x * y);
}

/** R's `a / b`. */
export function div(a: Matrix, b: Matrix): Matrix;
export function div(a: Matrix, b: number): Matrix;
export function div(a: Vector, b: VectorOrScalar): number[];
export function div(
  a: Matrix | Vector,
  b: Matrix | VectorOrScalar,
): Matrix | number[] {
  return dispatch(a, b, (x, y) => x / y);
}

/** R's `a^2`. */
export function square(a: Vector): number[] {
  return a.map((x) => x * x);
}

/**
 * R's `sum(a * b)`: the inner product.
 *
 * @throws RangeError If the lengths differ.
 */
export function dot(a: Vector, b: Vector): number {
  requireSameLength(a, b);
  return sum(mul(a, b));
}

/**
 * R's `sqrt(sum(a^2))`: the Euclidean length.
 *
 * Written as a sum, not `Math.hypot(...a)`: the spread overflows the call
 * stack on a long vector, and the sum is the form R computes, so the two
 * round the same way.
 */
export function norm(a: Vector): number {
  return Math.sqrt(sum(square(a)));
}

/**
 * The cosine of the angle between two vectors: `dot(a, b) / (norm(a) * norm(b))`.
 *
 * Computed in exactly that order, which is the order a reader writes it in
 * R, so the port and R land on the same double — including
 * `cosine(a, a) = 1.0000000000000002` for a vector whose norm does not
 * square back to its sum of squares. A zero vector gives NaN, as `0 / 0` does
 * in R.
 *
 * @throws RangeError If the lengths differ.
 */
export function cosine(a: Vector, b: Vector): number {
  return dot(a, b) / (norm(a) * norm(b));
}
