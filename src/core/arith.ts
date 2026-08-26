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
 * Return the smallest and the largest value, as R's `range()` does.
 *
 * Written as a fold rather than `Math.min(...values)`, which overflows the
 * call stack on a long column.
 *
 * @param values The observations.
 * @returns The lowest and the highest value. An empty array returns
 *   [Infinity, -Infinity], the shape of R's `range(numeric(0))`.
 *
 * A comparison keeps the accumulator when it is false, so a NaN entry is
 * skipped rather than carried through. No caller supports NaN input: the
 * modules that call this either drop the non-finite values first or state
 * that they do not handle R's NA.
 */
export function extent(values: readonly number[]): [number, number] {
  return values.reduce<[number, number]>(
    ([low, high], value) => [
      value < low ? value : low,
      value > high ? value : high,
    ],
    [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  );
}

/**
 * Map a negative zero to a positive one.
 *
 * A computed zero can come out of an algorithm with a sign that R's own
 * zeros never carry: of 1498 zero entries of a matrix inverse over a sweep of
 * 20000 slider settings, R gives a positive zero every time.
 */
export function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/** Reject a count that is not a non-negative integer. */
export function requireCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
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
 * Return the mean absolute deviation, `mean(|x - mean(x)|)`.
 *
 * R base has no function for this. R's `mad()` is the *median* absolute
 * deviation from the median, scaled by 1.4826, which is a different
 * statistic. A caller that shows either one to a reader must write the name
 * in full, because the abbreviation covers both.
 *
 * The sampling demonstration offers this as one of its choices of statistic.
 * It measures spread in the units of the data, as the standard deviation
 * does, but a value far from the mean moves it less, because the distance is
 * not squared.
 *
 * @param values The observations.
 * @returns The mean distance from the mean. One value gives 0, because it
 *   sits at its own mean. No values gives NaN, as `mean` does.
 */
export function meanAbsoluteDeviation(values: readonly number[]): number {
  const center = mean(values);
  return mean(values.map((value) => Math.abs(value - center)));
}

/**
 * Return `a * b + c`, rounded once.
 *
 * Written as `a * b + c`, JavaScript rounds twice — once for the product,
 * once for the sum — and the two roundings show. R's `seq.int` rounds once
 * and lands one unit in the last place away often enough to change a tick.
 * The linear algebra in `matrix.ts` needs the same: the compiler of the R
 * install the fixtures come from contracts a multiply and an add into one
 * instruction, so a matrix near singular differs in every digit without it.
 *
 * The two helpers below split each operation into the value a double can
 * hold plus the part it drops, so the dropped parts can be added back before
 * the one rounding that remains. Both are the standard error-free
 * transformations (Dekker 1971, Knuth). Both need every intermediate to stay
 * in range, which fails only within a factor of 2^28 of the largest double.
 * There the plain form is used: the result is already dominated by its own
 * overflow.
 */
export function fusedMultiplyAdd(a: number, b: number, c: number): number {
  // A zero product adds exactly, and only the plain form keeps the sign of
  // a zero sum the way the hardware instruction does: fma(-1, 0, -0) is -0.
  if (a * b === 0) {
    return c + a * b;
  }
  const [product, productError] = twoProduct(a, b);
  const [sum, sumError] = twoSum(c, product);
  const rounded = sum + (sumError + productError);
  return Number.isFinite(rounded) ? rounded : a * b + c;
}

/** Split a double into two halves whose product is exact. Dekker's method. */
function split(value: number): [number, number] {
  const scaled = 134217729 * value;
  const high = scaled - (scaled - value);
  return [high, value - high];
}

/** Return the product and the part of it the product cannot hold. */
function twoProduct(a: number, b: number): [number, number] {
  const product = a * b;
  const [aHigh, aLow] = split(a);
  const [bHigh, bLow] = split(b);
  const error =
    aLow * bLow - (product - aHigh * bHigh - aLow * bHigh - aHigh * bLow);
  return [product, error];
}

/** Return the sum and the part of it the sum cannot hold. */
function twoSum(a: number, b: number): [number, number] {
  const sum = a + b;
  const carried = sum - a;
  return [sum, a - (sum - carried) + (b - carried)];
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

/**
 * Return the median, the value with half the observations on each side.
 *
 * R's `median()` sorts the values and, on an even count, averages the two in
 * the middle. That is the type-7 quantile at 0.5, which weights those same two
 * values by a half each, so this delegates rather than repeat the rule. The
 * two forms land on the same double, the halves included.
 *
 * The sampling demonstration offers this as one of its choices of statistic.
 * It marks the center in the units of the data, as the mean does, but a value
 * far from the center moves it very little, because only the ordering counts.
 *
 * @param values The observations. The function does not modify them.
 * @returns The median, or NaN for no values. R returns NA there.
 */
export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
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
