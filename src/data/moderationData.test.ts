/**
 * Tests for the bundled `moderation_data` export.
 *
 * The 800 values of the module come from `.claude/plans/001-PLAN-port/moderation-data.tsv`,
 * a `%.17g` dump of `../compstatslib/data/moderation_data.rda`. Rather than
 * repeat all of them here, these tests assert the column checksums of
 * `.claude/plans/001-PLAN-port/moderation-fixtures.md` section 1, plus the first and last
 * row, which together catch a truncated, reordered, or mistyped column.
 *
 * R script that produced the checksums:
 *
 * ```r
 * load("../compstatslib/data/moderation_data.rda")
 * fmt <- function(x) sprintf("%.17g", x)
 * for (col in c("y", "x", "z", "w")) {
 *   v <- moderation_data[[col]]
 *   cat(col, length(v), fmt(sum(v)), fmt(mean(v)), fmt(sd(v)),
 *       fmt(min(v)), fmt(max(v)), "\n")
 * }
 * moderation_data[1, ]; moderation_data[200, ]
 * ```
 *
 * ## Exact where R's arithmetic is exact
 *
 * `min` and `max` pick a value out of the column, so they are compared with
 * `toBe`. R's `sum`, `mean` and `sd` accumulate in long double on this
 * platform, and `mean` runs a second pass to correct the result, so a double
 * accumulation in JavaScript need not land on the same last bit. Those three
 * are compared with the relative tolerance below, and the margins measured
 * are recorded next to each assertion.
 */

import { describe, expect, test } from "bun:test";

import { mean, sd, sum } from "../core/arith";
import { moderationData } from "./moderationData";

/** Relative tolerance for the accumulated checksums. */
const RELATIVE_TOLERANCE = 1e-12;

function expectCloseToR(actual: number, expected: number): void {
  const tolerance = RELATIVE_TOLERANCE * Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

interface Checksums {
  readonly sum: number;
  readonly mean: number;
  readonly sd: number;
  readonly min: number;
  readonly max: number;
}

/** Section 1 of the fixture document, verbatim. */
const CHECKSUMS: Readonly<Record<"y" | "x" | "z" | "w", Checksums>> = {
  y: {
    sum: -63.124604196879652,
    mean: -0.31562302098439832,
    sd: 3.6235641115369814,
    min: -14.110628278307653,
    max: 18.102464141094789,
  },
  x: {
    sum: -10.99377831184721,
    mean: -0.054968891559236094,
    sd: 1.9491703629655268,
    min: -5.9861801663058696,
    max: 5.4037820006895947,
  },
  z: {
    sum: 4.5136585403567038,
    mean: 0.022568292701783489,
    sd: 1.8941612710648057,
    min: -5.3998596171274054,
    max: 4.9191870977408296,
  },
  w: {
    sum: -51.207745009641833,
    mean: -0.25603872504820924,
    sd: 1.8581307792559159,
    min: -6.0358653588357924,
    max: 4.447068603816132,
  },
};

const COLUMN_NAMES = ["y", "x", "z", "w"] as const;

describe("moderationData", () => {
  test("keeps the four columns of the R data frame, in file order", () => {
    expect(Object.keys(moderationData)).toEqual([...COLUMN_NAMES]);
    // Four named but empty columns would otherwise pass this.
    expect(
      Object.values(moderationData).every((column) => column.length === 200),
    ).toBe(true);
  });

  test("holds 200 rows in every column", () => {
    COLUMN_NAMES.forEach((name) => {
      expect(moderationData[name]).toHaveLength(200);
    });
  });

  COLUMN_NAMES.forEach((name) => {
    describe(`column ${name}`, () => {
      const values = moderationData[name];
      const expected = CHECKSUMS[name];

      test("sums to R's total", () => {
        expectCloseToR(sum(values), expected.sum);
      });

      test("has R's mean", () => {
        expectCloseToR(mean(values), expected.mean);
      });

      test("has R's standard deviation", () => {
        expectCloseToR(sd(values), expected.sd);
      });

      test("has R's minimum, exactly", () => {
        expect(Math.min(...values)).toBe(expected.min);
      });

      test("has R's maximum, exactly", () => {
        expect(Math.max(...values)).toBe(expected.max);
      });

      test("holds only finite values", () => {
        // Counted, not tested with `every`, which is true of no values at all.
        expect(values.filter((value) => Number.isFinite(value))).toHaveLength(
          200,
        );
      });
    });
  });

  test("reproduces the first row of the R data frame, exactly", () => {
    expect(moderationData.y[0]).toBe(-7.2728972000711964);
    expect(moderationData.x[0]).toBe(2.741916894293337);
    expect(moderationData.z[0]).toBe(-4.0018584754630222);
    expect(moderationData.w[0]).toBe(-0.49696586637986573);
  });

  test("reproduces the last row of the R data frame, exactly", () => {
    expect(moderationData.y[199]).toBe(2.0982441518090775);
    expect(moderationData.x[199]).toBe(0.25764285720476621);
    expect(moderationData.z[199]).toBe(1.8620658029697648);
    expect(moderationData.w[199]).toBe(-2.0665941582107541);
  });
});
