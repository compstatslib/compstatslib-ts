/**
 * Tests for `prcomp()`, R's principal components over a matrix or a frame.
 *
 * Expected values come from R 4.5.3, `../compstatslib/conformance-fixtures/linalg.R`
 * section 5c, captured in `.claude/plans/003-PLAN-linalg/linalg-fixtures.md`.
 * R computes the components through the SVD of the centered data; the port
 * through the eigendecomposition of the covariance. Standard deviations
 * agree to a relative `1e-12` (plan Q1), rotations and scores up to the
 * sign of each component, which the SVD leaves arbitrary.
 */

import { describe, expect, test } from "bun:test";
import { moderationData } from "../../data/moderationData";
import { pcaDegenerate } from "../../data/pcaDegenerate";
import { principalComponents } from "../pca";
import { column, fromFrame, fromRows, matrix, type Matrix } from "./matrix";
import { prcomp } from "./prcomp";
import { dot, mul } from "./vector";

function relativelyClose(actual: readonly number[], expected: readonly number[], tolerance = 1e-12): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    const target = expected[index] as number;
    expect(Math.abs(value - target)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(target)));
  });
}

/** The sign that lines a port column up with R's. */
function signToMatch(actual: readonly number[], expected: readonly number[]): 1 | -1 {
  return dot(actual, expected) < 0 ? -1 : 1;
}

/** Compare rotation and scores with R's, one component at a time, up to sign. */
function sameComponents(
  rotation: Matrix,
  scores: Matrix,
  expectedRotation: readonly (readonly number[])[],
  expectedScoreRows: readonly (readonly number[])[],
  tolerance = 1e-12,
): void {
  expectedRotation.forEach((expected, k) => {
    const actual = column(rotation, k);
    const sign = signToMatch(actual, expected);
    relativelyClose(mul(actual, sign), expected, tolerance);
    const scoreColumn = column(scores, k).slice(0, expectedScoreRows.length);
    relativelyClose(
      mul(scoreColumn, sign),
      expectedScoreRows.map((row) => row[k] as number),
      tolerance,
    );
  });
}

const degenerate = fromRows(pcaDegenerate.map((p) => [p.x, p.y]));

describe("prcomp() — fixture 5c, moderation_data", () => {
  const p = prcomp(fromFrame(moderationData));

  test("sdev, center, no scale", () => {
    relativelyClose(p.sdev, [
      3.7277072172012833, 2.0163575111958849, 1.8426284734565832,
      1.6165396643999972,
    ]);
    relativelyClose(p.center, [
      -0.31562302098439826, -0.054968891559236052, 0.02256829270178352,
      -0.25603872504820918,
    ]);
    expect(p.scale).toBeNull();
  });

  test("rotation carries the variable names as rows and PC1.. as columns", () => {
    expect([p.rotation.nrow, p.rotation.ncol]).toEqual([4, 4]);
    expect(p.rotation.dimnames).toEqual([
      ["y", "x", "z", "w"],
      ["PC1", "PC2", "PC3", "PC4"],
    ]);
    expect([p.x.nrow, p.x.ncol]).toEqual([200, 4]);
    expect(p.x.dimnames).toEqual([null, ["PC1", "PC2", "PC3", "PC4"]]);
  });

  test("rotation and scores match R up to the sign of each component", () => {
    sameComponents(
      p.rotation,
      p.x,
      [
        [0.96541314116466681, 0.16018097115698435, 0.20472027552428196, -0.020227014980942429],
        [-0.014989371094772552, 0.77261998608353255, -0.56282601537117782, -0.2933607885861188],
        [-0.036676630256110732, -0.19428298724338344, 0.23084398778525844, -0.95269092520305021],
        [0.25769674117809793, -0.58279887993309953, -0.76682953680336619, -0.076878583629307315],
      ],
      [
        [-7.0876445576919478, 4.6009456796732149, -0.9877035753283645, -0.31831733481455909],
        [-1.5309374732905734, -1.4932330435453876, -0.63517973488108104, -0.34505330044010413],
        [3.2563195143246029, -1.398743255690752, -1.8446101578901866, -1.684879550757727],
      ],
      1e-11,
    );
  });

  test("scaled", () => {
    const s = prcomp(fromFrame(moderationData), { scale: true });
    relativelyClose(s.sdev, [
      1.1730299793884784, 1.0506424812692057, 0.98439823854029151,
      0.74236860922800385,
    ]);
    relativelyClose(s.scale as readonly number[], [
      3.6235641115369814, 1.9491703629655268, 1.8941612710648057,
      1.8581307792559159,
    ]);
    sameComponents(
      s.rotation,
      s.x,
      [
        [0.73426552779143428, 0.37831124181041109, 0.55348991872157005, -0.10669418395873503],
        [0.00073307789126868608, 0.69771803266534382, -0.56320322902057662, -0.44270885727665676],
        [-0.099690997423720312, -0.38439355588648905, 0.22339025966208362, -0.89016857454850129],
        [0.67150227276356644, -0.47149946490574862, -0.57144363202549753, -0.015004255545183625],
      ],
      [
        [-2.0290905993644812, 2.2537666291088754, -0.71936852463737322, -0.74978756039923633],
        [-0.39152050792625065, -0.83892618553218068, -0.19749330321292252, -0.22547730180833175],
        [1.2684519530971947, -0.94126321229198306, -1.0263877309184408, -0.38839693469036968],
      ],
      1e-11,
    );
  });
});

describe("prcomp() — fixture 5c, pca_degenerate", () => {
  test("centered", () => {
    const p = prcomp(degenerate);
    relativelyClose(p.sdev, [17.856098763802361, 17.413955860791827]);
    relativelyClose(p.center, [0.066315468527669341, -5.6665424486754041]);
    expect(p.rotation.dimnames).toEqual([null, ["PC1", "PC2"]]);
    sameComponents(
      p.rotation,
      p.x,
      [
        [-0.64749475786320199, -0.7620699039718557],
        [-0.7620699039718557, 0.64749475786320199],
      ],
      [
        [-30.785327486078042, 26.171840357238889],
        [-23.117641278352551, 19.656970004051988],
        [-11.964643158024575, 10.180794944871053],
      ],
      1e-11,
    );
  });

  test("uncentered", () => {
    const p = prcomp(degenerate, { center: false });
    relativelyClose(p.sdev, [18.653335464808436, 17.56115710756356]);
    expect(p.center).toEqual([0, 0]);
    sameComponents(
      p.rotation,
      p.x,
      [
        [-0.18775146056696015, -0.982216569324186],
        [0.982216569324186, -0.18775146056696015],
      ],
      [
        [-34.132663478057339, -6.4686097266308691],
        [-24.249936969171802, -4.5795188739854602],
        [-9.8750620471564989, -1.8317503610466888],
      ],
      1e-11,
    );
  });

  test("agrees with principalComponents on the same points — plan 5.1b", () => {
    const p = prcomp(degenerate);
    const small = principalComponents(pcaDegenerate);
    expect(small).not.toBeNull();
    const two = small as NonNullable<typeof small>;
    relativelyClose(p.sdev, two.sdev);
    relativelyClose(p.center, [two.center.x, two.center.y]);
    relativelyClose(column(p.rotation, 0).map(Math.abs), two.rotation[0].map(Math.abs));
    relativelyClose(column(p.rotation, 1).map(Math.abs), two.rotation[1].map(Math.abs));
  });
});

describe("prcomp() — refusals and edges", () => {
  test("a frame goes straight in", () => {
    const p = prcomp(moderationData);
    expect(p.rotation.dimnames?.[0]).toEqual(["y", "x", "z", "w"]);
  });

  test("a missing value in any row is refused, as R's prcomp refuses it", () => {
    const holed = { ...moderationData, y: moderationData.y.map((v, i) => (i === 2 ? Number.NaN : v)) };
    expect(() => prcomp(holed)).toThrow(/missing/);
  });

  test("a constant column cannot be scaled, in R's words", () => {
    expect(() => prcomp(fromRows([[1, 1], [2, 1], [3, 1]]), { scale: true })).toThrow(
      /cannot rescale a constant\/zero column to unit variance/,
    );
  });

  test("the scores carry the row names of the input, as R's do (fixture 5e)", () => {
    const named = matrix([1, 2, 3, 4, 5, 6, 2, 1, 4, 3, 6, 5], {
      nrow: 6,
      dimnames: [["o1", "o2", "o3", "o4", "o5", "o6"], ["a", "b"]],
    });
    const p = prcomp(named);
    expect(p.x.dimnames).toEqual([["o1", "o2", "o3", "o4", "o5", "o6"], ["PC1", "PC2"]]);
    expect(p.rotation.dimnames).toEqual([["a", "b"], ["PC1", "PC2"]]);
    relativelyClose(p.sdev, [2.5298221281347035, 0.77459666924148318]);
  });

  test("fewer than two rows has no spread", () => {
    const p = prcomp(fromRows([[1, 2]]));
    expect(p.sdev).toEqual([0, 0]);
  });
});
