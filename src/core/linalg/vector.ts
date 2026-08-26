/**
 * R's operators over vectors, by name.
 *
 * R vectors are not objects with methods: `a + 1`, `a * b` and `sum(a * b)`
 * are functions over plain vectors, with a scalar recycled to the length of
 * the other argument. This module is those functions with the operator
 * spelled out — `add(a, 1)`, `mul(a, b)`, `dot(a, b)` — over
 * `readonly number[]`. There is no vector type: a bare array is one (plan
 * Q11, Q12).
 *
 * R recycles any shorter vector, with a warning when the lengths do not
 * divide. The port recycles a scalar only and refuses every other mismatch:
 * a silent recycle lets a typo fit the wrong model.
 */

import { sum, zipWith } from "../arith";

/** A vector, or a scalar to recycle to the vector's length. */
export type VectorOrScalar = readonly number[] | number;

/** Combine two vectors element by element, or a vector with a scalar. */
function elementwise(
  a: readonly number[],
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
function requireSameLength(a: readonly number[], b: readonly number[]): void {
  if (a.length !== b.length) {
    throw new RangeError(`vector lengths differ: ${a.length} and ${b.length}`);
  }
}

/** R's `a + b`. */
export function add(a: readonly number[], b: VectorOrScalar): number[] {
  return elementwise(a, b, (x, y) => x + y);
}

/** R's `a - b`. */
export function sub(a: readonly number[], b: VectorOrScalar): number[] {
  return elementwise(a, b, (x, y) => x - y);
}

/** R's `a * b`. With a scalar, `2 * a`. */
export function mul(a: readonly number[], b: VectorOrScalar): number[] {
  return elementwise(a, b, (x, y) => x * y);
}

/** R's `a / b`. */
export function div(a: readonly number[], b: VectorOrScalar): number[] {
  return elementwise(a, b, (x, y) => x / y);
}

/** R's `a^2`. */
export function square(a: readonly number[]): number[] {
  return a.map((x) => x * x);
}

/**
 * R's `sum(a * b)`: the inner product.
 *
 * @throws RangeError If the lengths differ.
 */
export function dot(a: readonly number[], b: readonly number[]): number {
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
export function norm(a: readonly number[]): number {
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
export function cosine(a: readonly number[], b: readonly number[]): number {
  return dot(a, b) / (norm(a) * norm(b));
}
