/**
 * Tests for `rPretty`, R's `pretty()`.
 *
 * R uses this to place histogram cell edges and axis ticks: it widens a range
 * outward to round numbers, so the result always covers the range it was
 * given. That is the opposite of `prettyTicks` in `src/plot/axes.ts`, which
 * keeps ticks inside a fixed window. The two are not interchangeable.
 *
 * Expected values come from R 4.5.3. The twelve cases marked "Section 2c" are
 * in `.claude/plans/001-PLAN-port/sampling-fixtures.md`; the rest were computed in session
 * with `pretty(c(lo, up), n = n, min.n = min.n)` at `%.17g`, chosen to cover
 * the branches the doc's algorithm sketch could get wrong: negative and
 * zero-crossing ranges, extreme magnitudes, zero-width ranges, the unit
 * ladder around its `2`/`5`/`10` decision points, and the widening that
 * `min.n` forces.
 *
 * Every break is asserted exactly, not to a tolerance. R builds the result
 * with `seq.int(l, u, length.out = n + 1)` over round numbers, and this port
 * reproduces it bit for bit; a mismatch here is a real difference, not
 * rounding. The literals below are R's own `%.17g` output — several of them
 * (`0.60000000000000009` rather than `0.6`) are one unit in the last place
 * off the value they look like, which is exactly what makes the assertion
 * worth making.
 */

import { describe, expect, test } from "bun:test";

import { rPretty } from "./pretty";

/** One R-computed call and its result. */
interface Pin {
  readonly label: string;
  readonly lo: number;
  readonly up: number;
  readonly n?: number;
  readonly minN?: number;
  readonly breaks: readonly number[];
}

/** Register one test per pin, so a failure names the call that broke. */
function pinTests(pins: readonly Pin[]): void {
  pins.forEach((pin) => {
    test(pin.label, () => {
      const options: { n?: number; minN?: number } = {};
      if (pin.n !== undefined) {
        options.n = pin.n;
      }
      if (pin.minN !== undefined) {
        options.minN = pin.minN;
      }
      expect(rPretty(pin.lo, pin.up, options)).toEqual([...pin.breaks]);
    });
  });
}

describe("rPretty, the fixtures of Section 2c", () => {
  pinTests([
    {
      label: "feeds hist(th7): pretty(c(49.2, 50.9), n = 4, min.n = 1)",
      lo: 49.2,
      up: 50.9,
      n: 4,
      minN: 1,
      breaks: [49, 49.5, 50, 50.5, 51],
    },
    {
      label: "feeds hist(th30): pretty(c(48.7, 52.1), n = 6, min.n = 1)",
      lo: 48.7,
      up: 52.1,
      n: 6,
      minN: 1,
      breaks: [48.5, 49, 49.5, 50, 50.5, 51, 51.5, 52, 52.5],
    },
    {
      label: "feeds hist(boundary): pretty(c(0, 3), n = 4, min.n = 1)",
      lo: 0,
      up: 3,
      n: 4,
      minN: 1,
      breaks: [0, 1, 2, 3],
    },
    {
      label: "pretty(c(0, 1))",
      lo: 0,
      up: 1,
      breaks: [
        0, 0.20000000000000001, 0.40000000000000002, 0.60000000000000009,
        0.80000000000000004, 1,
      ],
    },
    {
      label: "pretty(c(-5, 50))",
      lo: -5,
      up: 50,
      breaks: [-10, 0, 10, 20, 30, 40, 50],
    },
    {
      label: "pretty(c(0.001, 0.0042), n = 5)",
      lo: 0.001,
      up: 0.0042,
      n: 5,
      breaks: [
        0.001, 0.0015, 0.002, 0.0025000000000000005, 0.0030000000000000005,
        0.0035000000000000005, 0.004000000000000001, 0.0045000000000000005,
      ],
    },
    { label: "pretty(c(7, 7)), a zero-width range", lo: 7, up: 7, breaks: [5, 10] },
    {
      label: "pretty(c(0, 100), n = 10)",
      lo: 0,
      up: 100,
      n: 10,
      breaks: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    },
    { label: "pretty(c(1, 9), n = 5)", lo: 1, up: 9, n: 5, breaks: [0, 2, 4, 6, 8, 10] },
    {
      label: "pretty(c(-1, 1), n = 5)",
      lo: -1,
      up: 1,
      n: 5,
      breaks: [-1, -0.5, 0, 0.5, 1],
    },
    { label: "pretty(c(0, 0)), both ends exactly zero", lo: 0, up: 0, breaks: [-1, 0] },
    {
      label: "pretty(c(3.5, 3.9), n = 5)",
      lo: 3.5,
      up: 3.9,
      n: 5,
      breaks: [
        3.5, 3.6000000000000001, 3.7000000000000002, 3.8000000000000003,
        3.9000000000000004,
      ],
    },
  ]);
});

describe("rPretty over negative and zero-crossing ranges", () => {
  pinTests([
    {
      label: "pretty(c(-50, -5), n = 5, min.n = 1)",
      lo: -50,
      up: -5,
      n: 5,
      minN: 1,
      breaks: [-50, -40, -30, -20, -10, 0],
    },
    {
      label: "pretty(c(-100, -1), n = 7, min.n = 2)",
      lo: -100,
      up: -1,
      n: 7,
      minN: 2,
      breaks: [-100, -80, -60, -40, -20, 0],
    },
    {
      label: "pretty(c(-3, 7), n = 5, min.n = 1)",
      lo: -3,
      up: 7,
      n: 5,
      minN: 1,
      breaks: [-4, -2, 0, 2, 4, 6, 8],
    },
    {
      label: "pretty(c(-0.7, 0.2), n = 5, min.n = 1)",
      lo: -0.7,
      up: 0.2,
      n: 5,
      minN: 1,
      breaks: [
        -0.80000000000000004, -0.60000000000000009, -0.40000000000000002,
        -0.20000000000000001, 0, 0.20000000000000001,
      ],
    },
    {
      label: "pretty(c(-1e6, 1e6), n = 5, min.n = 1)",
      lo: -1e6,
      up: 1e6,
      n: 5,
      minN: 1,
      breaks: [-1000000, -500000, 0, 500000, 1000000],
    },
    {
      label: "pretty(c(-7, -7), n = 5, min.n = 1), negative and zero-width",
      lo: -7,
      up: -7,
      n: 5,
      minN: 1,
      breaks: [-10, -5],
    },
  ]);
});

describe("rPretty at extreme magnitudes", () => {
  pinTests([
    {
      label: "pretty(c(1e-4, 1.3e-4), n = 5, min.n = 1)",
      lo: 0.0001,
      up: 0.00013,
      n: 5,
      minN: 1,
      breaks: [
        9.9999999999999991e-5, 0.00010499999999999999, 0.00010999999999999999,
        0.00011499999999999999, 0.00011999999999999999, 0.000125,
        0.00012999999999999999,
      ],
    },
    {
      label: "pretty(c(1e-12, 3e-12), n = 5, min.n = 1)",
      lo: 1e-12,
      up: 3e-12,
      n: 5,
      minN: 1,
      breaks: [
        9.9999999999999998e-13, 1.5000000000000001e-12, 2.0000000000000004e-12,
        2.5000000000000003e-12, 3.0000000000000001e-12,
      ],
    },
    {
      label: "pretty(c(123456789, 123456790), n = 5, min.n = 1)",
      lo: 123456789,
      up: 123456790,
      n: 5,
      minN: 1,
      breaks: [
        123456789, 123456789.2, 123456789.40000001, 123456789.59999999,
        123456789.8, 123456790,
      ],
    },
    {
      // The high end is written out in full because this runtime reads the
      // literal `1.5e300` as a double three units in the last place away from
      // the one R reads it as, while the seventeen-digit form below agrees
      // with R exactly. Every other literal in this file was checked against
      // R's own bit pattern and needs no such care.
      label: "pretty(c(1e300, 1.5e300), n = 5, min.n = 1)",
      lo: 1e300,
      up: 1.500000000000001e300,
      n: 5,
      minN: 1,
      breaks: [
        1.0000000000000001e300, 1.1000000000000002e300, 1.2000000000000004e300,
        1.3000000000000007e300, 1.4000000000000007e300, 1.500000000000001e300,
      ],
    },
    {
      label: "pretty(c(2.0000001, 2.0000002), n = 5, min.n = 1), a narrow range far from zero",
      lo: 2.0000001,
      up: 2.0000002,
      n: 5,
      minN: 1,
      breaks: [
        2.00000008, 2.0000000999999998, 2.0000001200000002, 2.00000014,
        2.0000001599999999, 2.0000001800000002, 2.0000002000000001,
      ],
    },
    {
      label: "pretty(c(1/3, 2/3), n = 5, min.n = 1)",
      lo: 1 / 3,
      up: 2 / 3,
      n: 5,
      minN: 1,
      breaks: [
        0.30000000000000004, 0.35000000000000003, 0.40000000000000002,
        0.45000000000000007, 0.5, 0.55000000000000004, 0.60000000000000009,
        0.65000000000000002, 0.70000000000000007,
      ],
    },
    {
      label: "pretty(c(0.1, 0.2), n = 3, min.n = 1)",
      lo: 0.1,
      up: 0.2,
      n: 3,
      minN: 1,
      breaks: [0.10000000000000001, 0.15000000000000002, 0.20000000000000001],
    },
  ]);
});

describe("rPretty over zero-width ranges", () => {
  pinTests([
    { label: "pretty(c(5, 5), n = 5, min.n = 1)", lo: 5, up: 5, n: 5, minN: 1, breaks: [0, 5] },
    {
      label: "pretty(c(5, 5), n = 5, min.n = 2), where min.n splits the cell",
      lo: 5,
      up: 5,
      n: 5,
      minN: 2,
      breaks: [2, 4, 6],
    },
    {
      label: "pretty(c(-0.5, -0.5), n = 5, min.n = 1)",
      lo: -0.5,
      up: -0.5,
      n: 5,
      minN: 1,
      breaks: [-0.5, 0],
    },
    {
      label: "pretty(c(1e-9, 1e-9), n = 5, min.n = 1)",
      lo: 1e-9,
      up: 1e-9,
      n: 5,
      minN: 1,
      breaks: [0, 1.0000000000000001e-9],
    },
    {
      label: "pretty(c(1e9, 1e9), n = 5, min.n = 1), where the cell is shrunk by 9.99/10",
      lo: 1e9,
      up: 1e9,
      n: 5,
      minN: 1,
      breaks: [900000000, 1000000000],
    },
  ]);
});

describe("rPretty and the unit ladder", () => {
  // The unit comes from {1, 2, 5, 10} times a power of ten, biased toward the
  // rounder choice. These pins walk the range across each decision point.
  pinTests([
    {
      label: "pretty(c(0, 1.4)) takes the 0.2 unit",
      lo: 0,
      up: 1.4,
      breaks: [
        0, 0.20000000000000001, 0.40000000000000002, 0.60000000000000009,
        0.80000000000000004, 1, 1.2000000000000002, 1.4000000000000001,
      ],
    },
    { label: "pretty(c(0, 1.5)) takes the 0.5 unit", lo: 0, up: 1.5, breaks: [0, 0.5, 1, 1.5] },
    { label: "pretty(c(0, 1.6))", lo: 0, up: 1.6, breaks: [0, 0.5, 1, 1.5, 2] },
    { label: "pretty(c(0, 2.4))", lo: 0, up: 2.4, breaks: [0, 0.5, 1, 1.5, 2, 2.5] },
    { label: "pretty(c(0, 2.5))", lo: 0, up: 2.5, breaks: [0, 0.5, 1, 1.5, 2, 2.5] },
    { label: "pretty(c(0, 2.6))", lo: 0, up: 2.6, breaks: [0, 0.5, 1, 1.5, 2, 2.5, 3] },
    { label: "pretty(c(0, 3.4))", lo: 0, up: 3.4, breaks: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] },
    { label: "pretty(c(0, 3.5))", lo: 0, up: 3.5, breaks: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] },
    { label: "pretty(c(0, 3.6)) steps up to the 1 unit", lo: 0, up: 3.6, breaks: [0, 1, 2, 3, 4] },
    { label: "pretty(c(0, 6))", lo: 0, up: 6, breaks: [0, 1, 2, 3, 4, 5, 6] },
    { label: "pretty(c(0, 7))", lo: 0, up: 7, breaks: [0, 1, 2, 3, 4, 5, 6, 7] },
    { label: "pretty(c(0, 7.5)) steps up to the 2 unit", lo: 0, up: 7.5, breaks: [0, 2, 4, 6, 8] },
    { label: "pretty(c(0, 9))", lo: 0, up: 9, breaks: [0, 2, 4, 6, 8, 10] },
    { label: "pretty(c(0, 11))", lo: 0, up: 11, breaks: [0, 2, 4, 6, 8, 10, 12] },
    { label: "pretty(c(0, 10), n = 1)", lo: 0, up: 10, n: 1, minN: 0, breaks: [0, 10] },
    { label: "pretty(c(0, 10), n = 2)", lo: 0, up: 10, n: 2, minN: 0, breaks: [0, 5, 10] },
    { label: "pretty(c(0, 10), n = 3)", lo: 0, up: 10, n: 3, minN: 1, breaks: [0, 5, 10] },
    {
      label: "pretty(c(0, 10), n = 4)",
      lo: 0,
      up: 10,
      n: 4,
      minN: 1,
      breaks: [0, 2, 4, 6, 8, 10],
    },
    {
      label: "pretty(c(0, 10), n = 7)",
      lo: 0,
      up: 10,
      n: 7,
      minN: 2,
      breaks: [0, 2, 4, 6, 8, 10],
    },
    {
      label: "pretty(c(0, 10), n = 8) reaches the 1 unit",
      lo: 0,
      up: 10,
      n: 8,
      minN: 2,
      breaks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    },
  ]);
});

describe("rPretty and the min.n widening", () => {
  pinTests([
    { label: "pretty(c(0, 1), n = 1, min.n = 1)", lo: 0, up: 1, n: 1, minN: 1, breaks: [0, 1] },
    {
      label: "pretty(c(0, 1), n = 2, min.n = 1)",
      lo: 0,
      up: 1,
      n: 2,
      minN: 1,
      breaks: [0, 0.5, 1],
    },
    {
      label: "pretty(c(0, 1), n = 3, min.n = 1)",
      lo: 0,
      up: 1,
      n: 3,
      minN: 1,
      breaks: [0, 0.5, 1],
    },
    {
      label: "pretty(c(0, 0.4), n = 5, min.n = 4) needs no widening",
      lo: 0,
      up: 0.4,
      n: 5,
      minN: 4,
      breaks: [
        0, 0.10000000000000001, 0.20000000000000001, 0.30000000000000004,
        0.40000000000000002,
      ],
    },
    {
      label: "pretty(c(0, 0.4), n = 5, min.n = 5) widens by one cell",
      lo: 0,
      up: 0.4,
      n: 5,
      minN: 5,
      breaks: [
        0, 0.10000000000000001, 0.20000000000000001, 0.30000000000000004,
        0.40000000000000002, 0.5,
      ],
    },
    { label: "pretty(c(3, 4), n = 1, min.n = 1)", lo: 3, up: 4, n: 1, minN: 1, breaks: [3, 4] },
    { label: "pretty(c(0, 1), n = 0, min.n = 0)", lo: 0, up: 1, n: 0, minN: 0, breaks: [0, 1] },
  ]);
});

describe("rPretty guards", () => {
  test("refuses a range that runs backward", () => {
    // R's pretty() takes a vector and uses its min and max, so it cannot meet
    // this case. This port takes the two ends, so it has to refuse it.
    expect(() => rPretty(5, 1)).toThrow(RangeError);
  });

  test("refuses an end that is not finite", () => {
    expect(() => rPretty(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => rPretty(Number.NaN, 1)).toThrow(RangeError);
  });

  test("refuses min.n above n, as R does", () => {
    // R: "invalid 'min.n' argument".
    expect(() => rPretty(0, 1, { n: 2, minN: 4 })).toThrow(RangeError);
  });

  test("refuses a negative or fractional cell count", () => {
    // R truncates a fractional n through as.integer; this port refuses it
    // rather than guess which cell count the caller meant.
    expect(() => rPretty(0, 1, { n: -1 })).toThrow(RangeError);
    expect(() => rPretty(0, 1, { n: 4.7 })).toThrow(RangeError);
    expect(() => rPretty(0, 1, { minN: -1 })).toThrow(RangeError);
  });

  test("defaults n to 5 and min.n to floor(n/3), as R does", () => {
    expect(rPretty(0, 1)).toEqual(rPretty(0, 1, { n: 5, minN: 1 }));
    expect(rPretty(0, 100, { n: 10 })).toEqual(
      rPretty(0, 100, { n: 10, minN: 3 }),
    );
  });
});
