/**
 * Tests for `modelMatrix()`, R's `model.matrix()` over a data frame.
 *
 * Expected values come from R 4.5.3, `../compstatslib/conformance-fixtures/linalg.R`
 * section 4, captured in `.claude/plans/003-PLAN-linalg/linalg-fixtures.md`.
 * Column order, names and the `assign` vector are structural and pin
 * exactly; the column sums are a checksum of the bundled data, exact too,
 * since a sum of the same doubles in the same order rounds the same way.
 */

import { describe, expect, test } from "bun:test";
import { moderationData } from "../../data/moderationData";
import { sum } from "../arith";
import { column, row, type Matrix } from "./matrix";
import { modelMatrix } from "./modelMatrix";

function columnSums(m: Matrix): number[] {
  return Array.from({ length: m.ncol }, (_, j) => sum(column(m, j)));
}

describe("modelMatrix() — fixture 4a, y ~ x * z + w", () => {
  const mm = modelMatrix(moderationData, {
    outcome: "y",
    terms: ["x", "z", "w", ["x", "z"]],
  });

  test("names the columns as lm names its coefficients, interactions last", () => {
    expect([mm.matrix.nrow, mm.matrix.ncol]).toEqual([200, 5]);
    expect(mm.matrix.dimnames).toEqual([null, ["(Intercept)", "x", "z", "w", "x:z"]]);
    expect(mm.assign).toEqual([0, 1, 2, 3, 4]);
    expect(mm.termLabels).toEqual(["x", "z", "w", "x:z"]);
  });

  test("first row, last row, column sums", () => {
    expect(row(mm.matrix, 0)).toEqual([
      1, 2.741916894293337, -4.0018584754630222, -0.49696586637986573,
      -10.972763362443038,
    ]);
    expect(row(mm.matrix, 199)).toEqual([
      1, 0.25764285720476621, 1.8620658029697648, -2.0665941582107541,
      0.4797479537804174,
    ]);
    expect(columnSums(mm.matrix)).toEqual([
      200, -10.99377831184721, 4.5136585403567038, -51.207745009641833,
      -59.293891278738535,
    ]);
  });

  test("every row is complete", () => {
    expect(mm.rows).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });
});

describe("modelMatrix() — fixture 4b, shapes of the term list", () => {
  test("no intercept", () => {
    const mm = modelMatrix(moderationData, { terms: ["x", "z"], intercept: false });
    expect(mm.matrix.dimnames).toEqual([null, ["x", "z"]]);
    expect(mm.assign).toEqual([1, 2]);
    expect(columnSums(mm.matrix)).toEqual([-10.99377831184721, 4.5136585403567038]);
  });

  test("an interaction alone", () => {
    const mm = modelMatrix(moderationData, { terms: [["x", "z"]] });
    expect(mm.matrix.dimnames).toEqual([null, ["(Intercept)", "x:z"]]);
    expect(mm.assign).toEqual([0, 1]);
    expect(columnSums(mm.matrix)).toEqual([200, -59.293891278738535]);
  });

  test("a main effect written after its interaction still comes first", () => {
    const mm = modelMatrix(moderationData, { terms: [["x", "z"], "z"] });
    expect(mm.matrix.dimnames).toEqual([null, ["(Intercept)", "z", "x:z"]]);
    expect(mm.termLabels).toEqual(["z", "x:z"]);
    expect(columnSums(mm.matrix)).toEqual([200, 4.5136585403567038, -59.293891278738535]);
  });

  test("a three-way interaction orders by degree", () => {
    const mm = modelMatrix(moderationData, {
      terms: ["x", "z", "w", ["x", "z"], ["x", "w"], ["z", "w"], ["x", "z", "w"]],
    });
    expect(mm.matrix.dimnames).toEqual([
      null,
      ["(Intercept)", "x", "z", "w", "x:z", "x:w", "z:w", "x:z:w"],
    ]);
    expect(row(mm.matrix, 0)).toEqual([
      1, 2.741916894293337, -4.0018584754630222, -0.49696586637986573,
      -10.972763362443038, -1.3626391049140789, 1.9887870643880894,
      5.4530888509977533,
    ]);
    expect(columnSums(mm.matrix)).toEqual([
      200, -10.99377831184721, 4.5136585403567038, -51.207745009641833,
      -59.293891278738535, -41.167528773210897, 3.0444813756849074,
      -2.7191599454595403,
    ]);
  });

  test("a term written twice enters once", () => {
    const mm = modelMatrix(moderationData, { terms: ["x", "x", ["x", "z"], ["x", "z"]] });
    expect(mm.matrix.dimnames).toEqual([null, ["(Intercept)", "x", "x:z"]]);
  });

  test("an empty term list with the intercept is a column of ones", () => {
    const mm = modelMatrix(moderationData, { terms: [] });
    expect(mm.matrix.dimnames).toEqual([null, ["(Intercept)"]]);
    expect(columnSums(mm.matrix)).toEqual([200]);
  });
});

describe("modelMatrix() — fixture 4d, incomplete rows are dropped", () => {
  const holed = {
    ...moderationData,
    y: moderationData.y.map((v, i) => (i === 2 ? Number.NaN : v)),
    x: moderationData.x.map((v, i) => (i === 4 ? Number.NaN : v)),
  };

  test("rows 3 and 5 (one-based) leave; the rest keep their order", () => {
    const mm = modelMatrix(holed, { outcome: "y", terms: ["x", "z", ["x", "z"]] });
    expect([mm.matrix.nrow, mm.matrix.ncol]).toEqual([198, 4]);
    expect(mm.rows.length).toBe(198);
    expect(mm.rows.slice(0, 6)).toEqual([0, 1, 3, 5, 6, 7]);
    expect(columnSums(mm.matrix)).toEqual([
      198, -12.528571780803887, 4.9247314821201584, -58.76877089129605,
    ]);
  });

  test("the outcome only counts when named", () => {
    const mm = modelMatrix(holed, { terms: ["x", "z", ["x", "z"]] });
    expect(mm.matrix.nrow).toBe(199);
  });
});

describe("modelMatrix() — refusals", () => {
  test("a term naming an absent or non-numeric column, through requireNumericColumn", () => {
    expect(() => modelMatrix(moderationData, { terms: ["x", "nope"] })).toThrow(
      /Column "nope" \(passed as `terms`\) is not in the data/,
    );
    expect(() =>
      modelMatrix({ y: [1, 2], g: ["a", "b"] }, { outcome: "y", terms: ["g"] }),
    ).toThrow(/Column "g" \(passed as `terms`\) is not numeric/);
    expect(() =>
      modelMatrix({ y: [1, 2], x: [1, 2] }, { outcome: "nope", terms: ["x"] }),
    ).toThrow(/Column "nope" \(passed as `outcome`\) is not in the data/);
  });

  test("a ragged frame, through frameRows", () => {
    expect(() => modelMatrix({ y: [1, 2], x: [1] }, { terms: ["x"] })).toThrow(
      /every column needs the same number of rows/,
    );
  });

  test("an empty interaction term", () => {
    expect(() => modelMatrix(moderationData, { terms: [[]] })).toThrow(RangeError);
  });

  test("no complete rows gives a 0-row matrix, and lm refuses it in R's words", () => {
    const mm = modelMatrix({ y: [Number.NaN, Number.NaN], x: [1, 2] }, { outcome: "y", terms: ["x"] });
    expect(mm.matrix.nrow).toBe(0);
    expect(mm.rows).toEqual([]);
  });
});
