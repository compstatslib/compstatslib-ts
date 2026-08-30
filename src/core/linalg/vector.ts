/**
 * R's operators over vectors, by name.
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
 */

import { sum, zipWith } from "../arith";

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

/** R's `a + b`. */
export function add(a: Vector, b: VectorOrScalar): number[] {
  return elementwise(a, b, (x, y) => x + y);
}

/** R's `a - b`. */
export function sub(a: Vector, b: VectorOrScalar): number[] {
  return elementwise(a, b, (x, y) => x - y);
}

/** R's `a * b`. With a scalar, `2 * a`. */
export function mul(a: Vector, b: VectorOrScalar): number[] {
  return elementwise(a, b, (x, y) => x * y);
}

/** R's `a / b`. */
export function div(a: Vector, b: VectorOrScalar): number[] {
  return elementwise(a, b, (x, y) => x / y);
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
