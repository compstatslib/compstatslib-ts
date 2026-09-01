/**
 * Tests for the central t distribution, the numeric base of `plot_t_test()`
 * in `../compstatslib/R/t_statistic_plot.R`.
 *
 * Every expected value below comes from R 4.5.3, printed at full double
 * precision with `sprintf("%.17g", x)`. Do not edit these numbers by hand.
 * Source: `.claude/plans/001-PLAN-port/tdist-fixtures.md`, Section 1 (Central t).
 *
 * The R script that produced the values (Section 1 part only):
 *
 * ```r
 * fmt <- function(x) sprintf("%.17g", x)
 * dfs <- c(1, 2, 5, 30, 99, 300)
 * xs <- c(-3, -1.5, 0, 0.5, 2, 4)
 * ps <- c(0.001, 0.025, 0.05, 0.5, 0.95, 0.975, 0.999)
 * for (df in dfs) {
 *   for (x in xs) cat(fmt(x), fmt(dt(x, df = df)), fmt(pt(x, df = df)), "\n")
 *   for (p in ps) cat(fmt(p), fmt(qt(p, df = df)), "\n")
 * }
 * ```
 *
 * The fixture file prints probabilities as `%.17g` doubles, so `0.025`
 * appears there as `0.025000000000000001`. Both are the same double; the
 * plain literal is used below.
 *
 * The non-central values at the foot of this file come from Section 2 of the
 * same fixture file, over the five (df, ncp) pairs that cover the slider
 * ranges of `interactive_t_test()`.
 */

import { describe, expect, test } from "bun:test";

import { dt, pt, qt } from "./tdist.js";

/**
 * Relative tolerance for all comparisons against R.
 *
 * R computes these through its own incomplete-beta routines and this port
 * uses a Lentz continued fraction with a Lanczos log-beta. The two agree to a
 * few units in the last place, so 1e-12 relative is far looser than the real
 * disagreement and still catches a wrong formula.
 */
const RELATIVE_TOLERANCE = 1e-12;

/** Assert that a value agrees with R to a relative tolerance. */
function expectCloseToR(
  actual: number,
  expected: number,
  tolerance: number = RELATIVE_TOLERANCE,
): void {
  const bound = tolerance * Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(bound);
}

/** One `x` and the density and CDF that R reports there. */
interface DensityRow {
  readonly x: number;
  readonly dt: number;
  readonly pt: number;
}

/** One probability and the quantile that R reports for it. */
interface QuantileRow {
  readonly p: number;
  readonly qt: number;
}

/** All R values for one degrees-of-freedom setting. */
interface CentralFixture {
  readonly df: number;
  readonly density: readonly DensityRow[];
  readonly quantiles: readonly QuantileRow[];
}

const centralFixtures: readonly CentralFixture[] = [
  {
    df: 1,
    density: [
      { x: -3, dt: 0.031830988618379061, pt: 0.10241638234956672 },
      { x: -1.5, dt: 0.09794150344116638, pt: 0.1871670418109988 },
      { x: 0, dt: 0.31830988618379069, pt: 0.5 },
      { x: 0.5, dt: 0.2546479089470326, pt: 0.64758361765043326 },
      { x: 2, dt: 0.063661977236758149, pt: 0.85241638234956674 },
      { x: 4, dt: 0.018724110951987692, pt: 0.92202086962263063 },
    ],
    quantiles: [
      { p: 0.001, qt: -318.30883898555049 },
      { p: 0.025, qt: -12.706204736174703 },
      { p: 0.05, qt: -6.3137515146750438 },
      { p: 0.5, qt: 0 },
      { p: 0.95, qt: 6.3137515146750376 },
      { p: 0.975, qt: 12.706204736174692 },
      { p: 0.999, qt: 318.30883898555015 },
    ],
  },
  {
    df: 2,
    density: [
      { x: -3, dt: 0.027410122234342152, pt: 0.047732983133354563 },
      { x: -1.5, dt: 0.11413441178180375, pt: 0.13619656244550046 },
      { x: 0, dt: 0.35355339059327379, pt: 0.5 },
      { x: 0.5, dt: 0.29629629629629628, pt: 0.66666666666666663 },
      { x: 2, dt: 0.068041381743977156, pt: 0.90824829046386302 },
      { x: 4, dt: 0.013094570021973099, pt: 0.97140452079103168 },
    ],
    quantiles: [
      { p: 0.001, qt: -22.327124770119873 },
      { p: 0.025, qt: -4.3026527297494637 },
      { p: 0.05, qt: -2.919985580353726 },
      { p: 0.5, qt: 0 },
      { p: 0.95, qt: 2.9199855803537238 },
      { p: 0.975, qt: 4.3026527297494619 },
      { p: 0.999, qt: 22.327124770119866 },
    ],
  },
  {
    df: 5,
    density: [
      { x: -3, dt: 0.017292578800222967, pt: 0.015049623948731284 },
      { x: -1.5, dt: 0.12451734464635514, pt: 0.096951840121236574 },
      { x: 0, dt: 0.37960668982249446, pt: 0.5 },
      { x: 0.5, dt: 0.32791853132274656, pt: 0.68085056417953549 },
      { x: 2, dt: 0.065090310326216469, pt: 0.9490302605850709 },
      { x: 4, dt: 0.0051237270519179125, pt: 0.9948382922595842 },
    ],
    quantiles: [
      { p: 0.001, qt: -5.893429531356011 },
      { p: 0.025, qt: -2.570581835636315 },
      { p: 0.05, qt: -2.0150483733330233 },
      { p: 0.5, qt: 0 },
      { p: 0.95, qt: 2.0150483733330224 },
      { p: 0.975, qt: 2.5705818356363141 },
      { p: 0.999, qt: 5.8934295313560092 },
    ],
  },
  {
    df: 30,
    density: [
      { x: -3, dt: 0.0067790627460931003, pt: 0.0026949820328259705 },
      { x: -1.5, dt: 0.12896160173967175, pt: 0.072032964564323038 },
      { x: 0, dt: 0.39563218489409779, pt: 0.5 },
      { x: 0.5, dt: 0.34787857969720454, pt: 0.68963849755743634 },
      { x: 2, dt: 0.056852275047197968, pt: 0.97268747751850837 },
      { x: 4, dt: 0.00052471644019740841, pt: 0.99980907718195811 },
    ],
    quantiles: [
      { p: 0.001, qt: -3.3851848668293054 },
      { p: 0.025, qt: -2.0422724563012382 },
      { p: 0.05, qt: -1.6972608865939578 },
      { p: 0.5, qt: 0 },
      { p: 0.95, qt: 1.6972608865939571 },
      { p: 0.975, qt: 2.0422724563012378 },
      { p: 0.999, qt: 3.3851848668293054 },
    ],
  },
  {
    df: 99,
    density: [
      { x: -3, dt: 0.0051331663279579227, pt: 0.0017077539607894333 },
      { x: -1.5, dt: 0.12936640714178749, pt: 0.068398408857986703 },
      { x: 0, dt: 0.3979361384240756, pt: 0.5 },
      { x: 0.5, dt: 0.35079010900212154, pt: 0.69090767798779695 },
      { x: 2, dt: 0.05491764126614463, pt: 0.9758801533136835 },
      { x: 4, dt: 0.00022216778923046381, pt: 0.99993887423621453 },
    ],
    quantiles: [
      { p: 0.001, qt: -3.1746038497557527 },
      { p: 0.025, qt: -1.9842169515864176 },
      { p: 0.05, qt: -1.6603911560169911 },
      { p: 0.5, qt: 0 },
      { p: 0.95, qt: 1.6603911560169906 },
      { p: 0.975, qt: 1.9842169515864174 },
      { p: 0.999, qt: 3.1746038497557523 },
    ],
  },
  {
    df: 300,
    density: [
      { x: -3, dt: 0.0046617162607662443, pt: 0.0014631099320330512 },
      { x: -1.5, dt: 0.12946948039809011, pt: 0.067333016574630894 },
      { x: 0, dt: 0.39860996759938377, pt: 0.5 },
      { x: 0.5, dt: 0.35164388573792571, pt: 0.69127918872288729 },
      { x: 2, dt: 0.054302854146502294, pt: 0.97679923950842551 },
      { x: 4, dt: 0.00016009989815958585, pt: 0.99996007997758141 },
    ],
    quantiles: [
      { p: 0.001, qt: -3.1176195538115192 },
      { p: 0.025, qt: -1.9679030112610865 },
      { p: 0.05, qt: -1.6499486739376334 },
      { p: 0.5, qt: 0 },
      { p: 0.95, qt: 1.6499486739376328 },
      { p: 0.975, qt: 1.9679030112610858 },
      { p: 0.999, qt: 3.1176195538115192 },
    ],
  },
];

describe("dt", () => {
  for (const fixture of centralFixtures) {
    describe(`df = ${fixture.df}`, () => {
      for (const row of fixture.density) {
        test(`matches the R density at x = ${row.x}`, () => {
          expectCloseToR(dt(row.x, fixture.df), row.dt);
        });
      }
    });
  }

  test("is symmetric about zero", () => {
    for (const fixture of centralFixtures) {
      for (const row of fixture.density) {
        expectCloseToR(dt(-row.x, fixture.df), dt(row.x, fixture.df));
      }
    }
  });

  test("goes to zero in both tails", () => {
    expect(dt(Number.POSITIVE_INFINITY, 5)).toBe(0);
    expect(dt(Number.NEGATIVE_INFINITY, 5)).toBe(0);
  });

  test("reports NaN for degrees of freedom of zero or less", () => {
    expect(dt(1, 0)).toBeNaN();
    expect(dt(1, -3)).toBeNaN();
  });

  test("reports NaN for a NaN input", () => {
    expect(dt(Number.NaN, 5)).toBeNaN();
    expect(dt(1, Number.NaN)).toBeNaN();
  });
});

describe("pt", () => {
  for (const fixture of centralFixtures) {
    describe(`df = ${fixture.df}`, () => {
      for (const row of fixture.density) {
        test(`matches the R probability at x = ${row.x}`, () => {
          expectCloseToR(pt(row.x, fixture.df), row.pt);
        });
      }
    });
  }

  test("is exactly one half at zero", () => {
    for (const fixture of centralFixtures) {
      expect(pt(0, fixture.df)).toBe(0.5);
    }
  });

  test("reflects about zero", () => {
    for (const fixture of centralFixtures) {
      for (const row of fixture.density) {
        expectCloseToR(pt(-row.x, fixture.df), 1 - pt(row.x, fixture.df));
      }
    }
  });

  test("saturates in both tails", () => {
    expect(pt(Number.POSITIVE_INFINITY, 5)).toBe(1);
    expect(pt(Number.NEGATIVE_INFINITY, 5)).toBe(0);
  });

  /**
   * A far tail must survive as a number, not collapse to zero.
   *
   * The mass above t = 20 at df = 499 is about 4e-66, which a double holds
   * with room to spare. An earlier draft built the tail as ½ − something and
   * returned a flat 0 here, since the two halves agree to every bit they
   * have. The round trip below is the test with teeth: a zero would send the
   * quantile back as −Infinity.
   */
  test("keeps a far tail that cancellation would flatten to zero", () => {
    for (const [x, df] of [
      [-20, 499],
      [-10, 99],
      [-40, 5000],
    ] as const) {
      const tail = pt(x, df);
      expect(tail).toBeGreaterThan(0);
      expectCloseToR(qt(tail, df), x);
    }
  });

  test("reports NaN for degrees of freedom of zero or less", () => {
    expect(pt(1, 0)).toBeNaN();
    expect(pt(1, -3)).toBeNaN();
  });

  test("reports NaN for a NaN input", () => {
    expect(pt(Number.NaN, 5)).toBeNaN();
    expect(pt(1, Number.NaN)).toBeNaN();
  });
});

describe("qt", () => {
  for (const fixture of centralFixtures) {
    describe(`df = ${fixture.df}`, () => {
      for (const row of fixture.quantiles) {
        test(`matches the R quantile at p = ${row.p}`, () => {
          expectCloseToR(qt(row.p, fixture.df), row.qt);
        });
      }
    });
  }

  test("is exactly zero at one half", () => {
    for (const fixture of centralFixtures) {
      expect(qt(0.5, fixture.df)).toBe(0);
    }
  });

  test("inverts pt", () => {
    for (const fixture of centralFixtures) {
      for (const row of fixture.quantiles) {
        expectCloseToR(pt(qt(row.p, fixture.df), fixture.df), row.p);
      }
    }
  });

  test("is inverted by pt", () => {
    for (const fixture of centralFixtures) {
      for (const row of fixture.density) {
        expectCloseToR(qt(pt(row.x, fixture.df), fixture.df), row.x);
      }
    }
  });

  test("reports infinity at the ends of the probability range", () => {
    expect(qt(0, 5)).toBe(Number.NEGATIVE_INFINITY);
    expect(qt(1, 5)).toBe(Number.POSITIVE_INFINITY);
  });

  test("reports NaN for a probability outside zero to one", () => {
    expect(qt(-0.1, 5)).toBeNaN();
    expect(qt(1.1, 5)).toBeNaN();
  });

  test("reports NaN for degrees of freedom of zero or less", () => {
    expect(qt(0.5, 0)).toBeNaN();
    expect(qt(0.5, -3)).toBeNaN();
  });

  test("reports NaN for a NaN input", () => {
    expect(qt(Number.NaN, 5)).toBeNaN();
    expect(qt(0.5, Number.NaN)).toBeNaN();
  });
});

/**
 * Non-central values, from Section 2 of the fixture file.
 *
 * The R script that produced them:
 *
 * ```r
 * fmt <- function(x) sprintf("%.17g", x)
 * combos <- list(c(99, 1.25), c(99, 0.25), c(9, 2.5),
 *                c(499, 4 / (5 / sqrt(500))), c(4, 0.5))
 * for (combo in combos) {
 *   df <- combo[1]; ncp <- combo[2]
 *   for (x in c(-2, 0, 1, 1.66, 3))
 *     cat(fmt(dt(x, df, ncp)), fmt(pt(x, df, ncp)), "\n")
 *   for (p in c(0.025, 0.5, 0.975)) cat(fmt(qt(p, df, ncp)), "\n")
 * }
 * ```
 */

/** One `x` and the non-central density and CDF that R reports there. */
interface NonCentralDensityRow {
  readonly x: number;
  readonly dt: number;
  readonly pt: number;
}

/** All R values for one degrees-of-freedom and non-centrality pair. */
interface NonCentralFixture {
  readonly df: number;
  readonly ncp: number;
  readonly density: readonly NonCentralDensityRow[];
  readonly quantiles: readonly QuantileRow[];
}

const nonCentralFixtures: readonly NonCentralFixture[] = [
  {
    df: 99,
    ncp: 1.25,
    density: [
      { x: -2, dt: 0.0021868918950874159, pt: 0.00065665276346293933 },
      { x: 0, dt: 0.18218844002510645, pt: 0.10564977366685524 },
      { x: 1, dt: 0.38502500972029596, pt: 0.40056214987372823 },
      { x: 1.66, dt: 0.36314970655203799, pt: 0.65652946135564139 },
      { x: 3, dt: 0.088816171278251976, pt: 0.95584990505478706 },
    ],
    quantiles: [
      { p: 0.025, qt: -0.71427813692597653 },
      { p: 0.5, qt: 1.2531688434650867 },
      { p: 0.975, qt: 3.2699026137470177 },
    ],
  },
  {
    df: 99,
    ncp: 0.25,
    density: [
      { x: -2, dt: 0.03258183313704275, pt: 0.013114516834202172 },
      { x: 0, dt: 0.38569293055978765, pt: 0.4012936743170763 },
      { x: 1, dt: 0.29948264137699054, pt: 0.77204557986735001 },
      { x: 1.66, dt: 0.14739861988765721, pt: 0.9186690009766757 },
      { x: 3, dt: 0.010233421371307, pt: 0.99635141021644258 },
    ],
    quantiles: [
      { p: 0.025, qt: -1.728965479074617 },
      { p: 0.5, qt: 0.25063216739975047 },
      { p: 0.975, qt: 2.2400994748503109 },
    ],
  },
  {
    df: 9,
    ncp: 2.5,
    density: [
      { x: -2, dt: 5.802832058166013e-5, pt: 2.2494545289020174e-5 },
      { x: 0, dt: 0.017049064034659441, pt: 0.0062096653257761349 },
      { x: 1, dt: 0.13516434307159372, pt: 0.068486444778600594 },
      { x: 1.66, dt: 0.27434369367103123, pt: 0.2041917222048627 },
      { x: 3, dt: 0.28650209015378081, pt: 0.63152150852784961 },
    ],
    quantiles: [
      { p: 0.025, qt: 0.53923925219580227 },
      { p: 0.5, qt: 2.5771331495085192 },
      { p: 0.975, qt: 5.8593123877582443 },
    ],
  },
  {
    // diff = 4, sd = 5, n = 500: the far corner of the slider ranges. R warns
    // here that its own `pnt` may not have reached full precision.
    df: 499,
    ncp: 17.888543819998318,
    density: [
      { x: -2, dt: 0, pt: 0 },
      { x: 0, dt: 1.2988989898179087e-70, pt: 7.2422121863683586e-72 },
      { x: 1, dt: 4.7656903742299209e-63, pt: 2.9047971734396646e-64 },
      { x: 1.66, dt: 2.1173785602593672e-58, pt: 1.7850903366806419e-59 },
      { x: 3, dt: 3.1930378979872244e-49, pt: 2.315748746330592e-50 },
    ],
    quantiles: [
      { p: 0.025, qt: 15.706210023042825 },
      { p: 0.5, qt: 17.898235452965729 },
      { p: 0.975, qt: 20.222857328348272 },
    ],
  },
  {
    df: 4,
    ncp: 0.5,
    density: [
      { x: -2, dt: 0.028375346725039378, pt: 0.022585944070053543 },
      { x: 0, dt: 0.33093633846922327, pt: 0.30853753872598694 },
      { x: 1, dt: 0.30854638695033376, pt: 0.66076051402523839 },
      { x: 1.66, dt: 0.18053416745281595, pt: 0.82162866488652808 },
      { x: 3, dt: 0.043937995121669765, pt: 0.9523202603766574 },
    ],
    quantiles: [
      { p: 0.025, qt: -1.9197064295964594 },
      { p: 0.5, qt: 0.5323411137469094 },
      { p: 0.975, qt: 3.7374836216268079 },
    ],
  },
];

describe("dt with a non-centrality parameter", () => {
  for (const fixture of nonCentralFixtures) {
    describe(`df = ${fixture.df}, ncp = ${fixture.ncp}`, () => {
      for (const row of fixture.density) {
        test(`matches the R density at x = ${row.x}`, () => {
          expectCloseToR(dt(row.x, fixture.df, fixture.ncp), row.dt);
        });
      }
    });
  }

  test("reduces to the central density when ncp is zero", () => {
    for (const fixture of centralFixtures) {
      for (const row of fixture.density) {
        expect(dt(row.x, fixture.df, 0)).toBe(dt(row.x, fixture.df));
      }
    }
  });

  test("mirrors when both the value and the ncp change sign", () => {
    for (const fixture of nonCentralFixtures) {
      for (const row of fixture.density) {
        expectCloseToR(
          dt(-row.x, fixture.df, -fixture.ncp),
          dt(row.x, fixture.df, fixture.ncp),
        );
      }
    }
  });

  test("goes to zero in both tails", () => {
    expect(dt(Number.POSITIVE_INFINITY, 5, 1.5)).toBe(0);
    expect(dt(Number.NEGATIVE_INFINITY, 5, 1.5)).toBe(0);
  });

  test("reports NaN for a bad argument", () => {
    expect(dt(1, 0, 1.5)).toBeNaN();
    expect(dt(1, 5, Number.NaN)).toBeNaN();
  });
});

describe("pt with a non-centrality parameter", () => {
  for (const fixture of nonCentralFixtures) {
    describe(`df = ${fixture.df}, ncp = ${fixture.ncp}`, () => {
      for (const row of fixture.density) {
        test(`matches the R probability at x = ${row.x}`, () => {
          expectCloseToR(pt(row.x, fixture.df, fixture.ncp), row.pt);
        });
      }
    });
  }

  test("reduces to the central probability when ncp is zero", () => {
    for (const fixture of centralFixtures) {
      for (const row of fixture.density) {
        expect(pt(row.x, fixture.df, 0)).toBe(pt(row.x, fixture.df));
      }
    }
  });

  test("mirrors when both the value and the ncp change sign", () => {
    for (const fixture of nonCentralFixtures) {
      for (const row of fixture.density) {
        expectCloseToR(
          pt(-row.x, fixture.df, -fixture.ncp),
          1 - pt(row.x, fixture.df, fixture.ncp),
        );
      }
    }
  });

  /**
   * At x = 0 the distribution reduces to the standard normal at −ncp, since
   * P(T < 0) is P(Z < −ncp) whatever the degrees of freedom.
   *
   * The last pair reaches 7e-72, so this doubles as the check that the normal
   * tail survives that far out. The blanket tolerance would wave any tiny
   * number through, so this asserts a relative agreement instead.
   */
  test("gives the normal probability at −ncp when x is zero", () => {
    for (const fixture of nonCentralFixtures) {
      const row = fixture.density.find((candidate) => candidate.x === 0);
      expect(row).toBeDefined();
      const actual = pt(0, fixture.df, fixture.ncp);
      expect(Math.abs(actual - (row as NonCentralDensityRow).pt)).toBeLessThanOrEqual(
        1e-12 * (row as NonCentralDensityRow).pt,
      );
    }
  });

  test("saturates in both tails", () => {
    expect(pt(Number.POSITIVE_INFINITY, 5, 1.5)).toBe(1);
    expect(pt(Number.NEGATIVE_INFINITY, 5, 1.5)).toBe(0);
  });

  test("reports NaN for a bad argument", () => {
    expect(pt(1, 0, 1.5)).toBeNaN();
    expect(pt(1, 5, Number.NaN)).toBeNaN();
  });
});

describe("qt with a non-centrality parameter", () => {
  for (const fixture of nonCentralFixtures) {
    describe(`df = ${fixture.df}, ncp = ${fixture.ncp}`, () => {
      for (const row of fixture.quantiles) {
        test(`matches the R quantile at p = ${row.p}`, () => {
          expectCloseToR(qt(row.p, fixture.df, fixture.ncp), row.qt);
        });
      }
    });
  }

  test("reduces to the central quantile when ncp is zero", () => {
    for (const fixture of centralFixtures) {
      for (const row of fixture.quantiles) {
        expect(qt(row.p, fixture.df, 0)).toBe(qt(row.p, fixture.df));
      }
    }
  });

  test("inverts pt", () => {
    for (const fixture of nonCentralFixtures) {
      for (const row of fixture.quantiles) {
        expectCloseToR(
          pt(qt(row.p, fixture.df, fixture.ncp), fixture.df, fixture.ncp),
          row.p,
        );
      }
    }
  });

  test("reports infinity at the ends of the probability range", () => {
    expect(qt(0, 5, 1.5)).toBe(Number.NEGATIVE_INFINITY);
    expect(qt(1, 5, 1.5)).toBe(Number.POSITIVE_INFINITY);
  });

  test("reports NaN for a bad argument", () => {
    expect(qt(-0.1, 5, 1.5)).toBeNaN();
    expect(qt(0.5, 0, 1.5)).toBeNaN();
    expect(qt(0.5, 5, Number.NaN)).toBeNaN();
  });
});
