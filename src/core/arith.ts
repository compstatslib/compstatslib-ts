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

/**
 * Return the arithmetic mean, as R's `mean()` computes it.
 *
 * **R has more than one arithmetic mean, and this is the corrected one.**
 * `mean.default` on a double vector goes to C `do_mean`
 * (`src/main/summary.c`), which sums, divides, and then makes a *second* pass
 * adding the mean of the residuals back:
 *
 * ```c
 * for (i = 0; i < n; i++) s += x[i];
 * s /= n;
 * if (R_FINITE((double) s)) {
 *     for (i = 0; i < n; i++) t += (x[i] - s);
 *     s += t/n;
 * }
 * ```
 *
 * The residuals sum to zero in exact arithmetic, so the correction looks like
 * a no-op and reads like one. It is not. The first pass rounds once per
 * addition and its error lands in `s`; the residuals `x[i] - s` are computed
 * against that rounded `s`, so their sum recovers the error rather than
 * cancelling. **`sum(x) / n` disagrees with R on 18053 of 20000 random
 * vectors**, by a median of 6 units in the last place and by far more where
 * cancellation leaves the mean near zero. A caller comparing two means with a
 * strict inequality — a bootstrap count, say — flips on that. See
 * `.claude/plans/006-PLAN-mean-parity/MEAN-PARITY.html` for the argument in
 * full, and `arith-fixtures.md` beside it for R's pinned values.
 *
 * The guard matters as much as the correction: a non-finite first pass is
 * returned as it stands, because the residual of an infinity would be
 * `Inf - Inf` and turn R's `Inf` into NaN.
 *
 * **Which R mean a routine wants is a parity decision, not a style one.**
 * Two other places in this package take a different one, and neither is a
 * bug:
 *
 * - `sd` below, and `cov`/`cor`/`var` in `core/linalg/cov.ts`, go to R's
 *   `src/library/stats/src/cov.c`, whose `MEAN` macro is this same corrected
 *   computation. They center on this mean. `cov.ts` writes its own
 *   `refinedMean` over `ArrayLike` rather than calling this one, because it
 *   centers `Float64Array` column slices in a loop a caller runs inside a
 *   bootstrap.
 * - `colMeans` in `core/linalg/scale.ts` is R's `do_colsum`
 *   (`src/main/array.c`), a single pass with **no** correction. `scale()` and
 *   so `prcomp()` center on that one, and routing them through this function
 *   would break their parity in the other direction.
 *
 * @param values The observations.
 * @returns The mean. An empty array gives NaN, where R gives NaN too.
 */
export function mean(values: readonly number[]): number {
  const first = sum(values) / values.length;
  if (!Number.isFinite(first)) {
    return first;
  }
  return first + sum(values.map((value) => value - first)) / values.length;
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
 * R's `sd()` is `sqrt(var())`, and `var()` goes to
 * `src/library/stats/src/cov.c`, whose `MEAN` macro is the same corrected
 * two-pass mean as `do_mean`. **So this centers on `mean` above, and that is
 * the parity-preserving choice rather than a convenience.** Centering on the
 * uncorrected `sum(x) / n` moves R's `sd` by a unit in the last place on the
 * conformance vector, and by up to three on a sweep of 20000.
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

/**
 * The arithmetic option the linear algebra routines share.
 *
 * `fma` selects how a product is rounded into its sum. The default, `true`,
 * rounds once, as the reference-BLAS build the conformance fixtures come
 * from does, so a result is R's double bit for bit. `false` rounds twice,
 * as plain `a * b + c` does. The two paths differ by a few units in the
 * last place, and the plain one runs 10 to 25 times faster. See the
 * README's linear algebra section for the measured ratios.
 *
 * **Which setting a caller wants is decided by its acceptance bar, not by
 * its patience.** The default is named after the guarantee it provides, and
 * that guarantee is narrow: *R's double*, not *R's answer*. A caller pinning
 * fixtures against R at 15 or 17 digits — this package's own test suite,
 * a port re-deriving R's published output — needs it, and the 10 to 25 times
 * is the price of the last two or three digits. A caller whose bar is R's
 * answer to five decimals is paying that price for a property it never
 * asserts on, and should pass `{ fma: false }`.
 *
 * `{ fma: false }` is therefore **not "the fast one"**. It is a different
 * answer. On a well-conditioned problem the difference is invisible; on one
 * near a conditioning threshold it need not be, because the units in the
 * last place a decomposition drops here are amplified by the condition
 * number on the way out. A consumer that measured this reported a downstream
 * fixture flipping under `{ fma: false }` where its own inner matrix was
 * structurally singular and the sign of the smallest eigenvalue (±1.3e-16)
 * was luck either way. Switch the setting deliberately, and re-pin whatever
 * the switch moves; do not switch it to make a benchmark look better.
 *
 * A routine resolves the option once with `resolveFma` and writes its
 * innermost loop twice, one body per setting, with the branch around the
 * loop. A multiply-add passed as a function would make its call site
 * polymorphic once a program had used both settings, and the engine would
 * then stop inlining it.
 */
export interface FmaOption {
  readonly fma?: boolean;
}

/**
 * Resolve the `fma` option for one call.
 *
 * A routine calls this once, before its loops, and branches on the result
 * around each innermost loop, so that each loop body calls one multiply-add
 * directly. The two loop bodies are written out because a multiply-add
 * passed as a function makes its call site polymorphic once a program has
 * used both settings, and the engine then stops inlining it: measured on
 * Bun 1.3.14, the default path lost 45% and the plain path lost 6× for the
 * rest of the process. A branch around the loop costs nothing measurable.
 *
 * @param fma The option as the caller gave it. `undefined` means the
 *   default, `true`.
 * @returns The setting as a boolean.
 * @throws TypeError If `fma` is anything other than a boolean or
 *   `undefined`. A truthy `1` or `"yes"` is refused rather than read as
 *   `true`, so a misspelled option cannot pass in silence.
 */
export function resolveFma(fma: boolean | undefined): boolean {
  if (fma === undefined || fma === true) {
    return true;
  }
  if (fma === false) {
    return false;
  }
  throw new TypeError(`fma must be true or false, got ${String(fma)}`);
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
 * The interpolation is written as `stats:::quantile.default` writes it,
 * `(1 - h) * low + h * high`, and **that is a decision, not a transcription
 * accident.** The algebraically equal `low + h * (high - low)` is the form
 * most implementations reach for, and it rounds differently: a consumer that
 * replaced its own paraphrase with this one found the two differing at **227
 * of 999 probabilities** on a 500-value bootstrap sample, always within one
 * unit in the last place. What makes that worth stating rather than filing
 * under implementation detail is where the differences are *not*: **none of
 * the seven round bootstrap probabilities** (0.025, 0.05, 0.5, 0.95, 0.975
 * and their neighbors) were among the 227, so a test probing only those
 * reports "no change" and is wrong. Anyone rewriting this expression should
 * probe a dense grid.
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
    // differently — at 227 of 999 probabilities on a 500-value sample, and
    // at none of the round bootstrap ones. See the docstring above before
    // rewriting this line.
    const h = position - below;
    return (1 - h) * low + h * high;
  }
  return low;
}
