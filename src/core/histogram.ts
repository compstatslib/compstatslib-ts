/**
 * Counts of values per cell — R's `hist(plot = FALSE)` with its defaults.
 *
 * `plot_sampling()` draws its third panel from this: it accumulates one
 * statistic per sample and calls `hist()` on the running collection, then
 * reads `counts` back to place the panel's label. Verified against R 4.5.3 in
 * `histogram.test.ts`.
 *
 * Three rules carry the behavior, and each one is easy to get subtly wrong:
 *
 * 1. **How many cells.** Sturges' rule, `ceiling(log2(n) + 1)`, is only a
 *    suggestion. It goes to `rPretty`, which returns round edges covering the
 *    data — often a different count.
 * 2. **Which cell a value belongs to.** Cells are closed on the right,
 *    `(edge[k], edge[k+1]]`, so a value sitting on an edge counts into the
 *    cell below it. The lowest edge is the exception: nothing sits below it,
 *    so it is opened to admit the smallest value.
 * 3. **Values that land on an edge.** Rounding leaves a value that ought to
 *    sit on an edge a hair to one side of it. R nudges the edges by a
 *    millionth of a cell before counting — outward at the bottom, upward
 *    everywhere else — so such a value still lands where it belongs. The
 *    reported edges are the unnudged ones.
 */

import { quantile, zipWith } from "./arith";
import { rPretty } from "./pretty";

/** R's `fuzz` argument of `hist.default`, in cell widths. */
const FUZZ = 1e-7;

/** What the caller may change. R's drawing arguments are not ported. */
export interface HistogramOptions {
  /**
   * How to place the cell edges.
   *
   * A number asks for about that many cells, which `rPretty` rounds off; an
   * array gives the edges outright. The default is Sturges' rule. R takes the
   * same two forms in one argument, but cannot tell a one-edge array from a
   * request for one cell — this port reads an array as edges, always.
   */
  readonly breaks?: number | readonly number[];
}

/** The counted histogram, in the shape of R's `histogram` object. */
export interface Histogram {
  /** The cell edges, in increasing order. One more than there are cells. */
  readonly breaks: readonly number[];
  /** How many values fell in each cell. */
  readonly counts: readonly number[];
  /** The midpoint of each cell, R's `mids`. */
  readonly mids: readonly number[];
}

/**
 * Suggest a cell count by Sturges' rule — R's `nclass.Sturges`.
 *
 * @param values The observations. Only how many there are matters.
 * @returns `ceiling(log2(n) + 1)`, or -Infinity for no values. R returns -Inf
 *   there too, which is what makes its `hist()` stop.
 */
export function nclassSturges(values: readonly number[]): number {
  return Math.ceil(Math.log2(values.length) + 1);
}

/**
 * Count the values into cells.
 *
 * Values that are not finite are dropped first, as R does — including NaN,
 * which R reads as a missing value and drops here. Note the difference from
 * `kernelDensity`, which refuses NaN, because R's `density()` refuses it.
 *
 * @param values The observations.
 * @param options How to place the cell edges.
 * @returns The edges, the count in each cell, and the cell midpoints.
 * @throws RangeError If no value is finite, if a requested cell count is
 *   below one or fractional, if fewer than two edges are given, or if the
 *   given edges leave a value uncounted. R stops in all of those cases too.
 */
export function histogram(
  values: readonly number[],
  options: HistogramOptions = {},
): Histogram {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    throw new RangeError("need at least 1 finite value, got none");
  }

  const breaks = resolveBreaks(finite, options.breaks);
  const widths = zipWith(
    breaks.slice(1),
    breaks.slice(0, -1),
    (up, low) => up - low,
  );
  const counts = binCount(finite, fuzzyBreaks(breaks, widths, finite));

  if (sumOf(counts) < finite.length) {
    throw new RangeError(
      "some values were not counted; the breaks may not span their range",
    );
  }

  return {
    breaks,
    counts,
    mids: zipWith(breaks.slice(1), breaks.slice(0, -1), (up, low) =>
      0.5 * (up + low),
    ),
  };
}

/** Place the cell edges, from Sturges' rule, a wish, or the caller's array. */
function resolveBreaks(
  finite: readonly number[],
  requested: number | readonly number[] | undefined,
): number[] {
  // Narrowing by `typeof`, not Array.isArray: the latter narrows to a mutable
  // array and so leaves a readonly array in the union.
  if (requested !== undefined && typeof requested !== "number") {
    if (requested.length < 2) {
      throw new RangeError(
        `breaks given as edges need at least 2 of them, got ${requested.length}`,
      );
    }
    return [...requested].sort((a, b) => a - b);
  }

  const cells = requested ?? nclassSturges(finite);
  if (!Number.isInteger(cells) || cells < 1) {
    throw new RangeError(`invalid number of breaks: ${cells}`);
  }

  // R's hist() overrides pretty()'s own min.n here, and asks for 1.
  return rPretty(lowestOf(finite), highestOf(finite), { n: cells, minN: 1 });
}

/**
 * Nudge the edges so a value sitting on one lands in the right cell.
 *
 * The size of the nudge follows R: the middle cell width when there are many
 * cells, the narrowest when there are few, and the width of the data itself
 * when there are almost none.
 */
function fuzzyBreaks(
  breaks: readonly number[],
  widths: readonly number[],
  finite: readonly number[],
): number[] {
  const positive = widths.filter((width) => width > 0);
  const scale =
    breaks.length > 5
      ? quantile(widths, 0.5)
      : breaks.length <= 3
        ? highestOf(finite) - lowestOf(finite)
        : Math.min(...positive);
  const nudge = FUZZ * scale;

  // The lowest edge moves outward to admit the smallest value; every other
  // edge moves up, since each one closes the cell below it.
  return breaks.map((edge, index) =>
    index === 0 ? edge - nudge : edge + nudge,
  );
}

/**
 * Find the cell of each value and count it — R's `C_BinCount`.
 *
 * The search is R's bisection, written the same way: a value above the middle
 * edge belongs to the upper half, and a value exactly on it belongs to the
 * lower half, because cells close on the right.
 */
function binCount(
  values: readonly number[],
  breaks: readonly number[],
): number[] {
  const counts = new Array<number>(breaks.length - 1).fill(0);
  const last = breaks.length - 1;

  // An index loop, against the map convention of CLAUDE.md: each value walks
  // a bisection and then adds to one entry of a shared accumulator.
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (value < (breaks[0] as number) || value > (breaks[last] as number)) {
      continue;
    }

    let low = 0;
    let high = last;
    while (high - low >= 2) {
      const middle = (high + low) >> 1;
      if (value > (breaks[middle] as number)) {
        low = middle;
      } else {
        high = middle;
      }
    }
    counts[low] += 1;
  }

  return counts;
}

/** Return the smallest value. The array must not be empty. */
function lowestOf(values: readonly number[]): number {
  return values.reduce((low, value) => (value < low ? value : low));
}

/** Return the largest value. The array must not be empty. */
function highestOf(values: readonly number[]): number {
  return values.reduce((high, value) => (value > high ? value : high));
}

/** Add the counts. They are small integers, so plain addition is exact. */
function sumOf(counts: readonly number[]): number {
  return counts.reduce((total, count) => total + count, 0);
}
