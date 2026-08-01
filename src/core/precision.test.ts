import { describe, expect, test } from "bun:test";

import { machinePrecision } from "./precision";

describe("machinePrecision", () => {
  test("returns the JS double epsilon", () => {
    expect(machinePrecision()).toBe(Number.EPSILON);
  });

  // R: .Machine$double.eps
  test("agrees with R .Machine$double.eps", () => {
    expect(machinePrecision()).toBe(2.220446049250313e-16);
  });

  test("returns the smallest x where 1 + x is not 1", () => {
    const eps = machinePrecision();
    expect(1 + eps).not.toBe(1);
    expect(1 + eps / 2).toBe(1);
  });
});
