/**
 * Tests for the histogram, R's `hist(plot = FALSE)` with its defaults.
 *
 * `plot_sampling()` draws its third panel with `hist(sample_theta, ...)` and
 * reads `counts` back for the panel label, so this ports the default path:
 * Sturges cell count, `pretty()` edges, right-closed cells, and the lowest
 * edge held open by the fuzz rule.
 *
 * Expected values come from R 4.5.3. The `th7`, `th30`, boundary, constant
 * and single-value cases are Section 2b of
 * `.claude/plans/sampling-fixtures.md`; the rest were computed in session
 * with `hist(x, plot = FALSE)`, named at each assertion.
 *
 * Counts are integers and are asserted exactly. Breaks come from `rPretty`
 * and are asserted exactly too — see `pretty.test.ts` for why that is safe.
 *
 * How R decides which cell a value on an edge belongs to, since it is the
 * part most easily got wrong: cells are right-closed, `(b[k], b[k+1]]`, so a
 * value sitting on an edge counts into the cell *below* it. That would drop
 * the smallest value, which sits on the first edge, so R nudges the edges by
 * a fuzz of 1e-7 of a cell width before counting — the first edge outward and
 * every other edge upward. The reported breaks are the unfuzzed ones.
 */

import { describe, expect, test } from "bun:test";

import { histogram, nclassSturges } from "./histogram";

/** Section 2b: seven sampling statistics. */
const th7 = [49.8, 50.1, 50.4, 49.6, 50.0, 50.9, 49.2] as const;

/** Section 2b: `round(seq(48.7, 52.1, length.out = 30), 3)`. */
const th30 = [
  48.7, 48.817, 48.934, 49.052, 49.169, 49.286, 49.403, 49.521, 49.638, 49.755,
  49.872, 49.99, 50.107, 50.224, 50.341, 50.459, 50.576, 50.693, 50.81, 50.928,
  51.045, 51.162, 51.279, 51.397, 51.514, 51.631, 51.748, 51.866, 51.983, 52.1,
] as const;

/** Section 2b: values sitting exactly on candidate edges. */
const boundary = [0, 0.5, 1, 1.5, 2, 2.5, 3] as const;

describe("nclassSturges", () => {
  test("matches R's ceiling(log2(n) + 1)", () => {
    // R: nclass.Sturges(numeric(n)) for each n.
    expect(nclassSturges(new Array<number>(1).fill(0))).toBe(1);
    expect(nclassSturges(new Array<number>(2).fill(0))).toBe(2);
    expect(nclassSturges(new Array<number>(3).fill(0))).toBe(3);
    expect(nclassSturges(new Array<number>(4).fill(0))).toBe(3);
    expect(nclassSturges([...th7])).toBe(4);
    expect(nclassSturges(new Array<number>(8).fill(0))).toBe(4);
    expect(nclassSturges(new Array<number>(9).fill(0))).toBe(5);
    expect(nclassSturges([...th30])).toBe(6);
    expect(nclassSturges(new Array<number>(100).fill(0))).toBe(8);
    expect(nclassSturges(new Array<number>(1000).fill(0))).toBe(11);
  });

  test("returns -Infinity for no values, as R does", () => {
    // R: nclass.Sturges(numeric(0)) is -Inf, which is what makes hist() stop
    // with "invalid number of 'breaks'".
    expect(nclassSturges([])).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("histogram, the fixtures of Section 2b", () => {
  test("counts seven sampling statistics into four cells", () => {
    const result = histogram(th7);

    expect(result.breaks).toEqual([49, 49.5, 50, 50.5, 51]);
    expect(result.counts).toEqual([1, 3, 2, 1]);
    expect(result.mids).toEqual([49.25, 49.75, 50.25, 50.75]);
  });

  test("counts thirty sampling statistics into eight cells", () => {
    const result = histogram(th30);

    expect(result.breaks).toEqual([48.5, 49, 49.5, 50, 50.5, 51, 51.5, 52, 52.5]);
    expect(result.counts).toEqual([3, 4, 5, 4, 4, 4, 5, 1]);
    expect(result.mids).toEqual([
      48.75, 49.25, 49.75, 50.25, 50.75, 51.25, 51.75, 52.25,
    ]);
  });

  test("puts every value that lands on an edge into the cell below it", () => {
    // Automatic edges 0, 1, 2, 3: cell 1 keeps 0 (rescued by the open lowest
    // edge), 0.5 and 1; cell 2 keeps 1.5 and 2; cell 3 keeps 2.5 and 3.
    const result = histogram(boundary);

    expect(result.breaks).toEqual([0, 1, 2, 3]);
    expect(result.counts).toEqual([3, 2, 2]);
  });

  test("keeps that rule when the caller gives the edges", () => {
    // R: hist(boundary_vec, breaks = boundary_vec). Every value is the upper
    // edge of its cell, except 0, which only the open lowest edge admits.
    const result = histogram(boundary, { breaks: boundary });

    expect(result.breaks).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    expect(result.counts).toEqual([2, 1, 1, 1, 1, 1]);
    expect(result.mids).toEqual([0.25, 0.75, 1.25, 1.75, 2.25, 2.75]);
  });

  test("draws one cell for constant values, without failing", () => {
    const result = histogram([5, 5, 5, 5]);

    expect(result.breaks).toEqual([0, 5]);
    expect(result.counts).toEqual([4]);
    expect(result.mids).toEqual([2.5]);
  });

  test("draws one cell for a single value", () => {
    const result = histogram([7]);

    expect(result.breaks).toEqual([5, 10]);
    expect(result.counts).toEqual([1]);
  });
});

describe("histogram, cases computed in session", () => {
  test("handles values on both sides of zero", () => {
    // R: hist(c(-3.2, -1.1, 0, 2.5, -4.9, 1.1, 0.4, -2.2), plot = FALSE).
    const result = histogram([-3.2, -1.1, 0, 2.5, -4.9, 1.1, 0.4, -2.2]);

    expect(result.breaks).toEqual([-6, -4, -2, 0, 2, 4]);
    expect(result.counts).toEqual([1, 2, 2, 2, 1]);
  });

  test("counts two values", () => {
    // R: hist(c(1, 2), plot = FALSE).
    const result = histogram([1, 2]);

    expect(result.breaks).toEqual([1, 1.5, 2]);
    expect(result.counts).toEqual([1, 1]);
  });

  test("counts a wide spread", () => {
    // R: hist(c(0, 1000, 500, 250, 750, 100, 900, 333), plot = FALSE).
    const result = histogram([0, 1000, 500, 250, 750, 100, 900, 333]);

    expect(result.breaks).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(result.counts).toEqual([2, 2, 1, 1, 2]);
  });

  test("counts thirty draws from a normal population", () => {
    // R: set.seed(11); hist(round(rnorm(30, 50, 2), 4), plot = FALSE).
    const values = [
      48.8179, 50.0532, 46.9669, 47.2747, 52.357, 48.1317, 52.6472, 51.2498,
      49.9086, 47.9918, 48.3431, 49.3033, 46.9234, 49.4889, 47.7001, 50.0247,
      49.5541, 51.7755, 48.8157, 48.6886, 48.635, 49.9683, 49.1148, 50.7051,
      50.1463, 50.0143, 49.6248, 48.4686, 49.5579, 48.0328,
    ];
    const result = histogram(values);

    expect(result.breaks).toEqual([46, 47, 48, 49, 50, 51, 52, 53]);
    expect(result.counts).toEqual([2, 3, 8, 8, 5, 2, 2]);
  });
});

describe("histogram with a requested cell count", () => {
  test("treats the count as a suggestion, as R's pretty() does", () => {
    // R: hist(th30, breaks = 10, plot = FALSE) lands on the same eight cells
    // the Sturges count of 6 gives.
    const result = histogram(th30, { breaks: 10 });

    expect(result.breaks).toEqual([48.5, 49, 49.5, 50, 50.5, 51, 51.5, 52, 52.5]);
    expect(result.counts).toEqual([3, 4, 5, 4, 4, 4, 5, 1]);
  });

  test("widens the cells for a small count", () => {
    // R: hist(th30, breaks = 3, plot = FALSE).
    const result = histogram(th30, { breaks: 3 });

    expect(result.breaks).toEqual([48, 49, 50, 51, 52, 53]);
    expect(result.counts).toEqual([3, 9, 8, 9, 1]);
  });
});

describe("histogram guards and non-finite values", () => {
  test("drops values that are not finite, as R does", () => {
    // R: hist(c(1, 2, 3, Inf)) and hist(c(1, 2, 3, NA)) both count only the
    // three finite values. Note the difference from kernelDensity, which
    // refuses NaN because R's density() does.
    const withInfinity = histogram([1, 2, 3, Number.POSITIVE_INFINITY]);
    const withMissing = histogram([1, 2, 3, Number.NaN]);

    expect(withInfinity.breaks).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(withInfinity.counts).toEqual([1, 1, 0, 1]);
    expect(withMissing.breaks).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(withMissing.counts).toEqual([1, 1, 0, 1]);
  });

  test("refuses no values at all", () => {
    // R: hist(numeric(0)) stops with "invalid number of 'breaks'", because
    // the Sturges count of an empty vector is -Inf.
    expect(() => histogram([])).toThrow(RangeError);
    expect(() => histogram([Number.NaN])).toThrow(RangeError);
  });

  test("refuses edges that do not span the values, as R does", () => {
    // R: "some 'x' not counted; maybe 'breaks' do not span range of 'x'".
    expect(() => histogram([1, 2, 9], { breaks: [0, 3] })).toThrow(RangeError);
  });

  test("refuses fewer than two edges", () => {
    // A deliberate difference from R. R reads a length-one `breaks` vector as
    // a cell count — hist(c(1,2,3), breaks = 1) gives edges 0, 2, 4 — because
    // R cannot tell the two apart. TypeScript can: a caller who passes an
    // array meant edges, and one edge does not bound a cell.
    expect(() => histogram([1, 2, 3], { breaks: [1] })).toThrow(RangeError);
  });

  test("sorts the edges it is given, as R does", () => {
    // R: hist(boundary_vec, breaks = c(3, 0, 1.5), plot = FALSE).
    const result = histogram(boundary, { breaks: [3, 0, 1.5] });

    expect(result.breaks).toEqual([0, 1.5, 3]);
    expect(result.counts).toEqual([4, 3]);
  });

  test("refuses a cell count below one", () => {
    // R: "invalid number of 'breaks'".
    expect(() => histogram(th7, { breaks: 0 })).toThrow(RangeError);
  });
});
