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

/**
 * Return the standard deviation, with the n − 1 denominator of R's `sd()`.
 *
 * @param values The observations.
 * @returns The standard deviation, or NaN below two values. R returns NA
 *   there, with a warning that a library cannot give.
 */
export function sd(values: readonly number[]): number {
  if (values.length < 2) {
    return Number.NaN;
  }

  const center = mean(values);
  const squares = values.map((value) => (value - center) * (value - center));
  return Math.sqrt(sum(squares) / (values.length - 1));
}

/**
 * Return a sample quantile, by the rule of R's `quantile(type = 7)`.
 *
 * Type 7 is the default of R's `quantile()`, and so the rule behind the
 * `IQR()` that `bw.nrd0()` uses to pick a bandwidth. It reads the sorted
 * values at position `1 + (n - 1) * p` and interpolates between the two
 * neighbors of a fractional position.
 *
 * @param values The observations. The function does not modify them.
 * @param p The probability. It must be in [0, 1].
 * @returns The quantile, or NaN for no values. R returns NA there.
 * @throws RangeError If p is outside [0, 1], as R does.
 */
export function quantile(values: readonly number[], p: number): number {
  return quantiles(values, [p])[0] as number;
}

/**
 * Return several sample quantiles, by the rule of R's `quantile(type = 7)`.
 *
 * R's `quantile()` also takes a vector of probabilities, and for one reason:
 * it sorts once and reads every position off the one sorted copy. Asking for
 * the two quartiles together instead of one at a time halves the work, which
 * is what the bandwidth rule does over a pooled sample.
 *
 * @param values The observations. The function does not modify them.
 * @param probs The probabilities. Each must be in [0, 1].
 * @returns One quantile per probability, in the order given. Each is NaN for
 *   no values, where R returns NA.
 * @throws RangeError If a probability is outside [0, 1], as R does.
 */
export function quantiles(
  values: readonly number[],
  probs: readonly number[],
): number[] {
  if (probs.some((p) => !(p >= 0 && p <= 1))) {
    throw new RangeError(`every probability must be in [0, 1], got ${probs}`);
  }
  if (values.length === 0) {
    return probs.map(() => Number.NaN);
  }

  // A Float64Array sorts by value with no comparator to call, which is about
  // three times faster than sorting a copy of the array over a pooled sample.
  const sorted = Float64Array.from(values).sort();

  return probs.map((p) => type7(sorted, p));
}

/** Read one type-7 quantile off already sorted values. */
function type7(sorted: Float64Array, p: number): number {
  const position = 1 + (sorted.length - 1) * p;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  // Both indices are inside the array: p in [0, 1] bounds the position by
  // 1 and by the length.
  const low = sorted[below - 1] as number;
  const high = sorted[above - 1] as number;

  if (position > below && high !== low) {
    // R's own form. The algebraically equal low + h * (high - low) rounds
    // differently, and this keeps the last bits with R.
    const h = position - below;
    return (1 - h) * low + h * high;
  }
  return low;
}
