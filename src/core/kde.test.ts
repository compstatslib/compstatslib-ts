/**
 * Tests for the Gaussian kernel density estimate, R's `density()` with its
 * defaults. `plot_sampling()` in `../compstatslib/R/sampling_plot.R` calls
 * `density(population)` and `density(samples)` with no other arguments, so
 * only the default path is ported and pinned here.
 *
 * Every expected value comes from R 4.5.3 at full double precision. Source:
 * `.claude/plans/sampling-fixtures.md`, Section 1, which also quotes the
 * pipeline of `stats::density.default` verbatim. Values marked "computed in
 * session" below come from the same R 4.5.3 install; the script is in the
 * agent report for slice 4 and each call is named at its assertion.
 *
 * The R pipeline, for reference while reading the fixtures:
 *
 * ```r
 * bw   <- bw.nrd0(x)
 * from <- min(x) - 3 * bw;  to <- max(x) + 3 * bw   # cut = 3, the OUTPUT grid
 * lo   <- from - 4 * bw;    up <- to   + 4 * bw     # ext = 4, the FFT grid
 * y     <- .Call(C_BinDist, x, weights, lo, up, 512) * totMass
 * kords <- dnorm(seq.int(0, (2*512 - 1)/511 * (up - lo), length.out = 1024),
 *                sd = bw)
 * kords[514:1024] <- ...                            # mirrored negative half
 * kords <- pmax(0, Re(fft(fft(y) * Conj(fft(kords)), inverse = TRUE))[1:512]
 *                  / 1024)
 * y <- approx(seq.int(lo, up, length.out = 512), kords,
 *             seq.int(from, to, length.out = 512))$y
 * ```
 *
 * The two cushions are not the same width and must not be conflated: the
 * reported `x` grid spans `range(x) +/- 3 * bw`, the FFT runs over
 * `range(x) +/- 7 * bw`, and the result is interpolated back down.
 */

import { describe, expect, test } from "bun:test";

import { bwNrd0, kernelDensity } from "./kde";

/** Relative tolerance for all comparisons against R, as in the other slices. */
const RELATIVE_TOLERANCE = 1e-12;

/** Assert that a value agrees with R to `RELATIVE_TOLERANCE`. */
function expectCloseToR(actual: number, expected: number): void {
  const bound = RELATIVE_TOLERANCE * Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(bound);
}

/** The 1-based index of the largest value, R's `which.max`. */
function whichMax(values: readonly number[]): number {
  return values.reduce(
    (best, value, index) => (value > values[best - 1] ? index + 1 : best),
    1,
  );
}

/** Fixture A: `x_small` of Section 1a. */
const xSmall = [2.1, 4.5, 4.7, 5, 5.5, 6.1, 7.3, 8.8, 9.9, 12.4] as const;

/** Fixture B: `set.seed(42); rnorm(100, mean = 50, sd = 10)` of Section 1b. */
const xBig = [
  63.709584471466684, 44.353018286039109, 53.63128411337339,
  56.328626049610406, 54.042683231409988, 48.938754839085163,
  65.11521997438939, 49.053409615869022, 70.184237138770413,
  49.372859009475789, 63.04869654223485, 72.866453927011065,
  36.111392988876609, 47.212112331826283, 48.666786636063421,
  56.359503980700744, 47.157470785839273, 23.435445790952237,
  25.59533071424481, 63.201133457301921, 46.933614059215252,
  32.186915660199993, 48.280826442403786, 62.14674699172599,
  68.951934612649652, 45.695308683938002, 47.427306172310701,
  32.368369148052196, 54.600973548312716, 43.600051240398805,
  54.554501232412193, 57.048373372288189, 60.35103521969922,
  43.910736245927886, 55.049551232979702, 32.829913209266572,
  42.155409916205038, 41.490924058234818, 25.857923500533676,
  50.361226068922555, 52.059986002002539, 46.389427014513338,
  57.581632356995172, 42.732951729234252, 36.317189555807055,
  54.328180258887173, 41.886068238133284, 64.441012617212522,
  45.685537973866545, 56.556478834022066, 53.219252652039465,
  42.161610591196244, 65.757275197919768, 56.428993057173166,
  50.897606465996056, 52.765507472914628, 56.792888160552707,
  50.898328865790816, 20.06909916847065, 52.848829535306592,
  46.327653572590243, 51.852305648656092, 55.818237273655072,
  63.997368272926778, 42.727079405255353, 63.025426320441433,
  53.358481197520746, 60.385060986976214, 59.207285682906466,
  57.208781628668625, 39.56881061432145, 49.098136133892936,
  56.235181619995437, 40.464766422276561, 44.57171185426143,
  55.809964976816822, 57.681787378345909, 54.63767588540167,
  41.142237025903206, 39.002191013521447, 65.127070098049273,
  52.579214375320305, 50.884402291595862, 48.791034624609104,
  38.056711048394718, 56.119968980403868, 47.828601542534791,
  48.172432936680785, 59.333463285711602, 58.217731105082493,
  63.921163759342711, 45.238260769453255, 56.503485607263052,
  63.911104563900011, 38.892111205521012, 41.392074131221577,
  38.682613191462302, 35.407860004976044, 50.79982553241161, 56.5320433964919,
] as const;

describe("bwNrd0", () => {
  test("takes the IQR branch for fixture A (Section 1a)", () => {
    // min(sd = 3.0210557389392503, IQR/1.34 = 2.7238805970149254) is the IQR.
    expectCloseToR(bwNrd0(xSmall), 1.5467872213562948);
  });

  test("takes the IQR branch for fixture B (Section 1b)", () => {
    expectCloseToR(bwNrd0(xBig), 3.4178583663366515);
  });

  test("falls back to the standard deviation when the IQR is zero", () => {
    // Computed in session: bw.nrd0(c(0,5,5,5,10)); sd = 3.5355339059327378,
    // IQR/1.34 = 0, so R's `(lo <- hi)` link of the fallback chain fires.
    expectCloseToR(bwNrd0([0, 5, 5, 5, 10]), 2.3062347677367172);
  });

  test("falls back to the first value when the spread is zero (Section 1e)", () => {
    expectCloseToR(bwNrd0([5, 5, 5, 5]), 3.4103622746483957);
  });

  test("falls back to one when the first value is zero too (Section 1e)", () => {
    expectCloseToR(bwNrd0([0, 0, 0, 0]), 0.68207245492967916);
  });

  test("matches R on the two-point and pooled-matrix fixtures", () => {
    expectCloseToR(bwNrd0([3, 9]), 1.7540944185817424);
    expectCloseToR(bwNrd0([1, 5, 2, 6, 3, 7]), 1.4883541161286657);
  });

  test("rejects fewer than two values, as R does", () => {
    // R: bw.nrd0(c(4)) stops with "need at least 2 data points".
    expect(() => bwNrd0([4])).toThrow(RangeError);
  });
});

describe("kernelDensity, fixture A (Section 1a)", () => {
  const estimate = kernelDensity(xSmall);

  test("reports the bandwidth and the sample size", () => {
    expectCloseToR(estimate.bw, 1.5467872213562948);
    expect(estimate.n).toBe(10);
  });

  test("spans range(x) +/- 3 * bw on 512 points", () => {
    expect(estimate.x).toHaveLength(512);
    expect(estimate.y).toHaveLength(512);
    expectCloseToR(estimate.x[0], -2.5403616640688838);
    expectCloseToR(estimate.x[511], 17.040361664068882);
  });

  test("has an evenly spaced grid", () => {
    // R builds the grid as from + i * (to - from)/511, so consecutive
    // differences vary in the last bits: R's own d$x[2] - d$x[1] is
    // 0.038318440955259714 and d$x[512] - d$x[511] is 0.038318440955261934.
    expectCloseToR(
      estimate.x[1] - estimate.x[0],
      0.038318440955259714,
    );
    expectCloseToR(
      estimate.x[511] - estimate.x[510],
      0.038318440955261934,
    );
    expectCloseToR(estimate.x[1], -2.502043223113624);
    expectCloseToR(estimate.x[255], 7.2308407795223681);
  });

  test("matches R's aggregates", () => {
    expectCloseToR(
      estimate.y.reduce((total, value) => total + value, 0),
      26.090299609675416,
    );
    expectCloseToR(Math.max(...estimate.y), 0.13648248386323095);
    expect(whichMax(estimate.y)).toBe(207);
  });

  test("matches R index by index across the curve", () => {
    // 1-based index: value, from the 512-value dump in Section 1a.
    const pins: ReadonlyArray<readonly [number, number]> = [
      [1, 0.00028834333167947548],
      [2, 0.00031093906108863874],
      [3, 0.00033445667378602303],
      [50, 0.0054389909648881801],
      [100, 0.029381726713223092],
      [150, 0.080068828411437601],
      [200, 0.13532650467240592],
      [206, 0.1364486651650319],
      [207, 0.13648248386323095],
      [208, 0.13646248917390591],
      [256, 0.10205031700165791],
      [300, 0.073044997115587859],
      [350, 0.050062201472830609],
      [400, 0.030920761396089035],
      [450, 0.0090773112273357867],
      [500, 0.00067230549925021755],
      [510, 0.00033336623471790064],
      [511, 0.00030996479831641403],
      [512, 0.00028747766380729506],
    ];

    pins.forEach(([index, expected]) => {
      expectCloseToR(estimate.y[index - 1], expected);
    });
  });

  test("never returns a negative density", () => {
    // R clamps the real part of the inverse transform with pmax.int(0, .).
    expect(estimate.y.every((value) => value >= 0)).toBe(true);
  });
});

describe("kernelDensity, fixture B (Section 1b)", () => {
  const estimate = kernelDensity(xBig);

  test("reports the bandwidth, the size, and the window", () => {
    expectCloseToR(estimate.bw, 3.4178583663366515);
    expect(estimate.n).toBe(100);
    expectCloseToR(estimate.x[0], 9.8155240694606967);
    expectCloseToR(estimate.x[511], 83.120029026021015);
  });

  test("matches R at the pinned indices", () => {
    const pins: ReadonlyArray<readonly [number, number]> = [
      [1, 1.3519954982608646e-5],
      [2, 1.5317087961732278e-5],
      [3, 1.7349190619557444e-5],
      [64, 0.0018819974267768314],
      [128, 0.0042194666145876384],
      [200, 0.017561841906101123],
      [256, 0.032108765385745489],
      [300, 0.038016614464487682],
      [384, 0.01708792910487613],
      [448, 0.0024161589017667956],
      [510, 1.8258031484728216e-5],
      [511, 1.6096627908054219e-5],
      [512, 1.4188871820802317e-5],
    ];

    pins.forEach(([index, expected]) => {
      expectCloseToR(estimate.y[index - 1], expected);
    });
  });

  test("matches R's aggregates", () => {
    expectCloseToR(
      estimate.y.reduce((total, value) => total + value, 0),
      6.9707371787862034,
    );
    expectCloseToR(Math.max(...estimate.y), 0.038544894081131972);
    expect(whichMax(estimate.y)).toBe(310);
  });
});

describe("kernelDensity, pooled values (Section 1c)", () => {
  // R's density(matrix) flattens the matrix column by column. In this port
  // the caller flattens, so this fixture is the flattened vector R sees:
  // as.vector(matrix(c(1,5,2,6,3,7), nrow = 2)) == c(1,5,2,6,3,7).
  const estimate = kernelDensity([1, 5, 2, 6, 3, 7]);

  test("matches R on the pooled vector", () => {
    expectCloseToR(estimate.bw, 1.4883541161286657);
    expectCloseToR(estimate.x[0], -3.465062348385997);
    expectCloseToR(estimate.x[511], 11.465062348385997);
    expectCloseToR(estimate.y[0], 0.00055398163412014555);
    expectCloseToR(estimate.y[255], 0.1192425126270204);
    expectCloseToR(estimate.y[511], 0.00055398163412013785);
  });
});

describe("kernelDensity, degenerate and edge inputs", () => {
  test("draws a bump for constant data instead of failing (Section 1e)", () => {
    const estimate = kernelDensity([5, 5, 5, 5]);

    expectCloseToR(estimate.bw, 3.4103622746483957);
    expectCloseToR(estimate.x[0], -5.2310868239451871);
    expectCloseToR(estimate.x[511], 15.231086823945187);
    expectCloseToR(estimate.y[0], 0.0013004997237807713);
    expectCloseToR(Math.max(...estimate.y), 0.11695749595563784);
    expect(whichMax(estimate.y)).toBe(256);
  });

  test("matches R on two points (Section 1f)", () => {
    const estimate = kernelDensity([3, 9]);

    expectCloseToR(estimate.bw, 1.7540944185817424);
    expectCloseToR(estimate.x[0], -2.2622832557452277);
    expectCloseToR(estimate.x[511], 14.262283255745228);
    expectCloseToR(estimate.y[0], 0.0012658937655062993);
    expectCloseToR(estimate.y[255], 0.052712644741307872);
    expectCloseToR(estimate.y[511], 0.0012658937655062959);
    expectCloseToR(
      estimate.y.reduce((total, value) => total + value, 0),
      30.883073036667916,
    );
  });

  test("matches R when the standard deviation drives the bandwidth", () => {
    // Computed in session: density(c(0,5,5,5,10)).
    const estimate = kernelDensity([0, 5, 5, 5, 10]);

    expectCloseToR(estimate.bw, 2.3062347677367172);
    expectCloseToR(estimate.x[0], -6.9187043032101521);
    expectCloseToR(estimate.x[511], 16.918704303210152);
    expectCloseToR(Math.max(...estimate.y), 0.11035993615386128);
    expect(whichMax(estimate.y)).toBe(256);
    expectCloseToR(
      estimate.y.reduce((total, value) => total + value, 0),
      21.425679596549394,
    );
  });

  test("rejects a single value, as R does (Section 1f)", () => {
    // R: "need at least 2 points to select a bandwidth automatically".
    expect(() => kernelDensity([7])).toThrow(RangeError);
  });

  test("rejects no values at all", () => {
    // R: density(numeric(0)) raises the same bandwidth error.
    expect(() => kernelDensity([])).toThrow(RangeError);
  });

  test("rejects a missing value, as R does", () => {
    // R: "'x' contains missing values" (na.rm is FALSE by default).
    expect(() => kernelDensity([1, Number.NaN, 3])).toThrow(RangeError);
  });

  test("drops an infinite value and scales the mass by nx/N", () => {
    // Computed in session: density(c(x_small, Inf)) keeps the bandwidth of the
    // ten finite values, reports n = 11, and scales every density by 10/11.
    const estimate = kernelDensity([...xSmall, Number.POSITIVE_INFINITY]);

    expectCloseToR(estimate.bw, 1.5467872213562948);
    expect(estimate.n).toBe(11);
    expectCloseToR(Math.max(...estimate.y), 0.12407498533020996);
    expectCloseToR(
      estimate.y.reduce((total, value) => total + value, 0),
      23.718454190613958,
    );
  });
});

describe("kernelDensity with a frozen window", () => {
  test("leaves the default path byte-identical without from and to", () => {
    // Pinned against this port itself, captured before from/to were added.
    // Exact equality, not tolerance: the default expressions for the window
    // must not change at all. The R fixtures above check correctness; this
    // checks that adding the options moved nothing.
    const estimate = kernelDensity(xSmall);

    expect(estimate.bw).toBe(1.54678722135629476142);
    const xPins: ReadonlyArray<readonly [number, number]> = [
      [0, -2.54036166406888375136],
      [1, -2.50204322311362403752],
      [63, -0.126299883887515562719],
      [127, 2.32608033724911189566],
      [191, 4.77846055838574024222],
      [255, 7.2308407795223672565],
      [319, 9.68322100065899604715],
      [383, 12.1356012217956230614],
      [447, 14.5879814429322518521],
      [510, 17.0020432231136204848],
      [511, 17.0403616640688824191],
    ];
    const yPins: ReadonlyArray<readonly [number, number]> = [
      [0, 0.000288343331679483615669],
      [1, 0.000310939061088647201222],
      [63, 0.00980143153113149402655],
      [127, 0.0534730599687748414661],
      [191, 0.131260981185727848564],
      [255, 0.102050317001657897542],
      [319, 0.0637675619666973336752],
      [383, 0.0372251856421266791308],
      [447, 0.00977144665781293046691],
      [510, 0.000309964798316397338162],
      [511, 0.000287477663807279718369],
    ];
    xPins.forEach(([index, expected]) => {
      expect(estimate.x[index]).toBe(expected);
    });
    yPins.forEach(([index, expected]) => {
      expect(estimate.y[index]).toBe(expected);
    });
    expect(estimate.x.reduce((total, value) => total + value, 0)).toBe(
      3711.99999999999863576,
    );
    expect(estimate.y.reduce((total, value) => total + value, 0)).toBe(
      26.0902996096754158373,
    );
  });

  test("matches R on a window narrower than the data", () => {
    // Computed in session: density(x_small, from = 4, to = 8). The data run
    // from 2.1 to 12.4, so mass beyond the working window is dropped and the
    // curve no longer decays to zero at the ends.
    const estimate = kernelDensity(xSmall, { from: 4, to: 8 });

    expectCloseToR(estimate.bw, 1.5467872213562948);
    expect(estimate.x[0]).toBe(4);
    expect(estimate.x[511]).toBe(8);
    const pins: ReadonlyArray<readonly [number, number]> = [
      [1, 0.11007010520063101],
      [64, 0.12505125988733906],
      [128, 0.13443772125531486],
      [200, 0.13588767781608777],
      [256, 0.13072168244646068],
      [320, 0.12021472654678093],
      [384, 0.10773826593662918],
      [450, 0.095578624047042676],
      [512, 0.086134645349613959],
    ];
    pins.forEach(([index, expected]) => {
      expectCloseToR(estimate.y[index - 1], expected);
    });
    expectCloseToR(
      estimate.y.reduce((total, value) => total + value, 0),
      60.814878706578021,
    );
    expectCloseToR(Math.max(...estimate.y), 0.13649915276791666);
    expect(whichMax(estimate.y)).toBe(173);
  });

  test("matches R on a window wider than the data", () => {
    // Computed in session: density(x_small, from = -5, to = 20). This is the
    // case the sampling plot needs: one frozen window shared across redraws.
    const estimate = kernelDensity(xSmall, { from: -5, to: 20 });

    expectCloseToR(estimate.bw, 1.5467872213562948);
    expect(estimate.x[0]).toBe(-5);
    expect(estimate.x[511]).toBe(20);
    const pins: ReadonlyArray<readonly [number, number]> = [
      [1, 6.9337660943216496e-7],
      [64, 0.00089516824462316938],
      [128, 0.028651460406487049],
      [200, 0.13045704937974431],
      [256, 0.096438770545205874],
      [320, 0.05261575744646551],
      [384, 0.019095585130854572],
      [450, 0.00033180607283861744],
      [512, 1.4952362132121653e-7],
    ];
    pins.forEach(([index, expected]) => {
      expectCloseToR(estimate.y[index - 1], expected);
    });
    expectCloseToR(
      estimate.y.reduce((total, value) => total + value, 0),
      20.440019592649513,
    );
    expectCloseToR(Math.max(...estimate.y), 0.13646603394822107);
    expect(whichMax(estimate.y)).toBe(213);
  });

  test("matches R with only from given", () => {
    // Computed in session: density(x_small, from = 4). `to` stays at
    // max(x) + 3 * bw.
    const estimate = kernelDensity(xSmall, { from: 4 });

    expect(estimate.x[0]).toBe(4);
    expectCloseToR(estimate.x[511], 17.040361664068882);
    const pins: ReadonlyArray<readonly [number, number]> = [
      [1, 0.11006377833015872],
      [64, 0.13553973011332771],
      [128, 0.10180816540348496],
      [256, 0.053773696738718041],
      [384, 0.018655792247121359],
      [512, 0.00028768347792372057],
    ];
    pins.forEach(([index, expected]) => {
      expectCloseToR(estimate.y[index - 1], expected);
    });
    expectCloseToR(
      estimate.y.reduce((total, value) => total + value, 0),
      30.93218357421231,
    );
    expectCloseToR(Math.max(...estimate.y), 0.13648441090008043);
    expect(whichMax(estimate.y)).toBe(54);
  });

  test("matches R with only to given", () => {
    // Computed in session: density(x_small, to = 8). `from` stays at
    // min(x) - 3 * bw.
    const estimate = kernelDensity(xSmall, { to: 8 });

    expectCloseToR(estimate.x[0], -2.5403616640688838);
    expect(estimate.x[511]).toBe(8);
    const pins: ReadonlyArray<readonly [number, number]> = [
      [1, 0.00028826958075301335],
      [64, 0.0025565318158472777],
      [128, 0.011954344994664291],
      [256, 0.064993411910104978],
      [384, 0.13649628355903748],
      [512, 0.086134468732635458],
    ];
    pins.forEach(([index, expected]) => {
      expectCloseToR(estimate.y[index - 1], expected);
    });
    expectCloseToR(
      estimate.y.reduce((total, value) => total + value, 0),
      33.350590923169229,
    );
    expectCloseToR(Math.max(...estimate.y), 0.13649628355903748);
    expect(whichMax(estimate.y)).toBe(384);
  });

  test("rejects a window end that is not finite, as R does", () => {
    // R: "non-finite 'from'" and "non-finite 'to'".
    expect(() =>
      kernelDensity(xSmall, { from: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
    expect(() => kernelDensity(xSmall, { to: Number.NaN })).toThrow(RangeError);
  });
});

describe("kernelDensity with an explicit bandwidth", () => {
  test("skips bw.nrd0 and accepts a single value, as R does", () => {
    // Computed in session: density(c(7), bw = 2). R checks the count only
    // when it has to select the bandwidth itself.
    const estimate = kernelDensity([7], { bw: 2 });

    expect(estimate.bw).toBe(2);
    expectCloseToR(estimate.x[0], 1);
    expectCloseToR(estimate.x[511], 13);
    expectCloseToR(Math.max(...estimate.y), 0.19943371597222478);
    expect(whichMax(estimate.y)).toBe(256);
    expectCloseToR(
      estimate.y.reduce((total, value) => total + value, 0),
      42.470395927454632,
    );
  });

  test("narrows the curve on fixture A", () => {
    // Computed in session: density(x_small, bw = 0.5).
    const estimate = kernelDensity(xSmall, { bw: 0.5 });

    expectCloseToR(estimate.x[0], 0.60000000000000009);
    expectCloseToR(estimate.x[511], 13.9);
    expectCloseToR(estimate.y[0], 0.00089134263751810476);
    expectCloseToR(estimate.y[255], 0.085970253769910437);
    expectCloseToR(Math.max(...estimate.y), 0.25310129995207242);
    expect(whichMax(estimate.y)).toBe(166);
    expectCloseToR(
      estimate.y.reduce((total, value) => total + value, 0),
      38.411461014895416,
    );
  });

  test("rejects a bandwidth that is not positive and finite, as R does", () => {
    // R: "'bw' is not positive." and "non-finite 'bw'".
    expect(() => kernelDensity(xSmall, { bw: 0 })).toThrow(RangeError);
    expect(() => kernelDensity(xSmall, { bw: -1 })).toThrow(RangeError);
    expect(() => kernelDensity(xSmall, { bw: Number.NaN })).toThrow(RangeError);
  });
});
