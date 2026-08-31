/**
 * Tests for R's normal distribution functions, `pnorm()` and `qnorm()`.
 *
 * Every expected value below comes from R 4.5.3, printed at full double
 * precision with `sprintf("%.17g", x)`. Do not edit these numbers by hand.
 * Source: `.claude/plans/004-PLAN-seminr-utilities/distributions-fixtures.md`,
 * section 4. The canonical generator is the R script
 * `../compstatslib/conformance-fixtures/distributions.R`.
 *
 * The probability grid holds the exact doubles the fixture prints, so `1e-300`
 * appears as `9.9999999999999936e-301` and `1 - 1e-16` as
 * `0.99999999999999989`. Most are the same double as the expression they
 * name. At the far ends the `%.17g` print does not read back as the double R
 * started from: `9.9999999999999936e-301` sits three units in the last place
 * below `1e-300`. The tests pass the printed doubles, and that gap moves a
 * quantile far less than the tolerance below allows.
 *
 * Both tails are pinned at every point. `pnorm(-40)` underflows to zero while
 * `pnorm(-38)` is still a subnormal, so the upper tail has to be its own
 * formula rather than one minus the lower one.
 */

import { describe, expect, test } from "bun:test";

import { pnorm, qnorm } from "./norm";

/**
 * Relative tolerance for all comparisons against R.
 *
 * This is the `tdist.test.ts` convention. R reaches these values through its
 * own Cody rational approximations and Wichura's AS 241, and the port through
 * the same algorithms, so the two agree to a few units in the last place.
 */
const RELATIVE_TOLERANCE = 1e-12;

/**
 * Assert that a value agrees with R to a relative tolerance.
 *
 * The floor at 1e-300 keeps the rule usable on the far tails, where a
 * relative bound would fall below the smallest double and demand agreement no
 * routine can promise. The subnormal values have their own test below. A
 * value R reports as exactly zero is pinned as zero, because it underflows
 * there in any implementation.
 */
function expectCloseToR(
  actual: number,
  expected: number,
  tolerance: number = RELATIVE_TOLERANCE,
): void {
  if (expected === 0) {
    expect(actual).toBe(0);
    return;
  }
  const bound = tolerance * Math.max(Math.abs(expected), 1e-300);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(bound);
}

/** One `z` and the two tail probabilities R reports there. */
type ProbabilityRow = readonly [z: number, lower: number, upper: number];

/** One probability and the two quantiles R reports for it. */
type QuantileRow = readonly [p: number, lower: number, upper: number];

/** Section 4a: `pnorm()` across both tails, from underflow to underflow. */
const probabilities: readonly ProbabilityRow[] = [
  [-40, 0, 1],
  [-38, 2.8854283510039645e-316, 1],
  [-37.5, 4.6053530095819552e-308, 1],
  [-30, 4.9067139271481872e-198, 1],
  [-20, 2.7536241186062337e-89, 1],
  [-10, 7.6198530241605269e-24, 1],
  [-8, 6.2209605742717849e-16, 0.99999999999999933],
  [-5, 2.8665157187919391e-07, 0.99999971334842808],
  [-3, 0.0013498980316300946, 0.9986501019683699],
  [-2, 0.022750131948179212, 0.97724986805182079],
  [-1.5, 0.066807201268858071, 0.93319279873114191],
  [-1, 0.15865525393145705, 0.84134474606854293],
  [-0.5, 0.30853753872598694, 0.69146246127401301],
  [-0.1, 0.46017216272297101, 0.53982783727702899],
  [0, 0.5, 0.5],
  [0.1, 0.53982783727702899, 0.46017216272297101],
  [0.5, 0.69146246127401301, 0.30853753872598694],
  [1, 0.84134474606854293, 0.15865525393145705],
  [1.5, 0.93319279873114191, 0.066807201268858071],
  [2, 0.97724986805182079, 0.022750131948179212],
  [3, 0.9986501019683699, 0.0013498980316300946],
  [5, 0.99999971334842808, 2.8665157187919391e-07],
  [8, 0.99999999999999933, 6.2209605742717849e-16],
  [10, 1, 7.6198530241605269e-24],
  [20, 1, 2.7536241186062337e-89],
  [30, 1, 4.9067139271481872e-198],
  [37.5, 1, 4.6053530095819552e-308],
  [38, 1, 2.8854283510039645e-316],
  [40, 1, 0],
];

/** Section 4b: `qnorm()` across the three regions of Wichura's AS 241. */
const quantiles: readonly QuantileRow[] = [
  [9.9999999999999936e-301, -37.047096299361201, 37.047096299361201],
  [9.9999999999999955e-201, -30.205594179579641, 30.205594179579641],
  [9.9999999999999977e-101, -21.273453560965322, 21.273453560965322],
  [9.9999999999999989e-51, -14.933337534788489, 14.933337534788489],
  [9.9999999999999995e-21, -9.262340089798407, 9.262340089798407],
  [9.9999999999999998e-17, -8.2220822161304365, 8.2220822161304365],
  [1e-10, -6.3613409024040566, 6.3613409024040566],
  [1e-08, -5.6120012441747882, 5.6120012441747882],
  [1.0000000000000001e-05, -4.2648907939228247, 4.2648907939228247],
  [0.001, -3.0902323061678132, 3.0902323061678132],
  [0.01, -2.3263478740408408, 2.3263478740408408],
  [0.025000000000000001, -1.9599639845400538, 1.9599639845400538],
  [0.050000000000000003, -1.6448536269514722, 1.6448536269514722],
  [0.074999999999999997, -1.4395314709384559, 1.4395314709384555],
  [0.10000000000000001, -1.2815515655446006, 1.2815515655446006],
  [0.25, -0.67448975019608171, 0.67448975019608171],
  [0.40000000000000002, -0.25334710313579978, 0.25334710313579978],
  [0.5, 0, 0],
  [0.59999999999999998, 0.25334710313579978, -0.25334710313579978],
  [0.75, 0.67448975019608171, -0.67448975019608171],
  [0.90000000000000002, 1.2815515655446006, -1.2815515655446006],
  [0.92500000000000004, 1.4395314709384559, -1.4395314709384559],
  [0.94999999999999996, 1.6448536269514715, -1.6448536269514715],
  [0.97499999999999998, 1.9599639845400534, -1.9599639845400534],
  [0.98999999999999999, 2.3263478740408408, -2.3263478740408408],
  [0.99999000000000005, 4.2648907939238416, -4.2648907939238416],
  [0.99999998999999995, 5.6120012433055058, -5.6120012433055058],
  [0.99999999989999999, 6.3613408896974226, -6.3613408896974226],
  [0.99999999999999989, 8.2095361516013856, -8.2095361516013856],
];

describe("pnorm", () => {
  test("matches R in both tails over the grid", () => {
    for (const [z, lower, upper] of probabilities) {
      expectCloseToR(pnorm(z), lower);
      expectCloseToR(pnorm(z, { lowerTail: false }), upper);
    }
  });

  /**
   * The two smallest values R still reports need a tighter rule than the
   * shared one, whose floor is above them. The bound is absolute at 1e-320,
   * a few subnormal steps, so the tail formula cannot be replaced by one
   * minus the other half without the test noticing.
   */
  test("keeps the subnormal tail R reports at -38 and -37.5", () => {
    expect(Math.abs(pnorm(-38) - 2.8854283510039645e-316)).toBeLessThanOrEqual(1e-320);
    expect(Math.abs(pnorm(38, { lowerTail: false }) - 2.8854283510039645e-316))
      .toBeLessThanOrEqual(1e-320);
    expect(Math.abs(pnorm(-37.5) - 4.6053530095819552e-308)).toBeLessThanOrEqual(1e-320);
  });

  test("underflows to zero at -40, as R does", () => {
    expect(pnorm(-40)).toBe(0);
    expect(pnorm(40, { lowerTail: false })).toBe(0);
  });

  test("is exactly one half at zero", () => {
    expect(pnorm(0)).toBe(0.5);
    expect(pnorm(0, { lowerTail: false })).toBe(0.5);
  });

  test("matches R's location and scale form at mean 10 and sd 2", () => {
    expectCloseToR(pnorm(6, { mean: 10, sd: 2 }), 0.022750131948179212);
    expectCloseToR(pnorm(10, { mean: 10, sd: 2 }), 0.5);
    expectCloseToR(pnorm(13.5, { mean: 10, sd: 2 }), 0.95994084313618289);
  });

  test("reports NaN for a NaN input or a negative standard deviation", () => {
    expect(pnorm(Number.NaN)).toBeNaN();
    expect(pnorm(1, { sd: -1 })).toBeNaN();
  });
});

describe("qnorm", () => {
  test("matches R in both tails over the grid", () => {
    for (const [p, lower, upper] of quantiles) {
      expectCloseToR(qnorm(p), lower);
      expectCloseToR(qnorm(p, { lowerTail: false }), upper);
    }
  });

  /**
   * The pair at 1e-16 is not symmetric, because `1 - 1e-16` rounds to the
   * largest double below one and so asks for a different quantile than
   * `1e-16` does. A port that mirrors one tail onto the other fails here.
   */
  test("keeps R's asymmetry between 1e-16 and 1 - 1e-16", () => {
    expectCloseToR(qnorm(9.9999999999999998e-17), -8.2220822161304365);
    expectCloseToR(qnorm(0.99999999999999989), 8.2095361516013856);
    expect(qnorm(0.99999999999999989)).not.toBe(-qnorm(9.9999999999999998e-17));
  });

  test("is exactly zero at one half", () => {
    expect(qnorm(0.5)).toBe(0);
    expect(qnorm(0.5, { lowerTail: false })).toBe(0);
  });

  test("reports R's boundary values", () => {
    expect(qnorm(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(qnorm(1)).toBe(Number.POSITIVE_INFINITY);
    expect(qnorm(0, { lowerTail: false })).toBe(Number.POSITIVE_INFINITY);
    expect(qnorm(1, { lowerTail: false })).toBe(Number.NEGATIVE_INFINITY);
  });

  test("matches R's location and scale form at mean 10 and sd 2", () => {
    expectCloseToR(qnorm(0.025000000000000001, { mean: 10, sd: 2 }), 6.0800720309198919);
    expectCloseToR(qnorm(0.5, { mean: 10, sd: 2 }), 10);
    expectCloseToR(qnorm(0.97499999999999998, { mean: 10, sd: 2 }), 13.919927969080106);
  });

  test("reports NaN where R warns that NaNs were produced", () => {
    expect(qnorm(1.5)).toBeNaN();
    expect(qnorm(-1)).toBeNaN();
    expect(qnorm(Number.NaN)).toBeNaN();
    expect(qnorm(0.5, { sd: -1 })).toBeNaN();
  });

  /**
   * The round trip is held to the part of the grid where the probability
   * carries all of its digits. A subnormal tail value has about eight
   * significant digits left, so the two directions there disagree by more
   * than a rounding, which says nothing about either one.
   *
   * Each z goes back through the tail that holds it. Above z = 0 the lower
   * probability has already spent its digits against 1: R stores `pnorm(8)`
   * as the sixth double below one, and `qnorm()` of that double is 7.9916 in
   * R as much as here. The upper tail keeps every digit, so that is the way
   * back.
   */
  test("inverts pnorm where the probability keeps its digits", () => {
    for (const [z, lower, upper] of probabilities) {
      if (Math.abs(z) <= 8) {
        const back = z <= 0 ? qnorm(lower) : qnorm(upper, { lowerTail: false });
        expectCloseToR(back, z, 1e-10);
      }
    }
  });
  /**
   * The tail below the reach of AS 241.
   *
   * Wichura's third region runs out at a smaller tail of about 2.5e-317,
   * where `r = sqrt(-log(p))` reaches 27. The subnormals go four orders
   * further, to 4.9406564584124654e-324 and r = 27.284, and every one of
   * them is an ordinary argument. R covers the gap in `qnorm.c` with the
   * asymptotic expansion of Maechler (2022); this port follows it, so these
   * pin exactly rather than to a tolerance.
   *
   * The grid above stops at 1e-300, so without this test the branch that
   * serves these values never runs. Pinned from section 5 of
   * `.claude/plans/004-PLAN-seminr-utilities/distributions-fixtures.md`.
   */
  test("matches R on the subnormal tail below AS 241's third region", () => {
    const subnormals: readonly (readonly [p: number, z: number])[] = [
      [9.9999999999999694e-311, -37.663060331949517],
      [2.3999999607833146e-317, -38.0653405106547],
      [9.9999874849559983e-319, -38.148681370155138],
      [9.9998886718268301e-321, -38.269125343032648],
      [9.8813129168249309e-323, -38.389502202565737],
      [4.9406564584124654e-324, -38.467405617144344],
    ];
    for (const [probability, z] of subnormals) {
      expect(qnorm(probability)).toBe(z);
      expect(qnorm(probability, { lowerTail: false })).toBe(-z);
    }
  });

  /**
   * The far tail is monotone. A rounding that lost the ordering here would
   * still pass the pinned values above one at a time.
   */
  test("stays monotone across the AS 241 boundary at r = 27", () => {
    const grid = [
      1e-300, 9.9999999999999694e-311, 2.3999999607833146e-317,
      9.9999874849559983e-319, 9.9998886718268301e-321,
      9.8813129168249309e-323, 4.9406564584124654e-324,
    ];
    const quantiles = grid.map((probability) => qnorm(probability));
    for (let i = 1; i < quantiles.length; i++) {
      expect(quantiles[i] as number).toBeLessThan(quantiles[i - 1] as number);
    }
  });
});
