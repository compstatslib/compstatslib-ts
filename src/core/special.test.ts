/**
 * Tests for the special functions behind the t distribution.
 *
 * The R fixtures in `tdist.test.ts` are the trust gate for the distribution
 * itself. They do not pin down these helpers, though: both precision faults
 * found while writing this module still left every fixture inside its
 * tolerance, because the fixture grid stops at df = 300. The tests here use
 * exact mathematical identities instead of R values, which hold at every
 * argument and so catch a loss of digits wherever it appears.
 */

import { describe, expect, test } from "bun:test";

import {
  incompleteBeta,
  incompleteBetaSplit,
  inverseIncompleteBeta,
  logBeta,
  logGamma,
  normalCdf,
} from "./special.js";

/** log Γ(n) for a whole n, summed straight from the factorial. */
function logFactorialReference(n: number): number {
  let total = 0;
  for (let k = 1; k < n; k += 1) {
    total += Math.log(k);
  }
  return total;
}

/**
 * log B(a, ½) for a whole a, from B(a, ½) = (a−1)! / ∏(k + ½).
 *
 * Each term is a ratio near 1, so the sum never adds large numbers only to
 * subtract them again. That makes this reference independent of the Lanczos
 * route under test.
 */
function logBetaHalfReference(a: number): number {
  let total = -Math.log(0.5);
  for (let k = 1; k <= a - 1; k += 1) {
    total += Math.log(k / (k + 0.5));
  }
  return total;
}

describe("logGamma", () => {
  test("matches the factorial at whole arguments", () => {
    for (const n of [2, 5, 10, 50, 150]) {
      const reference = logFactorialReference(n);
      expect(Math.abs(logGamma(n) - reference)).toBeLessThanOrEqual(
        1e-14 * Math.max(1, Math.abs(reference)),
      );
    }
  });

  test("gives log √π at one half", () => {
    expect(Math.abs(logGamma(0.5) - 0.5 * Math.log(Math.PI))).toBeLessThanOrEqual(
      1e-15,
    );
  });

  test("reports NaN at zero and below", () => {
    expect(logGamma(0)).toBeNaN();
    expect(logGamma(-1)).toBeNaN();
  });
});

describe("logBeta", () => {
  /**
   * B(a, b) = B(b, a), so the two orders must agree.
   *
   * This is the guard on the fault that started it: one of the two ratios in
   * the expansion was taken as `log(x / y)` rather than `log1p`, which cost
   * digits in proportion to the larger argument and broke the symmetry. At
   * b = 2500 the error reached 1e-13.
   */
  test("is symmetric in its arguments", () => {
    for (const [a, b] of [
      [0.5, 0.5],
      [0.5, 150],
      [0.5, 2500],
      [1, 1],
      [2.5, 7.5],
      [249.5, 0.5],
      [1000, 3],
    ] as const) {
      expect(Math.abs(logBeta(a, b) - logBeta(b, a))).toBeLessThanOrEqual(1e-15);
    }
  });

  test("matches the product form, in both argument orders", () => {
    for (const a of [10, 150, 500, 2500]) {
      const reference = logBetaHalfReference(a);
      expect(Math.abs(logBeta(a, 0.5) - reference)).toBeLessThanOrEqual(1e-13);
      expect(Math.abs(logBeta(0.5, a) - reference)).toBeLessThanOrEqual(1e-13);
    }
  });

  test("gives log π at a half and a half", () => {
    expect(Math.abs(logBeta(0.5, 0.5) - Math.log(Math.PI))).toBeLessThanOrEqual(
      1e-15,
    );
  });

  test("reports NaN for a shape of zero or less", () => {
    expect(logBeta(0, 1)).toBeNaN();
    expect(logBeta(1, -1)).toBeNaN();
  });
});

describe("incompleteBeta", () => {
  test("obeys the mirror identity I_x(a, b) = 1 − I_(1−x)(b, a)", () => {
    for (const a of [0.5, 1, 2.5, 49.5, 249.5]) {
      for (const b of [0.5, 1, 3.5, 50]) {
        for (const x of [1e-6, 0.01, 0.3, 0.5, 0.7, 0.99, 0.999999]) {
          const mirrored = incompleteBeta(1 - x, b, a);
          expect(
            Math.abs(incompleteBeta(x, a, b) + mirrored - 1),
          ).toBeLessThanOrEqual(1e-12);
        }
      }
    }
  });

  test("saturates outside zero to one", () => {
    expect(incompleteBeta(0, 2, 3)).toBe(0);
    expect(incompleteBeta(1, 2, 3)).toBe(1);
    expect(incompleteBeta(-1, 2, 3)).toBe(0);
    expect(incompleteBeta(2, 2, 3)).toBe(1);
  });

  test("reports NaN for a shape of zero or less", () => {
    expect(incompleteBeta(0.5, 0, 1)).toBeNaN();
    expect(incompleteBeta(0.5, 1, -1)).toBeNaN();
  });
});

describe("incompleteBetaSplit", () => {
  test("agrees with incompleteBeta when the complement is exact", () => {
    for (const a of [0.5, 2.5, 49.5, 249.5]) {
      for (const x of [0.125, 0.25, 0.5, 0.75, 0.875]) {
        expect(incompleteBetaSplit(x, 1 - x, a, 0.5)).toBe(
          incompleteBeta(x, a, 0.5),
        );
      }
    }
  });

  /**
   * The guard on the second fault: a complement too small to survive being
   * rebuilt by subtraction.
   *
   * At 1e-17 the pair member is below the last bit of 1, so `1 - tiny` is
   * just 1 and the subtracted route answers a flat 1, with the whole result
   * gone. Told both members, the function still returns the real value.
   */
  test("keeps a result that a subtracted complement would round away", () => {
    const tiny = 1e-17;
    expect(1 - tiny).toBe(1);
    expect(incompleteBeta(1 - tiny, 250, 0.5)).toBe(1);

    const split = incompleteBetaSplit(1 - tiny, tiny, 250, 0.5);
    expect(split).toBeLessThan(1);

    // As x goes to 0, I_x(a, b) approaches x^a / (a · B(a, b)). Here that
    // fixes what is left over above 1 − tiny.
    const expected = Math.sqrt(tiny) / (0.5 * Math.exp(logBeta(0.5, 250)));
    expect(Math.abs(1 - split - expected)).toBeLessThanOrEqual(1e-8 * expected);
  });

  test("saturates at the ends of the pair", () => {
    expect(incompleteBetaSplit(0, 1, 2, 3)).toBe(0);
    expect(incompleteBetaSplit(1, 0, 2, 3)).toBe(1);
  });
});

describe("inverseIncompleteBeta", () => {
  test("inverts incompleteBeta", () => {
    for (const a of [0.5, 2.5, 49.5, 249.5]) {
      for (const b of [0.5, 3.5]) {
        for (const p of [0.001, 0.025, 0.1, 0.5, 0.9, 0.975, 0.999]) {
          const x = inverseIncompleteBeta(p, a, b);
          expect(Math.abs(incompleteBeta(x, a, b) - p)).toBeLessThanOrEqual(
            1e-11 * p,
          );
        }
      }
    }
  });

  test("saturates outside zero to one", () => {
    expect(inverseIncompleteBeta(0, 2, 3)).toBe(0);
    expect(inverseIncompleteBeta(1, 2, 3)).toBe(1);
  });

  test("reports NaN for a shape of zero or less", () => {
    expect(inverseIncompleteBeta(0.5, 0, 1)).toBeNaN();
    expect(inverseIncompleteBeta(0.5, 1, -1)).toBeNaN();
  });
});

describe("normalCdf", () => {
  test("is exactly one half at zero", () => {
    expect(normalCdf(0)).toBe(0.5);
  });

  test("splits the whole between the two tails", () => {
    for (const z of [0.25, 1, 1.96, 3, 7.5, 20]) {
      expect(Math.abs(normalCdf(z) + normalCdf(-z) - 1)).toBeLessThanOrEqual(
        1e-15,
      );
    }
  });

  /**
   * The one R-verified point available without another fixture run.
   *
   * P(T < 0) for a non-central t is P(Z < −ncp) whatever the degrees of
   * freedom, so the fixture entry for df = 499, ncp = 17.888543819998318 at
   * x = 0 is a normal tail value. It reaches 7e-72, which is the depth the
   * widest slider settings ask for.
   */
  test("holds the far tail R reports at 7e-72", () => {
    const expected = 7.2422121863683586e-72;
    const actual = normalCdf(-17.888543819998318);
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-12 * expected);
  });

  test("rises with its argument", () => {
    const points = [-30, -5, -1, 0, 1, 5, 30];
    const values = points.map((z) => normalCdf(z));
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index] as number).toBeGreaterThanOrEqual(
        values[index - 1] as number,
      );
    }
  });

  test("saturates at the ends", () => {
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(normalCdf(Number.NaN)).toBeNaN();
  });
});
