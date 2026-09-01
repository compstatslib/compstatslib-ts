/**
 * Tests for the QR factorization, R's `qr()` with `LAPACK = FALSE`.
 *
 * Expected values come from R 4.5.3, `../compstatslib/conformance-fixtures/linalg.R`
 * section 2, captured in `.claude/plans/003-PLAN-linalg/linalg-fixtures.md`.
 *
 * The compact factorization, `qraux`, `pivot` and `rank` pin exactly: this
 * is the code path `ols.test.ts` has pinned exactly since the port, moved
 * behind its own name. The readers (`qrQ`, `qrR`, `qrCoef`, `qrFitted`,
 * `qrResid`) pin exactly too, because they run the same reflectors in the
 * same order as LINPACK's `dqrsl`. R prints `pivot` 1-based; the port
 * stores it 0-based, and the tests below subtract one.
 */

import { describe, expect, test } from "bun:test";
import { matrix, type Matrix } from "./matrix.js";
import { cbind, crossprod, identity, matmul } from "./ops.js";
import {
  qr,
  qrCoef,
  qrFitted,
  qrQ,
  qrQty,
  qrQy,
  qrR,
  qrResid,
  type QrOptions,
} from "./qr.js";

function columnMajor(m: Matrix): number[] {
  return Array.from(m.data);
}

/** Compare to R at a stated absolute tolerance (plan Q1). */
function closeTo(actual: readonly number[], expected: readonly number[], tolerance = 1e-12): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    expect(Math.abs(value - (expected[index] as number))).toBeLessThanOrEqual(tolerance);
  });
}

const x = [1, 3, 5, 8];
const y = [2, 4, 6, 8];
const X = cbind([1, 1, 1, 1], x);

describe("qr() — fixture 2a, full rank n > p", () => {
  const q = qr(X);

  test("rank and pivot", () => {
    expect(q.rank).toBe(2);
    expect(q.pivot).toEqual([0, 1]);
  });

  test("compact factorization and qraux pin exactly", () => {
    expect([q.qr.nrow, q.qr.ncol]).toEqual([4, 2]);
    expect(columnMajor(q.qr)).toEqual([
      -2, 0.5, 0.5, 0.5, -8.5, 5.1720402163943007, -0.35447004598340998,
      -0.93451193941080823,
    ]);
    expect(q.qraux).toEqual([1.5, 1.0322245496348554]);
  });

  test("qrCoef, qrFitted, qrResid", () => {
    expect(qrCoef(q, y)).toEqual([1.3457943925233646, 0.85981308411214952]);
    expect(qrFitted(q, y)).toEqual([
      2.205607476635512, 3.9252336448598126, 5.6448598130841114,
      8.2242990654205599,
    ]);
    expect(qrResid(q, y)).toEqual([
      -0.20560747663551376, 0.074766355140186522, 0.35514018691588811,
      -0.22429906542056077,
    ]);
  });

  test("qrQ and qrR", () => {
    const Q = qrQ(q);
    expect([Q.nrow, Q.ncol]).toEqual([4, 2]);
    expect(columnMajor(Q)).toEqual([
      -0.5, -0.5, -0.5, -0.5, -0.62837871787968136, -0.24168412226141589,
      0.14501047335684952, 0.72505236678424778,
    ]);
    const R = qrR(q);
    expect([R.nrow, R.ncol]).toEqual([2, 2]);
    expect(columnMajor(R)).toEqual([-2, 0, -8.5, 5.1720402163943007]);
  });

  test("Q %*% R recovers X and crossprod(Q) is I, to R's own rounding", () => {
    expect(columnMajor(matmul(qrQ(q), qrR(q)))).toEqual([
      1, 1, 1, 1, 0.99999999999999967, 3, 5, 8,
    ]);
    closeTo(columnMajor(crossprod(qrQ(q))), [1, 0, 0, 1]);
  });

  test("qrQty and qrQy are inverse of each other", () => {
    const qty = qrQty(q, y);
    closeTo(qrQy(q, qty), y);
  });

  test("does not modify its input", () => {
    const before = columnMajor(X);
    qr(X);
    expect(columnMajor(X)).toEqual(before);
  });
});

describe("qr() — fixture 2b, a duplicated column is aliased", () => {
  const q = qr(cbind([1, 1, 1, 1], [1, 1, 1, 1], x));

  test("pivots the duplicate to the end and reports rank 2", () => {
    expect(q.rank).toBe(2);
    expect(q.pivot).toEqual([0, 2, 1]);
    expect(q.qraux).toEqual([1.5, 1.0322245496348554, 0]);
    expect(columnMajor(q.qr)).toEqual([
      -2, 0.5, 0.5, 0.5, -8.5, 5.1720402163943007, -0.35447004598340998,
      -0.93451193941080823, -2, 0, 0, 0,
    ]);
  });

  test("qrCoef reports null for the aliased column, in the original order", () => {
    expect(qrCoef(q, y)).toEqual([
      1.3457943925233646, null, 0.85981308411214952,
    ]);
  });

  test("fitted and residuals ignore the aliased column", () => {
    expect(qrFitted(q, y)).toEqual([
      2.205607476635512, 3.9252336448598126, 5.6448598130841114,
      8.2242990654205599,
    ]);
  });
});

describe("qr() — fixture 2c, more columns than rows", () => {
  const q = qr(matrix([1, 10], { nrow: 1 }));

  test("the one row is never reflected", () => {
    expect(q.rank).toBe(1);
    expect(q.pivot).toEqual([0, 1]);
    expect(q.qraux).toEqual([1, 10]);
    expect(columnMajor(q.qr)).toEqual([1, 10]);
  });

  test("coef, fitted, resid", () => {
    expect(qrCoef(q, [3])).toEqual([3, null]);
    expect(qrFitted(q, [3])).toEqual([3]);
    expect(qrResid(q, [3])).toEqual([0]);
  });
});

describe("qr() — fixture 2d, square full rank", () => {
  const S = matrix([2, 1, -1, 1, 3, 2, 1, -1, 4], { nrow: 3 });
  const q = qr(S);
  const b = [1, 2, 3];

  test("factorization", () => {
    expect(q.rank).toBe(3);
    expect(q.qraux).toEqual([
      1.8164965809277263, 1.7071067811865475, 3.4641016151377539,
    ]);
    expect(columnMajor(q.qr)).toEqual([
      -2.4494897427831779, 0.40824829046386307, -0.40824829046386307,
      -1.2247448713915896, -3.5355339059327378, 0.70710678118654746,
      1.2247448713915892, -2.1213203435596424, 3.4641016151377544,
    ]);
  });

  test("solves the square system", () => {
    expect(qrCoef(q, b)).toEqual([
      -0.066666666666666596, 0.79999999999999993, 0.33333333333333348,
    ]);
    expect(qrFitted(q, b)).toEqual([1.0000000000000007, 2, 3]);
    expect(qrResid(q, b)).toEqual([0, 0, 0]);
  });

  test("qrQ and qrR are square", () => {
    expect(columnMajor(qrQ(q))).toEqual([
      -0.81649658092772626, -0.40824829046386307, 0.40824829046386307,
      2.4514267852689627e-17, -0.70710678118654746, -0.70710678118654746,
      0.57735026918962584, -0.57735026918962562, 0.57735026918962573,
    ]);
    expect(columnMajor(qrR(q))).toEqual([
      -2.4494897427831779, 0, 0, -1.2247448713915896, -3.5355339059327378,
      0, 1.2247448713915892, -2.1213203435596424, 3.4641016151377544,
    ]);
  });
});

describe("qr() — fixture 2e, the moderation-shaped design with names", () => {
  const xx = [1, 2, 3, 4, 5, 6];
  const z = [2, 5, 1, 9, 4, 6];
  const yy = [3.1, 4.4, 2.2, 9.9, 5.5, 7.7];
  const M = matrix(
    [1, 1, 1, 1, 1, 1, ...xx, ...z, ...xx.map((v, i) => v * (z[i] as number))],
    { nrow: 6, dimnames: [null, ["(Intercept)", "xx", "z", "xx:z"]] },
  );
  const q = qr(M);

  test("factorization", () => {
    expect(q.rank).toBe(4);
    expect(q.qraux).toEqual([
      1.4082482904638631, 1.1853214218491976, 1.5002817752238666,
      1.4182240591743398,
    ]);
    expect(columnMajor(q.qr)).toEqual([
      -2.4494897427831779, 0.40824829046386307, 0.40824829046386307,
      0.40824829046386307, 0.40824829046386307, 0.40824829046386307,
      -8.5732140997411257, 4.1833001326703769, -0.053724300017681061,
      -0.29277002188455981, -0.5318157437514387, -0.77086146561831748,
      -11.022703842524304, 2.9880715233359822, 5.7071383872680501,
      -0.83916130349861129, 0.099244710942913802, -0.1888834017038705,
      -43.682567079633344, 27.848826597491371, 19.674608650845126,
      5.8468765090670951, 0.87585286686180175, 0.24077041333540419,
    ]);
  });

  test("coefficients, fitted, residuals", () => {
    expect(qrCoef(q, yy)).toEqual([
      2.4894248862431185, -0.36766225324164448, 0.26168702316192777,
      0.17307297546956804,
    ]);
    expect(qrFitted(q, yy)).toEqual([
      2.9912826302644668, 4.7932652502651498, 2.167344076088817,
      9.6045861986383407, 5.1593212220739684, 8.0842006226692682,
    ]);
    expect(qrResid(q, yy)).toEqual([
      0.10871736973553679, -0.39326525026514753, 0.032655923911183694,
      0.29541380136166112, 0.34067877792603268, -0.38420062266926674,
    ]);
  });

  test("column names travel onto the compact form and qrR, in pivot order", () => {
    expect(q.qr.dimnames).toEqual([null, ["(Intercept)", "xx", "z", "xx:z"]]);
    expect(qrR(q).dimnames).toEqual([null, ["(Intercept)", "xx", "z", "xx:z"]]);
    expect(columnMajor(qrR(q))).toEqual([
      -2.4494897427831779, 0, 0, 0, -8.5732140997411257, 4.1833001326703769,
      0, 0, -11.022703842524304, 2.9880715233359822, 5.7071383872680501, 0,
      -43.682567079633344, 27.848826597491371, 19.674608650845126,
      5.8468765090670951,
    ]);
  });

  test("a pivoted matrix reorders its column names, as R does", () => {
    const named = cbind(
      matrix([1, 1, 1, 1], { nrow: 4, dimnames: [null, ["one"]] }),
      matrix([1, 1, 1, 1], { nrow: 4, dimnames: [null, ["dup"]] }),
      matrix(x, { nrow: 4, dimnames: [null, ["x"]] }),
    );
    expect(qr(named).qr.dimnames).toEqual([null, ["one", "x", "dup"]]);
  });
});

describe("qr() — fixture 2f, the rank tolerance", () => {
  const near = cbind([1, 1, 1, 1], [1, 1, 1, 1 + 1e-8]);

  test("tol = 1e-7 aliases the near-duplicate", () => {
    const q = qr(near, { tolerance: 1e-7 });
    expect(q.rank).toBe(1);
    expect(q.qraux).toEqual([1.5, 1.1924500802337632]);
    expect(columnMajor(q.qr)).toEqual([
      -2, 0.5, 0.5, 0.5, -2.0000000049999995, 8.6602540279444484e-09,
      0.1924500802337632, -0.96225045244782104,
    ]);
    expect(qrCoef(q, y)).toEqual([5, null]);
    expect(qrFitted(q, y)).toEqual([5, 5, 5, 5]);
    expect(qrResid(q, y)).toEqual([-3, -1, 1, 3]);
  });

  test("tol = 1e-11 keeps it", () => {
    const q = qr(near, { tolerance: 1e-11 });
    expect(q.rank).toBe(2);
    expect(qrCoef(q, y)).toEqual([-400000000.4047181, 400000004.40471816]);
    expect(qrFitted(q, y)).toEqual([
      3.9999999506567541, 4.000000009868649, 4.000000009868649,
      8.0000000296059479,
    ]);
  });
});

describe("qr() — fixture 2g, an all-zero column", () => {
  const q = qr(cbind(x, [0, 0, 0, 0]));

  test("is aliased with a zero qraux", () => {
    expect(q.rank).toBe(1);
    expect(q.pivot).toEqual([0, 1]);
    expect(q.qraux).toEqual([1.1005037815259211, 0]);
    expect(columnMajor(q.qr)).toEqual([
      -9.9498743710661994, 0.30151134457776363, 0.50251890762960605,
      0.80403025220736968, 0, 0, 0, 0,
    ]);
    expect(qrCoef(q, y)).toEqual([1.0909090909090908, null]);
    expect(qrResid(q, y)).toEqual([
      0.90909090909090939, 0.72727272727272729, 0.54545454545454553,
      -0.72727272727272718,
    ]);
  });
});

describe("qr() — refusals", () => {
  test("a response of the wrong length, with R's wording — fixture 2h", () => {
    const q = qr(X);
    expect(() => qrCoef(q, [1, 2, 3])).toThrow(
      /'qr' and 'y' must have the same number of rows/,
    );
    expect(() => qrFitted(q, [1, 2, 3])).toThrow(RangeError);
    expect(() => qrQty(q, [1, 2, 3])).toThrow(RangeError);
  });

  test("a tolerance that is negative or NaN", () => {
    expect(() => qr(X, { tolerance: -1 })).toThrow(RangeError);
    expect(() => qr(X, { tolerance: Number.NaN })).toThrow(RangeError);
  });
});

describe("qr() — long inputs", () => {
  test("a million-row column does not overflow the stack", () => {
    const n = 1_000_000;
    const ones = matrix(new Array<number>(n).fill(1), { nrow: n });
    const q = qr(ones);
    expect(q.rank).toBe(1);
    // The column norm is sqrt(n); the first R entry is -sqrt(n).
    expect(q.qr.data[0]).toBe(-Math.sqrt(n));
  });
});

describe("qr() — fixture 2i, names, a matrix y, tol = 0", () => {
  const nm = matrix([1, 2, 3, 4, 5, 6], {
    nrow: 3,
    dimnames: [
      ["r1", "r2", "r3"],
      ["a", "b"],
    ],
  });
  const q = qr(nm);
  const Y2 = matrix([1, 2, 3, 2, 3, 5], { nrow: 3, dimnames: [null, ["y1", "y2"]] });

  test("row names travel onto the compact form and qrR, not onto qrQ", () => {
    expect(q.qr.dimnames).toEqual([
      ["r1", "r2", "r3"],
      ["a", "b"],
    ]);
    expect(qrR(q).dimnames).toEqual([
      ["r1", "r2"],
      ["a", "b"],
    ]);
    expect(qrQ(q).dimnames).toBeNull();
    const wide = matrix([1, 2, 3, 4, 5, 6], {
      nrow: 2,
      dimnames: [
        ["r1", "r2"],
        ["a", "b", "c"],
      ],
    });
    expect(qrR(qr(wide)).dimnames).toEqual([
      ["r1", "r2"],
      ["a", "b", "c"],
    ]);
  });

  test("qrCoef with a matrix y gives a matrix named by both", () => {
    const coef = qrCoef(q, Y2);
    expect([coef.nrow, coef.ncol]).toEqual([2, 2]);
    expect(coef.dimnames).toEqual([
      ["a", "b"],
      ["y1", "y2"],
    ]);
    expect(columnMajor(coef)).toEqual([
      0.99999999999999944, 2.4620206472929435e-16, 1.3888888888888884,
      0.11111111111111123,
    ]);
  });

  test("qrFitted, qrResid, qrQty, qrQy with a matrix y", () => {
    expect(columnMajor(qrFitted(q, Y2))).toEqual([
      0.99999999999999967, 2, 2.9999999999999996, 1.8333333333333326,
      3.333333333333333, 4.8333333333333321,
    ]);
    expect(qrFitted(q, Y2).dimnames).toEqual([null, ["y1", "y2"]]);
    expect(columnMajor(qrResid(q, Y2))).toEqual([
      9.2325774273485333e-17, -1.8465154854697077e-16, 9.232577427348542e-17,
      0.16666666666666663, -0.33333333333333343, 0.16666666666666671,
    ]);
    expect(columnMajor(qrQty(q, Y2))).toEqual([
      -3.7416573867739413, 4.8353125623274688e-16, 2.2615103707741747e-16,
      -6.1470085639857599, 0.21821789023599272, 0.40824829046386307,
    ]);
    expect(columnMajor(qrQy(q, Y2))).toEqual([
      2.7032267513671044, -2.5475764461360431, -0.44991041528965309,
      4.1253336513263754, -4.4968742015803516, -0.87163334057118458,
    ]);
  });

  test("an aliased column reads NaN in a matrix result, R's NA", () => {
    const dup = qr(cbind([1, 1, 1, 1], [1, 1, 1, 1], x));
    const coef = qrCoef(dup, matrix([2, 4, 6, 8, 1, 1, 2, 3], { nrow: 4, dimnames: [null, ["y1", "y2"]] }));
    expect(coef.dimnames).toEqual([null, ["y1", "y2"]]);
    expect(columnMajor(coef)).toEqual([
      1.3457943925233646, Number.NaN, 0.85981308411214952, 0.43925233644859796,
      Number.NaN, 0.30841121495327106,
    ]);
  });

  test("qrQ is qrQy of the identity", () => {
    expect(columnMajor(qrQ(q))).toEqual(columnMajor(qrQy(q, identity(3))).slice(0, 6));
  });

  test("tol = 0 aliases nothing, as R's does", () => {
    expect(qr(cbind([1, 1, 1, 1], [1, 1, 1, 1], x), { tolerance: 0 }).rank).toBe(3);
    expect(() => qr(X, { tolerance: -1 })).toThrow(RangeError);
  });

  test("a NaN or Inf entry is refused in R's words", () => {
    expect(() => qr(matrix([1, Number.NaN, 3, 4], { nrow: 2 }))).toThrow(
      /NA\/NaN\/Inf in foreign function call \(arg 1\)/,
    );
    expect(() => qr(matrix([1, Number.POSITIVE_INFINITY, 3, 4], { nrow: 2 }))).toThrow(RangeError);
  });

  test("a matrix y of the wrong rows, and a non-matrix, are refused", () => {
    expect(() => qrCoef(q, matrix([1, 2, 3, 4], { nrow: 2 }))).toThrow(
      /'qr' and 'y' must have the same number of rows/,
    );
    expect(() => qr([[1]] as unknown as Matrix)).toThrow(TypeError);
  });
});

/**
 * The `fma` option, plan 004 Slice 0.
 *
 * The default rounds every product through the software fused multiply-add,
 * which is what pins the fixtures above bit for bit. `{ fma: false }` takes
 * plain `a * b + c` for throughput. The decomposition carries the setting,
 * and every reader runs `dqrsl` the same way the factorization ran, so no
 * reader takes an option of its own.
 *
 * The two paths differ by a few ulps, so the tests here compare the paths to
 * each other at 1e-14 relative. They never restate R's doubles: the pins
 * above own that job, and they still run on the default.
 */

/** Agreement between the two arithmetic paths: |a − b| ≤ 1e-14 · max(1, |b|). */
function agrees(actual: readonly number[], expected: readonly number[]): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    const target = expected[index] as number;
    expect(Math.abs(value - target)).toBeLessThanOrEqual(
      1e-14 * Math.max(1, Math.abs(target)),
    );
  });
}

/** The same, for coefficients: an aliased entry is null under both paths. */
function coefficientsAgree(
  actual: readonly (number | null)[],
  expected: readonly (number | null)[],
): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    const target = expected[index] as number | null;
    if (value === null || target === null) {
      expect(value).toBe(target);
      return;
    }
    expect(Math.abs(value - target)).toBeLessThanOrEqual(
      1e-14 * Math.max(1, Math.abs(target)),
    );
  });
}

describe("qr() — the fma option", () => {
  test("the decomposition records the setting", () => {
    expect(qr(X).fma).toBe(true);
    expect(qr(X, {}).fma).toBe(true);
    expect(qr(X, { tolerance: 1e-11 }).fma).toBe(true);
    expect(qr(X, { fma: true }).fma).toBe(true);
    expect(qr(X, { fma: false }).fma).toBe(false);
  });

  test("fixture 2a — the readers follow the setting and agree at 1e-14", () => {
    const fma = qr(X);
    const plain = qr(X, { fma: false });
    expect(plain.fma).toBe(false);
    coefficientsAgree(qrCoef(plain, y), qrCoef(fma, y));
    agrees(qrFitted(plain, y), qrFitted(fma, y));
    agrees(qrResid(plain, y), qrResid(fma, y));
    agrees(qrQty(plain, y), qrQty(fma, y));
    agrees(qrQy(plain, y), qrQy(fma, y));
    agrees(columnMajor(qrQ(plain)), columnMajor(qrQ(fma)));
    agrees(columnMajor(qrR(plain)), columnMajor(qrR(fma)));
  });

  test("fixture 2e — the moderation-shaped design agrees at 1e-14", () => {
    const xx = [1, 2, 3, 4, 5, 6];
    const z = [2, 5, 1, 9, 4, 6];
    const yy = [3.1, 4.4, 2.2, 9.9, 5.5, 7.7];
    const M = matrix(
      [1, 1, 1, 1, 1, 1, ...xx, ...z, ...xx.map((v, i) => v * (z[i] as number))],
      { nrow: 6, dimnames: [null, ["(Intercept)", "xx", "z", "xx:z"]] },
    );
    const fma = qr(M);
    const plain = qr(M, { fma: false });
    expect(plain.fma).toBe(false);
    coefficientsAgree(qrCoef(plain, yy), qrCoef(fma, yy));
    agrees(qrFitted(plain, yy), qrFitted(fma, yy));
    agrees(qrResid(plain, yy), qrResid(fma, yy));
    agrees(qrQty(plain, yy), qrQty(fma, yy));
    agrees(qrQy(plain, yy), qrQy(fma, yy));
    agrees(columnMajor(qrQ(plain)), columnMajor(qrQ(fma)));
    agrees(columnMajor(qrR(plain)), columnMajor(qrR(fma)));
  });

  test("an aliased coefficient stays null under plain arithmetic", () => {
    const dup = cbind([1, 1, 1, 1], [1, 1, 1, 1], x);
    const plain = qr(dup, { fma: false });
    expect(plain.fma).toBe(false);
    const coefficients = qrCoef(plain, y);
    expect(coefficients[1]).toBeNull();
    coefficientsAgree(coefficients, qrCoef(qr(dup), y));
  });

  const fixtures: readonly {
    readonly name: string;
    readonly m: Matrix;
    readonly options: QrOptions;
  }[] = [
    { name: "2a, full rank", m: X, options: {} },
    {
      name: "2b, a duplicated column",
      m: cbind([1, 1, 1, 1], [1, 1, 1, 1], x),
      options: {},
    },
    { name: "2c, more columns than rows", m: matrix([1, 10], { nrow: 1 }), options: {} },
    {
      name: "2d, square full rank",
      m: matrix([2, 1, -1, 1, 3, 2, 1, -1, 4], { nrow: 3 }),
      options: {},
    },
    {
      name: "2e, the moderation-shaped design",
      m: matrix(
        [1, 1, 1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 2, 5, 1, 9, 4, 6, 2, 10, 3, 36, 20, 36],
        { nrow: 6 },
      ),
      options: {},
    },
    {
      name: "2f, near-collinear at tol 1e-7",
      m: cbind([1, 1, 1, 1], [1, 1, 1, 1 + 1e-8]),
      options: { tolerance: 1e-7 },
    },
    {
      name: "2f, near-collinear at tol 1e-11",
      m: cbind([1, 1, 1, 1], [1, 1, 1, 1 + 1e-8]),
      options: { tolerance: 1e-11 },
    },
    { name: "2g, an all-zero column", m: cbind(x, [0, 0, 0, 0]), options: {} },
  ];

  fixtures.forEach(({ name, m, options }) => {
    test(`rank and pivot agree exactly — fixture ${name}`, () => {
      const fma = qr(m, options);
      const plain = qr(m, { ...options, fma: false });
      expect(plain.fma).toBe(false);
      expect(plain.rank).toBe(fma.rank);
      expect(plain.pivot).toEqual(fma.pivot);
    });
  });

  test("a non-boolean fma is refused", () => {
    expect(() => qr(X, { fma: 1 } as unknown as QrOptions)).toThrow(TypeError);
    expect(() => qr(X, { fma: "yes" } as unknown as QrOptions)).toThrow(TypeError);
  });
});
