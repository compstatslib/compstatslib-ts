/**
 * Tests for the 2x2 matrix core, ported from `plot_matrix_inverse()` in
 * `../compstatslib/R/matrix_inverse_plot.R`, which builds
 * `A <- matrix(c(x1, y1, x2, y2), nrow = 2)` and calls `solve(A)`.
 *
 * Every expected value below comes from R 4.5.3 on arm64 macOS, printed at
 * full double precision with `sprintf("%.17g", x)`. Do not edit these numbers
 * by hand. Source: `.claude/plans/001-PLAN-port/matrix-inverse-fixtures.md`, plus the extra
 * cases marked "in-session" that were computed with the same R install while
 * writing these tests.
 *
 * R script that produced the fixture values:
 *
 * ```r
 * options(digits = 17)
 * fmt <- function(x) sprintf("%.17g", x)
 * mk <- function(x1, y1, x2, y2) matrix(c(x1, y1, x2, y2), nrow = 2)
 * report <- function(label, x1, y1, x2, y2) {
 *   A <- mk(x1, y1, x2, y2)
 *   cat(label, " det=", fmt(det(A)), "\n", sep = "")
 *   tryCatch({
 *     s <- solve(A)
 *     cat("  solve [1,1],[1,2],[2,1],[2,2] = ",
 *         paste(fmt(c(s[1,1], s[1,2], s[2,1], s[2,2])), collapse = ", "), "\n",
 *         "  rcond = ", fmt(rcond(A, norm = "O")), "\n", sep = "")
 *     print(A %*% s, digits = 17)
 *   }, error = function(e) cat("  ERROR: ", conditionMessage(e), "\n", sep = ""))
 * }
 * report("F1",  1,    2,    2,    1)
 * report("F2",  1.3, -0.7,  0.4,  1.9)
 * report("F3", -1.5,  0.8,  0.6,  1.3)
 * report("F4a", -2,  -1.6, -1.5, -1.2)
 * report("F4b", -2,   -2,   -2,   -2)
 * report("F4c",  2,   1.9,  1.9,  1.8)
 * report("F5",   1,    1,    1,    1)
 * report("F6",   1,    0,    0,    1)
 * report("F7",   0,    1,    1,    0)
 * ```
 *
 * ## Reading the fixture numbers
 *
 * R fills the matrix column by column, so `(x1, y1)` is column 1 and
 * `(x2, y2)` is column 2 — `A[1,1] = x1`, `A[2,1] = y1`, `A[1,2] = x2`,
 * `A[2,2] = y2`. R prints a matrix row by row. The `rMatrix` helper below
 * takes the four entries in R's printing order so that every literal can be
 * copied straight out of an R console.
 *
 * ## Why the numbers are what they are, and what the port must reproduce
 *
 * **R's `det()` is not `x1*y2 - x2*y1`.** It factors the matrix (LAPACK
 * `dgetrf`) and then exponentiates a sum of logarithms:
 * `det <- function(x, ...) { z <- determinant(x, logarithm = TRUE, ...);
 * c(z$sign * exp(z$modulus)) }`. That is why F1, an all-integer matrix whose
 * determinant is the integer −3, comes back as −2.9999999999999996: `exp(log 2
 * + log 1.5)` misses −3 by one unit in the last place. A port that multiplies
 * out the closed form gets exactly −3 and fails this fixture.
 *
 * **The factorization scales by a reciprocal.** LAPACK's `dgetf2` computes
 * `1/pivot` once and multiplies, rather than dividing each entry. This is not
 * cosmetic: for a matrix of four equal entries at `1e-5`, dividing gives an
 * exactly zero second pivot and so R's "exactly singular" error, while
 * multiplying by the reciprocal leaves `1.7e-21` and so R's "computationally
 * singular" error. R reports the second, so the port must scale the same way.
 *
 * **The rank-one update is rounded once.** The R install these values come
 * from is arm64 macOS with R's own reference BLAS, which the compiler
 * contracts `d - l*b` into a fused multiply-add. Without the fusion, F4c's
 * determinant and inverse differ from R in the last two digits (2.1e-14
 * relative) and F4a's determinant is out by a factor of two — it is a
 * cancellation to near zero, so every digit is at stake. Rounding once is also
 * the more accurate computation, so the port does it deliberately rather than
 * to imitate one machine. A build of R that does not contract the multiply-add
 * disagrees with these fixtures in the same last digits; nothing drawn from
 * this data could show the difference.
 *
 * ## Tolerance
 *
 * Bit-exact (`toBe`) throughout, apart from two stated cases: the reciprocal
 * condition number of the four-equal-entries matrix at `1e-5` (one unit in the
 * last place away from R's `dgecon` estimate, which the port computes in
 * closed form) and the residues of `A %*% solve(A)`, which depend on the
 * multiplication order of a matrix product this package does not provide.
 *
 * ## Beyond these fixtures
 *
 * A sweep of 20000 random settings of the interactive gadget's four sliders
 * (step 0.1, from -2 to 2, of which 64 were exactly singular and 66
 * computationally singular) was run through R and through this port. The
 * determinant, all four entries of the inverse, and the verdict on
 * singularity are the same doubles in every one of the 20000. The condition
 * number is not: R reads an estimate from `dgecon`, which for a well
 * conditioned matrix can sit up to about twice this port's exact value. It
 * never moved a verdict.
 */

import { describe, expect, test } from "bun:test";

import { determinant, invertMatrix, type Matrix2 } from "./matrix";

/**
 * Build a matrix from the four entries in R's printing order — row 1 first.
 *
 * `rMatrix(a11, a12, a21, a22)` is R's `matrix(c(a11, a21, a12, a22), nrow =
 * 2)`, which `plot_matrix_inverse` would have been given as
 * `x1 = a11, y1 = a21, x2 = a12, y2 = a22`.
 */
function rMatrix(
  a11: number,
  a12: number,
  a21: number,
  a22: number,
): Matrix2 {
  return { x1: a11, y1: a21, x2: a12, y2: a22 };
}

/** Read a matrix back in R's printing order, for comparison against R. */
function entries(matrix: Matrix2): [number, number, number, number] {
  return [matrix.x1, matrix.x2, matrix.y1, matrix.y2];
}

/** Assert every entry against R, to the last bit. */
function expectEntries(
  actual: Matrix2 | null,
  expected: readonly [number, number, number, number],
): void {
  expect(actual).not.toBeNull();
  const got = entries(actual as Matrix2);
  expect(got[0]).toBe(expected[0]);
  expect(got[1]).toBe(expected[1]);
  expect(got[2]).toBe(expected[2]);
  expect(got[3]).toBe(expected[3]);
}

/**
 * Multiply two matrices, the plain way.
 *
 * The package exports no matrix product: `plot_matrix_inverse` never needs
 * one. This helper exists only to check that an inverse is an inverse. Its
 * last bits are its own — R's `%*%` reaches the BLAS, whose accumulation
 * order and fused updates give slightly different residues — so the tests
 * that use it state a bound rather than a value, except where the product is
 * exactly the identity.
 */
function multiply(a: Matrix2, b: Matrix2): Matrix2 {
  return {
    x1: a.x1 * b.x1 + a.x2 * b.y1,
    y1: a.y1 * b.x1 + a.y2 * b.y1,
    x2: a.x1 * b.x2 + a.x2 * b.y2,
    y2: a.y1 * b.x2 + a.y2 * b.y2,
  };
}

const F1 = rMatrix(1, 2, 2, 1); // x1=1,  y1=2,    x2=2,    y2=1
const F2 = rMatrix(1.3, 0.4, -0.7, 1.9); // x1=1.3, y1=-0.7, x2=0.4, y2=1.9
const F3 = rMatrix(-1.5, 0.6, 0.8, 1.3);
const F4A = rMatrix(-2, -1.5, -1.6, -1.2);
const F4B = rMatrix(-2, -2, -2, -2);
const F4C = rMatrix(2, 1.9, 1.9, 1.8);
const F5 = rMatrix(1, 1, 1, 1);
const IDENTITY = rMatrix(1, 0, 0, 1);
const REFLECTION = rMatrix(0, 1, 1, 0);
const ZERO = rMatrix(0, 0, 0, 0);

/** `matrix(c(1, 1, 1, 1 + eps), nrow = 2)` — determinant eps, at the edge. */
function nearlySingular(eps: number): Matrix2 {
  return rMatrix(1, 1, 1, 1 + eps);
}

/** Four equal entries: singular in exact arithmetic, at any scale. */
function equalEntries(value: number): Matrix2 {
  return rMatrix(value, value, value, value);
}

describe("the column convention", () => {
  test("(x1, y1) is column 1 and (x2, y2) is column 2", () => {
    // R: matrix(c(1, 2, 0, 1), nrow = 2) is [[1, 0], [2, 1]], det 1, and
    // solve() gives [1, 0; -2, 1].
    const shear: Matrix2 = { x1: 1, y1: 2, x2: 0, y2: 1 };

    expect(determinant(shear)).toBe(1);
    expectEntries(invertMatrix(shear).inverse, [1, 0, -2, 1]);
  });

  test("the transpose gives the transposed inverse", () => {
    // R: matrix(c(1, 0, 2, 1), nrow = 2) is [[1, 2], [0, 1]], and solve()
    // gives [1, -2; 0, 1]. A port that read the fields the other way round
    // would return this answer for the case above.
    const transposed: Matrix2 = { x1: 1, y1: 0, x2: 2, y2: 1 };

    expect(determinant(transposed)).toBe(1);
    expectEntries(invertMatrix(transposed).inverse, [1, -2, 0, 1]);
  });
});

describe("determinant, against R's det()", () => {
  test("F1, the interactive default, is R's -2.9999999999999996 and not -3", () => {
    // The whole point of the fixture: x1*y2 - x2*y1 is exactly -3 here, and R
    // is not. Reaching -3 means the port stopped following R's factorization.
    expect(determinant(F1)).toBe(-2.9999999999999996);
    expect(determinant(F1)).not.toBe(-3);
    expect(F1.x1 * F1.y2 - F1.x2 * F1.y1).toBe(-3);
  });

  test("F2, generic decimals", () => {
    expect(determinant(F2)).toBe(2.75);
  });

  test("F3, negative determinant with decimals", () => {
    expect(determinant(F3)).toBe(-2.4300000000000002);
  });

  test("F4a, a cancellation down to one unit in the last place", () => {
    expect(determinant(F4A)).toBe(-2.2204460492503185e-16);
  });

  test("F4c, small but invertible", () => {
    expect(determinant(F4C)).toBe(-0.0099999999999995787);
  });

  test("F6, the identity", () => {
    expect(determinant(IDENTITY)).toBe(1);
  });

  test("F7, the reflection", () => {
    expect(determinant(REFLECTION)).toBe(-1);
  });

  test("the epsilon sweep, either side of R's singularity bar", () => {
    // R: det of matrix(c(1,1,1,1+eps), nrow = 2) at three eps values.
    expect(determinant(nearlySingular(2.2204460492503131e-16))).toBe(
      2.2204460492503185e-16,
    );
    expect(determinant(nearlySingular(4.4408920985006262e-16))).toBe(
      4.4408920985006143e-16,
    );
    expect(determinant(nearlySingular(1.0000000000000001e-15))).toBe(
      1.1102230246251546e-15,
    );
  });

  test("four equal entries away from 1 keep a nonzero determinant", () => {
    // Fixture section 2c. The reciprocal scaling is what leaves anything at
    // all here; dividing gives an exact zero and the wrong error from R.
    expect(determinant(equalEntries(1e-5))).toBe(1.1102230246251529e-26);
    expect(determinant(equalEntries(-3.7))).toBe(1.51989532071183e-15);
  });

  test("a determinant too large for a double overflows, as R's does", () => {
    // In-session R: det(matrix(c(1e200, 1e200, 1e200, 1.0000001e200), nrow=2))
    // is Inf, and solve() still succeeds.
    expect(determinant(rMatrix(1e200, 1e200, 1e200, 1.0000001e200))).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  test("the determinant of the inverse matches R's det(solve(A))", () => {
    expect(determinant(invertMatrix(F1).inverse as Matrix2)).toBe(
      -0.33333333333333331,
    );
    expect(determinant(invertMatrix(F2).inverse as Matrix2)).toBe(
      0.36363636363636365,
    );
    expect(determinant(invertMatrix(F4C).inverse as Matrix2)).toBe(
      -100.00000000001053,
    );
  });

  test("the determinant of the inverse is not 1 over the determinant", () => {
    // R's own finding on F1: two roads to -1/3 land on adjacent doubles.
    // det(solve(A)) is -0.33333333333333331, 1/det(A) is -0.33333333333333337.
    expect(1 / determinant(F1)).toBe(-0.33333333333333337);
    expect(determinant(invertMatrix(F1).inverse as Matrix2)).not.toBe(
      1 / determinant(F1),
    );
  });
});

describe("determinant of a singular matrix", () => {
  test("a zero pivot gives exactly zero, float noise near one does not", () => {
    // The contrast the port has to keep. The first four have a literal zero
    // pivot. The last three are singular on paper too, and R reports a
    // determinant for each because the factorization works in doubles.
    expect(determinant(F4B)).toBe(0);
    expect(determinant(F5)).toBe(0);
    expect(determinant(equalEntries(1e10))).toBe(0);
    expect(determinant(ZERO)).toBe(0);

    expect(determinant(F4A)).not.toBe(0);
    expect(determinant(equalEntries(1e-5))).not.toBe(0);
    expect(determinant(equalEntries(-3.7))).not.toBe(0);
  });

  test("a zero determinant is positive zero even after a row interchange", () => {
    // R's det_ge_real leaves its sign at 1 when the factorization reports a
    // zero pivot: the interchange count is only read on the path that
    // multiplies the diagonal. In-session R confirms it — det of
    // matrix(c(0, 1, 0, 2), nrow = 2), whose first column forces an
    // interchange, prints 0 and not -0.
    const interchanged: Matrix2 = { x1: 0, y1: 1, x2: 0, y2: 2 };
    // The same first column with a second column that is not a multiple of
    // it: matrix(c(0, 1, 1, 2), nrow = 2), det -1 in R.
    const invertible: Matrix2 = { x1: 0, y1: 1, x2: 1, y2: 2 };

    expect(determinant(interchanged)).toBe(0);
    expect(Object.is(determinant(interchanged), -0)).toBe(false);
    expect(determinant(invertible)).toBe(-1);
  });
});

describe("invertMatrix, against R's solve()", () => {
  test("F1 gives the exact doubles for ±1/3 and ±2/3", () => {
    expectEntries(invertMatrix(F1).inverse, [
      -0.33333333333333331, 0.66666666666666663, 0.66666666666666663,
      -0.33333333333333331,
    ]);
  });

  test("F2, generic decimals", () => {
    expectEntries(invertMatrix(F2).inverse, [
      0.69090909090909092, -0.14545454545454545, 0.25454545454545446,
      0.47272727272727272,
    ]);
  });

  test("F3, negative determinant", () => {
    expectEntries(invertMatrix(F3).inverse, [
      -0.53497942386831276, 0.24691358024691357, 0.32921810699588477,
      0.61728395061728392,
    ]);
  });

  test("F4c stretches into the hundreds and is still invertible", () => {
    const result = invertMatrix(F4C);

    expect(result.singularity).toBeNull();
    expectEntries(result.inverse, [
      -180.00000000000767, 190.0000000000081, 190.0000000000081,
      -200.00000000000853,
    ]);
  });

  test("F6, the identity, inverts to itself", () => {
    expectEntries(invertMatrix(IDENTITY).inverse, [1, 0, 0, 1]);
  });

  test("F7, the reflection, is its own inverse", () => {
    expectEntries(invertMatrix(REFLECTION).inverse, [0, 1, 1, 0]);
  });

  test("a matrix one unit in the last place from singular still inverts", () => {
    // Fixture section 2: at eps = 1e-15, R succeeds with solve()[1,1] =
    // 900719925474100.25.
    const result = invertMatrix(nearlySingular(1.0000000000000001e-15));

    expect(result.singularity).toBeNull();
    expect((result.inverse as Matrix2).x1).toBe(900719925474100.25);
  });

  test("two slider settings from the middle of the range", () => {
    // In-session R, both at the interactive slider's step of 0.1.
    expectEntries(invertMatrix(rMatrix(-2, 1.1, 0.3, -1.7)).inverse, [
      -0.55374592833876224, -0.35830618892508148, -0.097719869706840393,
      -0.65146579804560267,
    ]);
    expectEntries(invertMatrix(rMatrix(0.1, 0.2, -0.1, 0.2)).inverse, [
      5, -5, 2.5, 2.5,
    ]);
  });

  test("an inverse survives a determinant that overflowed", () => {
    // In-session R: det is Inf, and solve() returns these four entries.
    const result = invertMatrix(rMatrix(1e200, 1e200, 1e200, 1.0000001e200));

    expect(result.determinant).toBe(Number.POSITIVE_INFINITY);
    expectEntries(result.inverse, [
      1.0000001001124038e-193, -1.0000000001124038e-193,
      -1.0000000001124038e-193, 1.0000000001124038e-193,
    ]);
  });

  test("a zero entry of an inverse carries no sign, as R's does not", () => {
    // Written after a sweep of 20000 slider settings against R, which is
    // where the case turned up: the substitution can leave a negative zero,
    // and R produced a positive zero for all 1498 zero entries in the sweep.
    // R: solve(matrix(c(0.4, 0, 0, -0.7), nrow = 2)) is
    // [2.5, 0; 0, -1.4285714285714286], det -0.27999999999999997.
    const diagonal: Matrix2 = { x1: 0.4, y1: 0, x2: 0, y2: -0.7 };
    const result = invertMatrix(diagonal);

    expect(result.determinant).toBe(-0.27999999999999997);
    expectEntries(result.inverse, [2.5, 0, 0, -1.4285714285714286]);
    expect(Object.is((result.inverse as Matrix2).x2, -0)).toBe(false);
    expect(Object.is((result.inverse as Matrix2).y1, -0)).toBe(false);
  });

  test("the result carries the determinant of the same matrix", () => {
    expect(invertMatrix(F1).determinant).toBe(-2.9999999999999996);
    expect(invertMatrix(F1).determinant).toBe(determinant(F1));
    expect(invertMatrix(F4A).determinant).toBe(determinant(F4A));
    expect(invertMatrix(ZERO).determinant).toBe(determinant(ZERO));
  });
});

describe("singularity, where R's solve() raises an error", () => {
  test("F5, four ones, is exactly singular at the second pivot", () => {
    // R: "Lapack routine dgesv: system is exactly singular: U[2,2] = 0".
    const result = invertMatrix(F5);

    expect(result.singularity).toBe("exact");
    expect(result.zeroPivot).toBe(2);
    expect(result.inverse).toBeNull();
    expect(result.rcond).toBe(0);
  });

  test("F4b, four equal entries at -2, is exactly singular", () => {
    const result = invertMatrix(F4B);

    expect(result.singularity).toBe("exact");
    expect(result.zeroPivot).toBe(2);
    expect(result.inverse).toBeNull();
  });

  test("four equal entries at 1e10 is exactly singular", () => {
    const result = invertMatrix(equalEntries(1e10));

    expect(result.singularity).toBe("exact");
    expect(result.zeroPivot).toBe(2);
    expect(result.inverse).toBeNull();
  });

  test("the zero matrix names the first pivot, as R does", () => {
    // Fixture section 2c: the message is "U[1,1] = 0" here and "U[2,2] = 0"
    // everywhere else, because the whole first column is zero and the
    // interchange finds nothing to bring up.
    const result = invertMatrix(ZERO);

    expect(result.singularity).toBe("exact");
    expect(result.zeroPivot).toBe(1);
    expect(result.inverse).toBeNull();
  });

  test("a zero pivot after an interchange still names the second pivot", () => {
    // In-session R on matrix(c(0, 1, 0, 2), nrow = 2): "U[2,2] = 0".
    const result = invertMatrix({ x1: 0, y1: 1, x2: 0, y2: 2 });

    expect(result.singularity).toBe("exact");
    expect(result.zeroPivot).toBe(2);
    expect(result.inverse).toBeNull();
  });

  test("F4a is computationally singular, not exactly singular", () => {
    // R: "system is computationally singular: reciprocal condition number =
    // 1.76226e-17". The determinant is nonzero, so nothing about it says the
    // matrix is out of reach; only the condition number does.
    const result = invertMatrix(F4A);

    expect(result.singularity).toBe("computational");
    expect(result.zeroPivot).toBeNull();
    expect(result.inverse).toBeNull();
    expect(result.determinant).toBe(-2.2204460492503185e-16);
  });

  test("four equal entries at 1e-5 and at -3.7 are computationally singular", () => {
    // Fixture section 2c. Both have a nonzero determinant.
    const small = invertMatrix(equalEntries(1e-5));
    const negative = invertMatrix(equalEntries(-3.7));

    expect(small.singularity).toBe("computational");
    expect(small.inverse).toBeNull();
    expect(negative.singularity).toBe("computational");
    expect(negative.inverse).toBeNull();
  });

  test("the bar sits at machine epsilon, where R's tol is", () => {
    // Fixture section 2, bisected in R: eps = 2.22e-16 and 4.44e-16 both fail
    // the condition-number test, eps = 1e-15 passes it.
    expect(invertMatrix(nearlySingular(2.2204460492503131e-16)).singularity)
      .toBe("computational");
    expect(invertMatrix(nearlySingular(4.4408920985006262e-16)).singularity)
      .toBe("computational");
    expect(invertMatrix(nearlySingular(1.0000000000000001e-15)).singularity)
      .toBeNull();
  });

  test("an epsilon below half machine epsilon is exactly singular", () => {
    // 1 + eps rounds back to 1, so the second pivot is a literal zero.
    expect(invertMatrix(nearlySingular(1e-17)).singularity).toBe("exact");
    expect(invertMatrix(nearlySingular(1e-300)).singularity).toBe("exact");
    expect(invertMatrix(nearlySingular(0)).singularity).toBe("exact");
  });

  test("an invertible matrix reports no singularity and no zero pivot", () => {
    const result = invertMatrix(F1);

    expect(result.singularity).toBeNull();
    expect(result.zeroPivot).toBeNull();
    expect(result.inverse).not.toBeNull();
  });
});

describe("the reciprocal condition number", () => {
  test("F4c matches R's rcond() to the last bit", () => {
    expect(invertMatrix(F4C).rcond).toBe(0.00065746219592370634);
  });

  test("the near-singular cases match R's rcond() to the last bit", () => {
    // In-session R, rcond(A, norm = "O") at full precision. The fixture
    // document only had these to the five digits of the error message.
    expect(invertMatrix(F4A).rcond).toBe(1.7622587692462801e-17);
    expect(invertMatrix(nearlySingular(2.2204460492503131e-16)).rcond).toBe(
      5.5511151231257827e-17,
    );
    expect(invertMatrix(nearlySingular(4.4408920985006262e-16)).rcond).toBe(
      1.110223024625156e-16,
    );
    expect(invertMatrix(equalEntries(-3.7)).rcond).toBe(2.775557561562892e-17);
  });

  test("four equal entries at 1e-5 is within one unit in the last place", () => {
    // R's dgecon estimates the norm of the inverse; this port computes the
    // inverse and takes its norm. On this one case of every case tested the
    // two land on adjacent doubles: R gives 2.7755575615628914e-17.
    const rcond = invertMatrix(equalEntries(1e-5)).rcond;

    expect(Math.abs(rcond / 2.7755575615628914e-17 - 1)).toBeLessThan(1e-15);
  });

  test("a well conditioned matrix has a condition number near one", () => {
    expect(invertMatrix(IDENTITY).rcond).toBe(1);
    expect(invertMatrix(REFLECTION).rcond).toBe(1);
  });

  test("the exactly singular cases report zero, the borderline ones do not", () => {
    // R never reaches its condition-number test on an exactly singular
    // matrix: the factorization has already failed. Zero is the limit and
    // keeps the field a number. A computationally singular matrix, on the
    // other hand, has a condition number and R prints it in the error.
    expect(invertMatrix(F5).rcond).toBe(0);
    expect(invertMatrix(ZERO).rcond).toBe(0);
    expect(invertMatrix(F4A).rcond).toBeGreaterThan(0);
  });
});

describe("a matrix times its inverse", () => {
  test("F1 gives the identity exactly", () => {
    const product = multiply(F1, invertMatrix(F1).inverse as Matrix2);

    expect(entries(product)).toEqual([1, 0, 0, 1]);
  });

  test("F6 and F7 give the identity exactly", () => {
    expect(
      entries(multiply(IDENTITY, invertMatrix(IDENTITY).inverse as Matrix2)),
    ).toEqual([1, 0, 0, 1]);
    expect(
      entries(
        multiply(REFLECTION, invertMatrix(REFLECTION).inverse as Matrix2),
      ),
    ).toEqual([1, 0, 0, 1]);
  });

  test("F2 leaves a residue of the size R's does", () => {
    // R: [1, 1.049665405100148e-17; -1.2807936529539305e-16,
    // 0.99999999999999989]. Two-decimal input does not make an exact inverse.
    const product = multiply(F2, invertMatrix(F2).inverse as Matrix2);
    const [a11, a12, a21, a22] = entries(product);

    expect(Math.abs(a11 - 1)).toBeLessThanOrEqual(2.3e-16);
    expect(Math.abs(a22 - 1)).toBeLessThanOrEqual(2.3e-16);
    expect(Math.abs(a12)).toBeLessThanOrEqual(2.3e-16);
    expect(Math.abs(a21)).toBeLessThanOrEqual(2.3e-16);
  });

  test("F4c leaves a residue of the size R's does", () => {
    // R: [1.0000000000000258, 1.7763568394003262e-14; 3.6859404417555557e-14,
    // 0.99999999999999112]. A determinant of 0.01 costs about two digits.
    const product = multiply(F4C, invertMatrix(F4C).inverse as Matrix2);
    const [a11, a12, a21, a22] = entries(product);

    expect(Math.abs(a11 - 1)).toBeLessThanOrEqual(1e-13);
    expect(Math.abs(a22 - 1)).toBeLessThanOrEqual(1e-13);
    expect(Math.abs(a12)).toBeLessThanOrEqual(1e-13);
    expect(Math.abs(a21)).toBeLessThanOrEqual(1e-13);
  });
});

describe("entries that are not finite", () => {
  test("a NaN entry spreads, as it does through R's solve()", () => {
    // In-session R: det is NaN and solve() returns four NaNs without an
    // error. Neither the zero-pivot test nor the condition-number test fires,
    // because every comparison with NaN is false.
    const result = invertMatrix({ x1: Number.NaN, y1: 1, x2: 1, y2: 1 });

    expect(result.determinant).toBeNaN();
    expect(result.singularity).toBeNull();
    expect(result.inverse).not.toBeNull();
    expect((result.inverse as Matrix2).x1).toBeNaN();
  });

  test("an infinite entry is reported as singular — a deviation from R", () => {
    // In-session R: det is Inf, and solve() returns [0, 0; 0, 1] without an
    // error, but R's own rcond() refuses the same matrix with "error code -5
    // from Lapack routine 'dgecon()'". So R answers here by accident: its
    // condition test cannot judge a matrix of infinite norm and does not stop
    // it. The port keeps its one rule — no inverse below one machine epsilon
    // of condition — which reports an infinitely ill-conditioned matrix as
    // singular. Sliders cannot produce an infinity; a caller that does gets a
    // refusal instead of a matrix of zeros.
    const result = invertMatrix({
      x1: Number.POSITIVE_INFINITY,
      y1: 1,
      x2: 1,
      y2: 1,
    });

    expect(result.determinant).toBe(Number.POSITIVE_INFINITY);
    expect(result.singularity).toBe("computational");
    expect(result.rcond).toBe(0);
    expect(result.inverse).toBeNull();
  });
});

describe("purity", () => {
  test("the input is not modified", () => {
    const input: Matrix2 = { x1: 1.3, y1: -0.7, x2: 0.4, y2: 1.9 };
    const frozen = Object.freeze({ ...input });

    invertMatrix(frozen);
    determinant(frozen);

    expect(frozen).toEqual(input);
  });

  test("two calls on the same matrix agree", () => {
    const first = invertMatrix(F3);
    const second = invertMatrix(F3);

    expect(first.inverse).not.toBeNull();
    expect(second).toEqual(first);
  });
});
