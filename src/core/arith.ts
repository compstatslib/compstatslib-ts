/**
 * Shared array arithmetic for the core modules.
 *
 * Use these helpers with `map` instead of index-based loops. See the
 * iteration convention in CLAUDE.md.
 */

/** Add all values. Return 0 for an empty array. */
export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Return the arithmetic mean. Return NaN for an empty array. */
export function mean(values: readonly number[]): number {
  return sum(values) / values.length;
}

/**
 * Combine two arrays element by element.
 *
 * Stop at the end of the shorter array.
 */
export function zipWith<A, B, C>(
  as: readonly A[],
  bs: readonly B[],
  combine: (a: A, b: B) => C,
): C[] {
  const length = Math.min(as.length, bs.length);
  // The slice bounds the index, so the access cannot be undefined.
  return as.slice(0, length).map((a, index) => combine(a, bs[index] as B));
}
