/**
 * Tests for the seedable random layer.
 *
 * These numbers are NOT R-verified, and they cannot be: R draws from a
 * Mersenne Twister stream that no JavaScript generator reproduces. The port
 * plan states this — reproducibility across runs is the requirement, parity
 * with R's stream is not. Two kinds of expected value appear below:
 *
 * - **Derived values.** The tests drive the functions with a stub generator
 *   that returns a known sequence, then assert against the transform computed
 *   with `Math` in the test itself. These pin the algorithm and the exact
 *   order in which each function consumes the generator.
 * - **Regression pins.** The golden sequence for seed 42 comes from an
 *   independent implementation of mulberry32 (the canonical public-domain
 *   form), run once for this task. It pins the stream so that a later change
 *   to the generator cannot silently change every seeded demo.
 *
 * Statistical assertions use a fixed seed and stated tolerances. They test
 * that the distributions are the shape they claim to be, not that any
 * particular value is correct.
 */

import { describe, expect, test } from "bun:test";

import {
  rnorm,
  runif,
  sampleWithoutReplacement,
  seededRng,
  type Rng,
} from "./rng";
import { mean } from "./arith";

/**
 * A generator that returns the given values in order, then repeats from the
 * start. Repeating keeps a short sequence usable for a long draw.
 */
function stubRng(values: readonly number[]): Rng {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

/** Count the draws a generator makes. */
function countingRng(inner: Rng): { rng: Rng; count: () => number } {
  let count = 0;
  return {
    rng: () => {
      count += 1;
      return inner();
    },
    count: () => count,
  };
}

/** Sample standard deviation, R's `sd()`. */
function sd(values: readonly number[]): number {
  const average = mean(values);
  const squares = values.map((value) => (value - average) * (value - average));
  return Math.sqrt(
    squares.reduce((total, value) => total + value, 0) / (values.length - 1),
  );
}

describe("seededRng", () => {
  /**
   * Regression pins: mulberry32 seeded with 42, first five draws, from an
   * independent implementation of the published algorithm. Not R values.
   */
  const SEED_42_GOLDEN = [
    0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
    0.6697340414393693, 0.17481389874592423,
  ];

  test("reproduces the pinned stream for seed 42", () => {
    const rng = seededRng(42);
    const drawn = Array.from({ length: 5 }, () => rng());
    expect(drawn).toEqual(SEED_42_GOLDEN);
  });

  test("gives two generators of one seed the same stream", () => {
    const first = Array.from({ length: 20 }, seededRng(7));
    const second = Array.from({ length: 20 }, seededRng(7));
    expect(first).toEqual(second);
  });

  test("gives different seeds different streams", () => {
    const first = Array.from({ length: 20 }, seededRng(1));
    const second = Array.from({ length: 20 }, seededRng(2));
    expect(first).not.toEqual(second);
  });

  test("returns values in [0, 1)", () => {
    const rng = seededRng(2026);
    const drawn = Array.from({ length: 5000 }, () => rng());
    expect(drawn.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  test("truncates a fractional seed to its integer part", () => {
    expect(seededRng(42.9)()).toBe(seededRng(42)());
  });

  test("rejects a non-finite seed", () => {
    expect(() => seededRng(Number.NaN)).toThrow(RangeError);
    expect(() => seededRng(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("runif", () => {
  test("returns the raw draws with the default range", () => {
    const rng = stubRng([0.25, 0.5, 0.75]);
    expect(runif(rng, 3)).toEqual([0.25, 0.5, 0.75]);
  });

  test("scales each draw into [min, max)", () => {
    const rng = stubRng([0, 0.25, 0.5]);
    expect(runif(rng, 3, { min: 10, max: 20 })).toEqual([10, 12.5, 15]);
  });

  test("supports a negative range", () => {
    const rng = stubRng([0.5]);
    expect(runif(rng, 1, { min: -4, max: -2 })).toEqual([-3]);
  });

  test("draws exactly once per value", () => {
    const counter = countingRng(stubRng([0.5]));
    runif(counter.rng, 6);
    expect(counter.count()).toBe(6);
  });

  test("returns an empty array for n = 0 without drawing", () => {
    const counter = countingRng(stubRng([0.5]));
    expect(runif(counter.rng, 0)).toEqual([]);
    expect(counter.count()).toBe(0);
  });

  test("returns NaN when min is above max, like R", () => {
    const values = runif(stubRng([0.5]), 3, { min: 5, max: 1 });
    expect(values).toHaveLength(3);
    expect(values.every((value) => Number.isNaN(value))).toBe(true);
  });

  test("does not draw when the range is invalid", () => {
    const counter = countingRng(stubRng([0.5]));
    runif(counter.rng, 3, { min: 5, max: 1 });
    expect(counter.count()).toBe(0);
  });

  test("returns NaN for a non-finite bound, like R", () => {
    expect(runif(stubRng([0.5]), 1, { max: Number.POSITIVE_INFINITY })[0]).toBeNaN();
    expect(runif(stubRng([0.5]), 1, { min: Number.NaN })[0]).toBeNaN();
  });

  test("stays inside the range over many draws", () => {
    const values = runif(seededRng(11), 10000, { min: 17, max: 35 });
    expect(values.every((value) => value >= 17 && value < 35)).toBe(true);
  });

  // Tolerance: the mean of 10000 uniforms over a width-18 range has a
  // standard error of 18 / sqrt(12 * 10000) = 0.052. 0.3 is about 6 of those.
  test("centers on the middle of the range", () => {
    const values = runif(seededRng(12), 10000, { min: 17, max: 35 });
    expect(Math.abs(mean(values) - 26)).toBeLessThan(0.3);
  });

  test("rejects a negative or fractional count", () => {
    expect(() => runif(stubRng([0.5]), -1)).toThrow(RangeError);
    expect(() => runif(stubRng([0.5]), 2.5)).toThrow(RangeError);
  });
});

describe("rnorm", () => {
  /**
   * Box-Muller in pairs. Each pair takes two draws in order: u1 makes the
   * radius, u2 makes the angle. The radius uses `1 - u1` because a generator
   * over [0, 1) can return an exact 0, and `log(0)` is not finite.
   */
  function expectedPair(u1: number, u2: number): [number, number] {
    const radius = Math.sqrt(-2 * Math.log(1 - u1));
    const angle = 2 * Math.PI * u2;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  }

  test("transforms each pair of draws with Box-Muller", () => {
    const values = rnorm(stubRng([0.25, 0.5, 0.75, 0.125]), 4);
    const first = expectedPair(0.25, 0.5);
    const second = expectedPair(0.75, 0.125);
    expect(values).toEqual([first[0], first[1], second[0], second[1]]);
  });

  test("takes the radius from the first draw of a pair", () => {
    // u2 = 0 makes the angle 0, so the first value is the radius itself.
    const values = rnorm(stubRng([0.5, 0]), 1);
    expect(values[0]).toBe(Math.sqrt(-2 * Math.log(0.5)));
  });

  test("returns 0 rather than infinity when a draw is exactly 0", () => {
    const values = rnorm(stubRng([0, 0.3]), 2);
    expect(values[0]).toBe(0);
    expect(values[1]).toBe(0);
  });

  test("draws two values per pair and discards the spare of an odd count", () => {
    const counter = countingRng(stubRng([0.4, 0.6]));
    const values = rnorm(counter.rng, 3);
    expect(values).toHaveLength(3);
    expect(counter.count()).toBe(4);
  });

  test("shifts and scales by mean and sd", () => {
    const raw = rnorm(stubRng([0.25, 0.5]), 2);
    const scaled = rnorm(stubRng([0.25, 0.5]), 2, { mean: 50, sd: 10 });
    expect(scaled).toEqual([50 + 10 * raw[0], 50 + 10 * raw[1]]);
  });

  test("returns the mean when sd is 0", () => {
    expect(rnorm(stubRng([0.25, 0.5]), 2, { mean: 4, sd: 0 })).toEqual([4, 4]);
  });

  test("returns an empty array for n = 0 without drawing", () => {
    const counter = countingRng(stubRng([0.5]));
    expect(rnorm(counter.rng, 0)).toEqual([]);
    expect(counter.count()).toBe(0);
  });

  test("returns NaN for a negative sd, like R", () => {
    const values = rnorm(stubRng([0.5]), 2, { sd: -1 });
    expect(values).toHaveLength(2);
    expect(values.every((value) => Number.isNaN(value))).toBe(true);
  });

  test("does not draw when the parameters are invalid", () => {
    const counter = countingRng(stubRng([0.5]));
    rnorm(counter.rng, 4, { sd: -1 });
    rnorm(counter.rng, 4, { mean: Number.NaN });
    expect(counter.count()).toBe(0);
  });

  // Tolerance: the mean of 10000 draws at sd 10 has a standard error of 0.1,
  // and the sample sd has about sd / sqrt(2n) = 0.07. 0.5 covers both by 5x.
  test("has the requested mean and sd over many draws", () => {
    const values = rnorm(seededRng(13), 10000, { mean: 50, sd: 10 });
    expect(Math.abs(mean(values) - 50)).toBeLessThan(0.5);
    expect(Math.abs(sd(values) - 10)).toBeLessThan(0.5);
  });

  test("rejects a negative or fractional count", () => {
    expect(() => rnorm(stubRng([0.5]), -2)).toThrow(RangeError);
    expect(() => rnorm(stubRng([0.5]), 1.5)).toThrow(RangeError);
  });
});

describe("sampleWithoutReplacement", () => {
  const letters = ["a", "b", "c", "d"] as const;

  /**
   * Partial Fisher-Yates. Step i takes one draw and swaps position i with
   * position `i + floor(u * (n - i))`, so the draw at step i selects from the
   * values that no earlier step took.
   */
  test("follows the documented swap pattern", () => {
    // Step 0: u = 0   -> j = 0, no swap.        pool a b c d
    // Step 1: u = 0.5 -> j = 1 + 1 = 2, swap.   pool a c b d
    const drawn = sampleWithoutReplacement(stubRng([0, 0.5]), letters, 2);
    expect(drawn).toEqual(["a", "c"]);
  });

  test("can select the last value", () => {
    const drawn = sampleWithoutReplacement(stubRng([0.999]), letters, 1);
    expect(drawn).toEqual(["d"]);
  });

  test("draws exactly once per selected value", () => {
    const counter = countingRng(stubRng([0.5]));
    sampleWithoutReplacement(counter.rng, letters, 3);
    expect(counter.count()).toBe(3);
  });

  test("returns every value when k is the population size", () => {
    const drawn = sampleWithoutReplacement(seededRng(3), letters, 4);
    expect(drawn).toHaveLength(4);
    expect([...drawn].sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("takes no value twice", () => {
    const population = Array.from({ length: 200 }, (_unused, index) => index);
    const drawn = sampleWithoutReplacement(seededRng(4), population, 50);
    expect(new Set(drawn).size).toBe(50);
  });

  test("returns an empty array for k = 0 without drawing", () => {
    const counter = countingRng(stubRng([0.5]));
    expect(sampleWithoutReplacement(counter.rng, letters, 0)).toEqual([]);
    expect(counter.count()).toBe(0);
  });

  test("accepts an empty population when k is 0", () => {
    expect(sampleWithoutReplacement(stubRng([0.5]), [], 0)).toEqual([]);
  });

  test("rejects a sample larger than the population, like R", () => {
    expect(() => sampleWithoutReplacement(stubRng([0.5]), letters, 5)).toThrow(
      RangeError,
    );
  });

  test("rejects a negative or fractional k", () => {
    expect(() => sampleWithoutReplacement(stubRng([0.5]), letters, -1)).toThrow(
      RangeError,
    );
    expect(() => sampleWithoutReplacement(stubRng([0.5]), letters, 1.5)).toThrow(
      RangeError,
    );
  });

  test("does not modify the population", () => {
    const population = ["a", "b", "c", "d"];
    sampleWithoutReplacement(seededRng(5), population, 4);
    expect(population).toEqual(["a", "b", "c", "d"]);
  });

  test("keeps values of any type", () => {
    const points = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const drawn = sampleWithoutReplacement(seededRng(6), points, 2);
    expect(drawn.every((point) => points.includes(point))).toBe(true);
  });
});

describe("core purity", () => {
  test("the module does not use Math.random", async () => {
    const source = await Bun.file(`${import.meta.dir}/rng.ts`).text();
    expect(source).not.toInclude("Math.random");
  });
});
