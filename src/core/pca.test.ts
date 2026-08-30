/**
 * Tests for the PCA core, ported from `plot_pca()` in
 * `../compstatslib/R/pca_plot.R`, which calls `prcomp(mc_points,
 * scale. = FALSE)`.
 *
 * Every expected value below comes from R 4.5.3, printed at full double
 * precision with `sprintf("%.17g", x)`. Do not edit these numbers by hand.
 * Source: `.claude/plans/001-PLAN-port/pca-fixtures.md`.
 *
 * R script that produced the values (abridged from the fixture document to
 * the parts these tests assert against):
 *
 * ```r
 * options(digits = 17)
 * fmt <- function(x) sprintf("%.17g", x)
 *
 * pca_fixture <- function(points, meancenter = TRUE, label = "") {
 *   cat("=====", label, "=====\n")
 *   if (meancenter && nrow(points) > 1) {
 *     mc_diff <- sapply(points, mean)
 *     mc_points <- sweep(points, 2, mc_diff)
 *   } else {
 *     mc_diff <- c(x = 0, y = 0)
 *     mc_points <- points
 *   }
 *   cat("mc_diff:", paste(fmt(c(mc_diff["x"], mc_diff["y"])), collapse=", "), "\n")
 *   pca <- prcomp(mc_points, scale. = FALSE)
 *   cat("sdev:", paste(fmt(pca$sdev), collapse=", "), "\n")
 *   cat("center:", paste(fmt(pca$center), collapse=", "), "\n")
 *   print(pca$rotation, digits = 17)
 *   print(pca$x, digits = 17)
 *   vec <- pca$rotation[, c("PC1", "PC2")] %*% diag(pca$sdev[1:2])
 *   print(vec, digits = 17)
 *   invisible(pca)
 * }
 *
 * load(".../compstatslib/data/pca_degenerate.rda")
 * pca_fixture(pca_degenerate, TRUE, "F1 pca_degenerate")
 * pca_fixture(data.frame(x = c(-30,-18,-7,2,9,17,26,38),
 *                        y = c(-25,-11,-9,3,2,15,18,30)), TRUE, "F2 general 8pt")
 * pca_fixture(data.frame(x = c(0,10,20), y = c(0,5,10)), TRUE, "F3 collinear")
 * pca_fixture(data.frame(x = c(5,5,5), y = c(5,5,5)), TRUE, "F4 identical")
 * pca_fixture(data.frame(x = c(3,3,3,3), y = c(-8,-1,4,12)), TRUE, "F5 constant-x")
 * ## F6: prcomp called directly on 2 mean-centered rows (plot_pca guards at n < 3)
 * f6 <- data.frame(x = c(1,4), y = c(2,6))
 * print(prcomp(sweep(f6, 2, sapply(f6, mean)), scale. = FALSE))
 * ## n = 1 and n = 0, checked in this session:
 * ##   prcomp(data.frame(x = 7, y = -3)) -> ONE component: sdev 0,
 * ##     rotation (1, 0), center (7, -3), score 0
 * ##   prcomp(data.frame(x = numeric(0), y = numeric(0)))
 * ##     -> error "a dimension is zero"
 * ```
 *
 * ## What the port asserts, and what it deliberately does not
 *
 * **Signs are not asserted against R.** `?prcomp` says outright: "The signs
 * of the columns of the rotation matrix are arbitrary, and so may differ
 * between different programs for PCA, and even between different builds of
 * R." The signs in the fixture document are what LAPACK's `dgesdd` returned
 * on that one machine (fixture findings 3 and 5). So every comparison
 * against an R rotation column, and against the R scores that follow from
 * it, is up to a whole-column sign flip. The port's *own* convention is a
 * separate matter and is pinned exactly by the "sign convention" tests
 * below: in each rotation column, the component with the larger magnitude is
 * non-negative, and a tie goes to a non-negative x.
 *
 * **`center` is the column means, not R's `pca$center`.** `plot_pca` centers
 * the points itself and then hands them to `prcomp`, which centers again —
 * so R's `pca$center` reports the tiny residual of centering already
 * centered data (F1: `2.22e-16, 2.66e-15`), not the means of the data the
 * caller passed. This port centers once, so its `center` is the true column
 * mean, which R prints as `mc_diff` in every fixture, and which F7 confirms
 * is exactly what `pca$center` holds when the data reaches `prcomp` raw
 * (`4.625, 2.875` for F2).
 *
 * **`sdev[2]` exactly zero versus float noise is data-dependent.** F4 and F5
 * give exactly `0` in R, F3 and F6 give `4.1e-17` and `1.0e-16` (fixture
 * finding 2). A covariance-based closed form need not repeat R's noise, so
 * the near-zero cases assert `|sdev[2]| <= 1e-12 * sdev[1]` instead of a
 * literal, while F4 and F5 keep the exact `0`.
 */

import { describe, expect, test } from "bun:test";

import { pcaDegenerate } from "../data/pcaDegenerate";
import { principalComponents, type Loadings, type PcaResult } from "./pca";
import type { Point } from "./regression";

/**
 * Relative tolerance for all comparisons against R.
 *
 * R runs an SVD of the centered data matrix; this port takes the closed-form
 * eigendecomposition of the 2x2 covariance matrix. Forming a covariance
 * matrix squares the data and so loses a few bits that the SVD keeps, but
 * the two agree far inside this bound on every fixture here.
 */
const RELATIVE_TOLERANCE = 1e-12;

/** Assert that a value agrees with R to `RELATIVE_TOLERANCE`. */
function expectCloseToR(actual: number, expected: number): void {
  const tolerance = RELATIVE_TOLERANCE * Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function pointsFrom(xs: readonly number[], ys: readonly number[]): Point[] {
  return xs.map((x, index) => ({ x, y: ys[index] as number }));
}

/**
 * Compare one rotation column with R's, up to a whole-column sign flip.
 *
 * @returns The sign R's column carries relative to the port's, so the caller
 *   can apply the same flip to that component's scores.
 */
function expectColumnCloseToRUpToSign(
  actual: Loadings,
  expected: Loadings,
): number {
  // The dominant component of a unit vector is at least 1/sqrt(2), so its
  // sign is never in doubt at these tolerances.
  const dominant = Math.abs(expected[0]) >= Math.abs(expected[1]) ? 0 : 1;
  const sign =
    Math.sign(actual[dominant]) === Math.sign(expected[dominant]) ? 1 : -1;

  expectCloseToR(sign * actual[0], expected[0]);
  expectCloseToR(sign * actual[1], expected[1]);
  return sign;
}

/**
 * Assert the port's own sign rule: the dominant component of a unit loading
 * vector is positive. The unit-length half keeps the assertion from passing
 * on a column of zeros.
 */
function expectPortSignConvention(column: Loadings): void {
  expectCloseToR(column[0] * column[0] + column[1] * column[1], 1);
  const dominant = Math.abs(column[0]) >= Math.abs(column[1]) ? 0 : 1;
  expect(column[dominant]).toBeGreaterThan(0);
}

/** Assert that the rotation is a valid orthonormal basis of the plane. */
function expectOrthonormal(result: PcaResult): void {
  const [pc1, pc2] = result.rotation;
  expectCloseToR(pc1[0] * pc1[0] + pc1[1] * pc1[1], 1);
  expectCloseToR(pc2[0] * pc2[0] + pc2[1] * pc2[1], 1);
  expect(Math.abs(pc1[0] * pc2[0] + pc1[1] * pc2[1])).toBeLessThanOrEqual(1e-12);
}

/** The `vec` matrix of `plot_pca`: each loading vector scaled by its sdev. */
function vecColumn(result: PcaResult, component: 0 | 1): Loadings {
  const column = result.rotation[component];
  const scale = result.sdev[component];
  return [column[0] * scale, column[1] * scale];
}

interface Fixture {
  readonly label: string;
  readonly points: readonly Point[];
  /** R's `mc_diff`, which is what this port reports as `center`. */
  readonly center: Point;
  readonly sdev: readonly [number, number];
  /** R's rotation, column by column: PC1 then PC2, each as [x, y]. */
  readonly rotation: readonly [Loadings, Loadings];
  /** R's `vec`, column by column. */
  readonly vec: readonly [Loadings, Loadings];
  /** R's `pca$x`, row by row, as [PC1 score, PC2 score]. */
  readonly scores: readonly Loadings[];
}

/** F1 — the bundled `pca_degenerate` dataset, 16 rows. */
const fixtureDegenerate: Fixture = {
  label: "F1 pca_degenerate",
  points: pcaDegenerate,
  center: { x: 0.066315468527669785, y: -5.6665424486754059 },
  sdev: [17.856098763802361, 17.413955860791827],
  rotation: [
    [-0.64749475786320199, -0.7620699039718557],
    [-0.7620699039718557, 0.64749475786320199],
  ],
  vec: [
    [-11.561730345449631, -13.607595470242837],
    [-13.270651670603762, 11.275445133523892],
  ],
  scores: [
    [-30.785327486078049, 26.171840357238896],
    [-23.117641278352547, 19.656970004051988],
    [-11.964643158024575, 10.180794944871055],
    [-3.5233629560675115, 3.7288054564771786],
    [3.4891814456661754, -2.7095332849986598],
    [7.2050565291763551, -8.5073493031751592],
    [35.640891248065493, 23.26504459284153],
    [23.614339371056484, 9.957978460158996],
    [13.385530605908279, -1.5157651897058158],
    [3.2751740289999018, -12.850096363066605],
    [-6.6192384596933458, -23.647737918675293],
    [-17.182443501296497, -35.79758366279637],
    [-1.4838737888548728, -18.168730758486738],
    [-18.635481741957069, 15.608635315635775],
    [10.355003829549474, -7.3428193732674361],
    [16.346835311902311, 1.9695467228966634],
  ],
};

/** F2 — the general 8-point set. */
const fixtureGeneral: Fixture = {
  label: "F2 general 8-point set",
  points: pointsFrom(
    [-30, -18, -7, 2, 9, 17, 26, 38],
    [-25, -11, -9, 3, 2, 15, 18, 30],
  ),
  center: { x: 4.625, y: 2.875 },
  sdev: [28.745610995920561, 2.2225769888152058],
  rotation: [
    [0.7870195512308007, 0.61692805575728926],
    [0.61692805575728926, -0.7870195512308007],
  ],
  vec: [
    [22.62335786586457, 17.733973903268627],
    [1.3711701004806554, -1.7492115443132477],
  ],
  scores: [
    [-44.447421515600908, 0.57703605996243001],
    [-26.366194120229256, -3.0381009881813101],
    [-16.475122945175869, 2.17406852268727],
    [-1.9888103150111907, -1.7178135902667344],
    [2.9033984878471251, 3.3877023512650912],
    [17.219619622538293, -1.9081273686770042],
    [26.153579750887364, 1.2831664794461979],
    [43.000951034744446, -0.75793146623593888],
  ],
};

describe("principalComponents", () => {
  for (const fixture of [fixtureDegenerate, fixtureGeneral]) {
    describe(fixture.label, () => {
      const result = principalComponents(fixture.points) as PcaResult;

      test("returns a result", () => {
        expect(result).not.toBeNull();
      });

      test("matches the R sdev of both components", () => {
        expectCloseToR(result.sdev[0], fixture.sdev[0]);
        expectCloseToR(result.sdev[1], fixture.sdev[1]);
      });

      test("centers on the column means R reports as mc_diff", () => {
        expectCloseToR(result.center.x, fixture.center.x);
        expectCloseToR(result.center.y, fixture.center.y);
      });

      test("matches the R rotation up to a column sign", () => {
        expectColumnCloseToRUpToSign(result.rotation[0], fixture.rotation[0]);
        expectColumnCloseToRUpToSign(result.rotation[1], fixture.rotation[1]);
      });

      test("has an orthonormal rotation", () => {
        expectOrthonormal(result);
      });

      test("matches the R scores up to the sign of each component", () => {
        const signs = [
          expectColumnCloseToRUpToSign(result.rotation[0], fixture.rotation[0]),
          expectColumnCloseToRUpToSign(result.rotation[1], fixture.rotation[1]),
        ];

        expect(result.scores).toHaveLength(fixture.scores.length);
        fixture.scores.forEach((expected, index) => {
          const score = result.scores[index] as Point;
          expectCloseToR((signs[0] as number) * score.x, expected[0]);
          expectCloseToR((signs[1] as number) * score.y, expected[1]);
        });
      });

      test("matches the R vec matrix of plot_pca up to a column sign", () => {
        const sign1 = expectColumnCloseToRUpToSign(
          result.rotation[0],
          fixture.rotation[0],
        );
        const sign2 = expectColumnCloseToRUpToSign(
          result.rotation[1],
          fixture.rotation[1],
        );
        const vec1 = vecColumn(result, 0);
        const vec2 = vecColumn(result, 1);

        expectCloseToR(sign1 * vec1[0], fixture.vec[0][0]);
        expectCloseToR(sign1 * vec1[1], fixture.vec[0][1]);
        expectCloseToR(sign2 * vec2[0], fixture.vec[1][0]);
        expectCloseToR(sign2 * vec2[1], fixture.vec[1][1]);
      });

      test("orders the components by decreasing sdev", () => {
        expect(result.sdev[1]).toBeGreaterThan(0);
        expect(result.sdev[0]).toBeGreaterThan(result.sdev[1]);
      });

      test("obeys the port's sign convention in both columns", () => {
        expectPortSignConvention(result.rotation[0]);
        expectPortSignConvention(result.rotation[1]);
      });
    });
  }

  describe("F3 collinear points (0,0), (10,5), (20,10)", () => {
    const points = pointsFrom([0, 10, 20], [0, 5, 10]);
    const result = principalComponents(points) as PcaResult;

    test("matches the R sdev of the spread component", () => {
      expectCloseToR(result.sdev[0], 11.180339887498949);
    });

    test("collapses the second component to zero", () => {
      // R returns 4.1090570731442667e-17 here, which is its own SVD's float
      // noise, not a value to reproduce. The closed form may return an exact
      // zero. Both are "no spread at all" against a first sdev of 11.18.
      expect(result.sdev[0]).toBeGreaterThan(1);
      expect(Math.abs(result.sdev[1])).toBeLessThanOrEqual(
        1e-12 * result.sdev[0],
      );
    });

    test("points PC1 along the line, matching R up to sign", () => {
      expectColumnCloseToRUpToSign(result.rotation[0], [
        0.89442719099991586, 0.44721359549995793,
      ]);
    });

    test("still returns a full orthonormal basis", () => {
      expectOrthonormal(result);
    });

    test("centers on the middle point", () => {
      expectCloseToR(result.center.x, 10);
      expectCloseToR(result.center.y, 5);
    });
  });

  describe("F4 three identical points (5,5)", () => {
    const points = pointsFrom([5, 5, 5], [5, 5, 5]);
    const result = principalComponents(points) as PcaResult;

    test("reports both sdev as exactly zero, as R does", () => {
      expect(result.sdev[0]).toBe(0);
      expect(result.sdev[1]).toBe(0);
    });

    test("still returns a valid orthonormal basis", () => {
      expectOrthonormal(result);
    });

    test("returns the identity rotation, as LAPACK does here", () => {
      expect(result.rotation[0]).toEqual([1, 0]);
      expect(result.rotation[1]).toEqual([0, 1]);
    });

    test("centers on the repeated point and scores it at the origin", () => {
      expect(result.center).toEqual({ x: 5, y: 5 });
      expect(result.scores).toEqual([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ]);
    });
  });

  describe("F5 constant-x set", () => {
    const points = pointsFrom([3, 3, 3, 3], [-8, -1, 4, 12]);
    const result = principalComponents(points) as PcaResult;

    test("matches the R sdev, with an exactly zero second component", () => {
      expectCloseToR(result.sdev[0], 8.421203397773187);
      expect(result.sdev[1]).toBe(0);
    });

    test("matches R's axis-aligned rotation up to sign", () => {
      // R returned 0.99999999999999989 — one ulp below 1 — from its SVD.
      expectColumnCloseToRUpToSign(result.rotation[0], [
        0, 0.99999999999999989,
      ]);
      expectColumnCloseToRUpToSign(result.rotation[1], [
        -0.99999999999999989, -0,
      ]);
    });

    test("returns exactly axis-aligned loadings from the closed form", () => {
      expect(result.rotation[0]).toEqual([0, 1]);
      expect(result.rotation[1]).toEqual([1, 0]);
    });

    test("matches the R scores up to the sign of PC1", () => {
      const sign = expectColumnCloseToRUpToSign(result.rotation[0], [
        0, 0.99999999999999989,
      ]);
      const expected = [
        -9.7499999999999982, -2.7499999999999996, 2.2499999999999996,
        10.249999999999998,
      ];
      expected.forEach((want, index) => {
        expectCloseToR(sign * (result.scores[index] as Point).x, want);
        expect((result.scores[index] as Point).y).toBe(0);
      });
    });

    test("centers on the column means", () => {
      expect(result.center).toEqual({ x: 3, y: 1.75 });
    });
  });

  describe("F6 two points (1,2) and (4,6)", () => {
    const points = pointsFrom([1, 4], [2, 6]);
    const result = principalComponents(points) as PcaResult;

    test("matches the R sdev of the spread component", () => {
      expectCloseToR(result.sdev[0], 3.5355339059327373);
    });

    test("collapses the second component to zero", () => {
      // R returns 1.0388770660336795e-16 here — float noise, see F3.
      expect(result.sdev[0]).toBeGreaterThan(1);
      expect(Math.abs(result.sdev[1])).toBeLessThanOrEqual(
        1e-12 * result.sdev[0],
      );
    });

    test("matches the R rotation up to sign", () => {
      expectColumnCloseToRUpToSign(result.rotation[0], [
        0.60000000000000009, 0.79999999999999982,
      ]);
      expectColumnCloseToRUpToSign(result.rotation[1], [
        -0.79999999999999982, 0.60000000000000009,
      ]);
    });

    test("matches the R PC1 scores up to sign", () => {
      const sign = expectColumnCloseToRUpToSign(result.rotation[0], [
        0.60000000000000009, 0.79999999999999982,
      ]);
      expectCloseToR(sign * (result.scores[0] as Point).x, -2.5);
      expectCloseToR(sign * (result.scores[1] as Point).x, 2.5);
    });
  });

  describe("edge cases", () => {
    test("returns null for no points", () => {
      expect(principalComponents([])).toBeNull();
    });

    test("treats one point as a zero-variance fit centered on itself", () => {
      const result = principalComponents([{ x: 7, y: -3 }]) as PcaResult;

      expect(result).not.toBeNull();
      expect(result.sdev[0]).toBe(0);
      expect(result.sdev[1]).toBe(0);
      expect(result.rotation[0]).toEqual([1, 0]);
      expect(result.rotation[1]).toEqual([0, 1]);
      expect(result.center).toEqual({ x: 7, y: -3 });
      expect(result.scores).toEqual([{ x: 0, y: 0 }]);
    });

    test("does not modify the points it is given", () => {
      const points = pointsFrom([1, 5, 9], [2, 4, 11]);
      const copy = points.map((point) => ({ ...point }));

      principalComponents(points);

      expect(points).toEqual(copy);
    });
  });

  describe("sign convention", () => {
    test("makes the dominant loading non-negative in both columns", () => {
      // R's own answer for these points has PC1 = (-0.647, -0.762): both
      // loadings negative. The port flips the whole column.
      const result = principalComponents(pcaDegenerate) as PcaResult;

      expect(result.rotation[0][0]).toBeGreaterThan(0);
      expect(result.rotation[0][1]).toBeGreaterThan(0);
    });

    test("breaks a tie toward a non-negative x", () => {
      // Points on y = -x. Both loadings of each column have the same
      // magnitude, so the dominant-component rule cannot decide; x wins.
      const result = principalComponents(
        pointsFrom([-1, 0, 1], [1, 0, -1]),
      ) as PcaResult;

      expect(result.rotation[0][0]).toBeGreaterThan(0);
      expect(result.rotation[0][1]).toBeLessThan(0);
      expect(result.rotation[1][0]).toBeGreaterThan(0);
      expect(result.rotation[1][1]).toBeGreaterThan(0);
    });

    test("gives one answer for one input", () => {
      const points = pointsFrom([3, -1, 7, 2], [8, 0, -2, 5]);
      const result = principalComponents(points) as PcaResult;

      expect(result.sdev[0]).toBeGreaterThan(0);
      expect(result).toEqual(principalComponents(points) as PcaResult);
    });

    test("never reports a negative zero loading", () => {
      // -0 would survive a naive column flip and show up in snapshots and
      // Object.is comparisons for no reason.
      const result = principalComponents(
        pointsFrom([3, 3, 3, 3], [12, 4, -1, -8]),
      ) as PcaResult;

      // The y spread is descending here, so a naive eigenvector routine would
      // hand back (0, -1) for PC1 and the flip would leave a -0 behind.
      expect(result.rotation[0]).toEqual([0, 1]);
      const loadings = [...result.rotation[0], ...result.rotation[1]];
      loadings.forEach((loading) => expect(Object.is(loading, -0)).toBe(false));
    });
  });

  describe("scores", () => {
    test("project the centered points onto the loading vectors", () => {
      const result = principalComponents(fixtureGeneral.points) as PcaResult;

      fixtureGeneral.points.forEach((point, index) => {
        const dx = point.x - result.center.x;
        const dy = point.y - result.center.y;
        const score = result.scores[index] as Point;
        expectCloseToR(
          score.x,
          dx * result.rotation[0][0] + dy * result.rotation[0][1],
        );
        expectCloseToR(
          score.y,
          dx * result.rotation[1][0] + dy * result.rotation[1][1],
        );
      });
    });
  });

  describe("purity", () => {
    test("the module touches no DOM and no randomness", async () => {
      const source = await Bun.file(`${import.meta.dir}/pca.ts`).text();

      expect(source).not.toInclude("Math.random");
      expect(source).not.toInclude("document");
      expect(source).not.toInclude("window");
    });
  });
});

describe("pcaDegenerate dataset", () => {
  test("has the 16 rows of the R dataset", () => {
    expect(pcaDegenerate).toHaveLength(16);
  });

  test("carries the first and last rows at full R precision", () => {
    expect(pcaDegenerate[0]).toEqual({
      x: 0.054881767057370599,
      y: 34.740158547326999,
    });
    expect(pcaDegenerate[15]).toEqual({
      x: -12.019106985568101,
      y: -16.848702486618301,
    });
  });

  test("repeats the x value of the first three rows, as the R data does", () => {
    expect(pcaDegenerate[1]?.x).toBe(pcaDegenerate[0]?.x as number);
    expect(pcaDegenerate[2]?.x).toBe(pcaDegenerate[0]?.x as number);
  });
});

describe("principalComponents: missing values, R's na.omit", () => {
  // Every expected value comes from R 4.5.3, printed with sprintf("%.17g").
  // R's prcomp() errors on NA, so the R usage this mirrors is
  // prcomp(na.omit(d)) — the port folds the na.omit in.
  //
  // ```r
  // d <- data.frame(
  //   x = c(2, 5, NA, 8, 9),
  //   y = c(1, 4, 5, NA, 3)
  // )
  // pr <- prcomp(na.omit(d), scale. = FALSE)       # rows 1, 2, 5 survive
  // pr$sdev; pr$rotation; colMeans(na.omit(d)); pr$x
  // ```
  const withMissing = pointsFrom(
    [2, 5, Number.NaN, 8, 9],
    [1, 4, 5, Number.NaN, 3],
  );

  test("computes the components of the complete rows alone", () => {
    const result = principalComponents(withMissing);
    expectCloseToR(result?.sdev[0] as number, 3.6402967326196869);
    expectCloseToR(result?.sdev[1] as number, 1.1894983670207784);
    expectCloseToR(result?.center.x as number, 5.333333333333333);
    expectCloseToR(result?.center.y as number, 2.6666666666666665);
    expectColumnCloseToRUpToSign(
      result?.rotation[0] as Loadings,
      [0.96042154170817839, 0.27855064570538285],
    );
    expectColumnCloseToRUpToSign(
      result?.rotation[1] as Loadings,
      [0.27855064570538285, -0.96042154170817839],
    );
  });

  test("pads the scores with NaN at the dropped rows, keeping input order", () => {
    const result = principalComponents(withMissing) as PcaResult;
    const sign1 = expectColumnCloseToRUpToSign(result.rotation[0], [
      0.96042154170817839, 0.27855064570538285,
    ]);
    const sign2 = expectColumnCloseToRUpToSign(result.rotation[1], [
      0.27855064570538285, -0.96042154170817839,
    ]);
    const expectedPc1 = [
      -3.6656562152028993, 0.051260347037784655, Number.NaN, Number.NaN,
      3.6143958681651154,
    ];
    const expectedPc2 = [
      0.67220041716235446, -1.3734122708460321, Number.NaN, Number.NaN,
      0.70121185368367756,
    ];
    expect(result.scores.length).toBe(expectedPc1.length);
    for (const [index, score] of result.scores.entries()) {
      const pc1 = expectedPc1[index] as number;
      const pc2 = expectedPc2[index] as number;
      if (Number.isNaN(pc1)) {
        expect(score.x).toBeNaN();
        expect(score.y).toBeNaN();
      } else {
        expectCloseToR(sign1 * score.x, pc1);
        expectCloseToR(sign2 * score.y, pc2);
      }
    }
  });

  test("answers exactly as it would on the filtered input", () => {
    const filtered = principalComponents(pointsFrom([2, 5, 9], [1, 4, 3]));
    const result = principalComponents(withMissing);
    expect(result?.sdev).toEqual(filtered?.sdev as PcaResult["sdev"]);
    expect(result?.rotation).toEqual(
      filtered?.rotation as PcaResult["rotation"],
    );
    expect(result?.center).toEqual(filtered?.center as PcaResult["center"]);
  });

  test("an infinity is missing the same way NaN is", () => {
    const result = principalComponents(
      pointsFrom([2, 5, Number.POSITIVE_INFINITY, 8, 9],
        [1, 4, 5, Number.NEGATIVE_INFINITY, 3]),
    );
    expectCloseToR(result?.sdev[0] as number, 3.6402967326196869);
  });

  test("returns null when no row is complete, as with no rows at all", () => {
    // R's prcomp() errors on NA input; this port already answers null for
    // "nothing to compute" and an all-missing input is that same answer.
    expect(
      principalComponents(pointsFrom([Number.NaN, 2], [1, Number.NaN])),
    ).toBeNull();
  });
});
