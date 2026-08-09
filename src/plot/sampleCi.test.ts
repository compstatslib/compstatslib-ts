/**
 * Tests for the confidence-interval plot, ported from `plot_sample_ci()` in
 * `../compstatslib/R/sample_ci_plot.R`.
 *
 * Structural checks, as in the other plot tests: the test counts the shapes
 * that reach the context and reads their colors and order. The arithmetic
 * behind the picture is already pinned against R in `src/core/sampling.test.ts`.
 *
 * The order matters more here than in any other plot in the port, because it
 * is what makes a bad row read as red. R draws every row in the good colors
 * first and then draws the bad ones again over the top:
 *
 * ```r
 * segments_ci(..., good = TRUE)   # all rows, skyblue
 * bad <- which(...)
 * segments_ci(...[bad], bad, good = FALSE)   # the misses again, coral
 * abline(v = mean(population_data))          # and the true mean, last
 * ```
 *
 * Within one of those calls R draws in three vectorised passes — every 99%
 * span, then every 95% span, then every point — rather than finishing one row
 * at a time. The tests pin that too.
 */

import { describe, expect, test } from "bun:test";

import { seededRng } from "../core/rng";
import { RecordingContext } from "../../test/recording-context";
import { plotSampleCi, sampleCiScale } from "./sampleCi";
import type { RenderTarget } from "./target";

const WIDTH = 600;
const HEIGHT = 500;

/**
 * R's palette names, resolved with `col2rgb()`. Two of the six happen to
 * match CSS names; the other four have no CSS equivalent at all.
 */
const GOOD_99 = "#87cefa"; // lightskyblue
const GOOD_95 = "#6ca6cd"; // skyblue3
const GOOD_POINT = "#4a708b"; // skyblue4
const BAD_99 = "#f08080"; // lightcoral
const BAD_95 = "#cd5b45"; // coral3
const BAD_POINT = "#8b3e2f"; // coral4
const BACKGROUND = "#ffffff";

function makeTarget(
  width = WIDTH,
  height = HEIGHT,
): { ctx: RecordingContext; target: RenderTarget } {
  const ctx = new RecordingContext();
  return { ctx, target: { ctx, width, height } };
}

/** Return the index of every stroke drawn in one color. */
function strokeIndices(ctx: RecordingContext, color: string): number[] {
  return ctx.calls
    .map((call, index) => ({ call, index }))
    .filter(
      ({ call }) => call.method === "stroke" && call.style.strokeStyle === color,
    )
    .map(({ index }) => index);
}

/** Return the index of every fill drawn in one color. */
function fillIndices(ctx: RecordingContext, color: string): number[] {
  return ctx.calls
    .map((call, index) => ({ call, index }))
    .filter(
      ({ call }) => call.method === "fill" && call.style.fillStyle === color,
    )
    .map(({ index }) => index);
}

/** A small simulation whose samples are too small to cover the mean often. */
const restless = { popSize: 400, numSamples: 40, sampleSize: 4 } as const;

describe("plotSampleCi", () => {
  test("returns the simulation it drew", () => {
    const { target } = makeTarget();
    const result = plotSampleCi(target, {
      rng: seededRng(1),
      popSize: 500,
      numSamples: 12,
      sampleSize: 20,
    });

    expect(result.intervals).toHaveLength(12);
    expect(Number.isFinite(result.populationMean)).toBe(true);
    expect(Number.isFinite(result.populationSd)).toBe(true);
  });

  test("takes R's defaults when asked for nothing", () => {
    const { target } = makeTarget();
    const result = plotSampleCi(target, { rng: seededRng(2) });

    // R: num_samples = 100, sample_size = 100, pop_size = 10000.
    expect(result.intervals).toHaveLength(100);
  });

  test("draws one row per sample, in three passes", () => {
    const { ctx, target } = makeTarget();
    const result = plotSampleCi(target, { rng: seededRng(3), ...restless });
    const count = result.intervals.length;

    expect(count).toBe(restless.numSamples);
    expect(strokeIndices(ctx, GOOD_99)).toHaveLength(count);
    expect(strokeIndices(ctx, GOOD_95)).toHaveLength(count);
    expect(fillIndices(ctx, GOOD_POINT)).toHaveLength(count);

    // Every 99% span before every 95% span, and every point after those.
    const spans99 = strokeIndices(ctx, GOOD_99);
    const spans95 = strokeIndices(ctx, GOOD_95);
    const points = fillIndices(ctx, GOOD_POINT);
    expect(Math.max(...spans99)).toBeLessThan(Math.min(...spans95));
    expect(Math.max(...spans95)).toBeLessThan(Math.min(...points));
  });

  test("draws the rows that miss the mean again, over the good ones", () => {
    const { ctx, target } = makeTarget();
    const result = plotSampleCi(target, { rng: seededRng(4), ...restless });
    const missed = result.intervals.filter(
      (interval) => interval.excludesPopulationMean,
    ).length;

    expect(missed).toBeGreaterThan(0);
    expect(strokeIndices(ctx, BAD_99)).toHaveLength(missed);
    expect(strokeIndices(ctx, BAD_95)).toHaveLength(missed);
    expect(fillIndices(ctx, BAD_POINT)).toHaveLength(missed);
    // The coral pass comes after every skyblue mark.
    expect(Math.min(...strokeIndices(ctx, BAD_99))).toBeGreaterThan(
      Math.max(...fillIndices(ctx, GOOD_POINT)),
    );
  });

  test("draws the population mean last, down the whole panel", () => {
    const { ctx, target } = makeTarget();
    const result = plotSampleCi(target, { rng: seededRng(5), ...restless });
    const scale = sampleCiScale(WIDTH, HEIGHT, result);

    const colored = [
      ...strokeIndices(ctx, GOOD_99),
      ...strokeIndices(ctx, BAD_99),
      ...fillIndices(ctx, GOOD_POINT),
      ...fillIndices(ctx, BAD_POINT),
    ];
    const lastStroke = ctx.calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.method === "stroke")
      .map(({ index }) => index)
      .pop() as number;

    expect(lastStroke).toBeGreaterThan(Math.max(...colored));
    // The line runs at the mean, from the foot of the panel to its head.
    const at = scale.toPixelX(result.populationMean);
    const verticals = ctx
      .callsTo("moveTo")
      .filter((call) => Math.abs((call.args[0] as number) - at) < 1e-9);
    expect(verticals.length).toBeGreaterThan(0);
  });

  test("labels both axes as R does", () => {
    const { ctx, target } = makeTarget();
    plotSampleCi(target, { rng: seededRng(6), popSize: 200, numSamples: 5, sampleSize: 10 });

    expect(ctx.texts()).toContain("Confidence Intervals");
    expect(ctx.texts()).toContain("Samples");
  });

  test("clips the rows to the plot area", () => {
    // The window is only one standard deviation wide, so a wide interval runs
    // off both ends. R's device clips it.
    const { ctx, target } = makeTarget();
    plotSampleCi(target, { rng: seededRng(7), ...restless });

    expect(ctx.callsTo("clip").length).toBeGreaterThan(0);
  });

  test("paints the background before anything else", () => {
    const { ctx, target } = makeTarget();
    plotSampleCi(target, { rng: seededRng(8), popSize: 100, numSamples: 3, sampleSize: 5 });
    const first = ctx.calls.find((call) => call.method === "fillRect");

    expect(first?.style.fillStyle).toBe(BACKGROUND);
    expect(first?.args).toEqual([0, 0, WIDTH, HEIGHT]);
  });

  test("gives the same picture for the same seed", () => {
    const { target: a } = makeTarget();
    const { target: b } = makeTarget();
    const options = { popSize: 300, numSamples: 8, sampleSize: 12 };

    expect(plotSampleCi(a, { rng: seededRng(9), ...options })).toEqual(
      plotSampleCi(b, { rng: seededRng(9), ...options }),
    );
  });

  test("draws the population it is given", () => {
    const { target } = makeTarget();
    const population = [2, 4, 4, 4, 5, 5, 7, 9];
    const result = plotSampleCi(target, {
      rng: seededRng(10),
      popSize: population.length,
      numSamples: 2,
      sampleSize: 4,
      distribution: () => [...population],
    });

    expect(result.populationMean).toBe(5);
  });
});

describe("plotSampleCi guards", () => {
  test("draws the frame and the mean line with no samples at all", () => {
    const { ctx, target } = makeTarget();
    const result = plotSampleCi(target, {
      rng: seededRng(11),
      popSize: 200,
      numSamples: 0,
    });

    // R breaks here: replicate(0, ...) gives it nothing to apply over.
    expect(result.intervals).toEqual([]);
    expect(strokeIndices(ctx, GOOD_99)).toHaveLength(0);
    expect(ctx.texts()).toContain("Confidence Intervals");
    expect(ctx.callsTo("stroke").length).toBeGreaterThan(0);
  });

  test("refuses a sample larger than the population", () => {
    const { target } = makeTarget();

    expect(() =>
      plotSampleCi(target, { rng: seededRng(12), popSize: 10, sampleSize: 50 }),
    ).toThrow(RangeError);
  });

  test("draws no row it cannot measure", () => {
    // A population of one has no spread, so every bound is NaN. R's plot()
    // stops on the non-finite window; this draws the frame and no rows.
    const { ctx, target } = makeTarget();
    const result = plotSampleCi(target, {
      rng: seededRng(13),
      popSize: 1,
      numSamples: 1,
      sampleSize: 1,
    });

    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0]?.sd).toBeNaN();
    expect(strokeIndices(ctx, GOOD_99)).toHaveLength(0);
    expect(fillIndices(ctx, GOOD_POINT)).toHaveLength(0);
    expect(ctx.texts()).toContain("Samples");
  });
});

describe("sampleCiScale", () => {
  const simulation = {
    populationMean: 50,
    populationSd: 10,
    intervals: new Array(20).fill({
      mean: 50,
      sd: 1,
      standardError: 0.5,
      ci95: { low: 49, high: 51 },
      ci99: { low: 48, high: 52 },
      excludesPopulationMean: false,
    }),
  };

  test("opens the window half a standard deviation each side of the mean", () => {
    // R: xlim = c(pop_mean - pop_sd/2, pop_mean + pop_sd/2).
    const scale = sampleCiScale(WIDTH, HEIGHT, simulation);

    expect(scale.world.x.min).toBe(45);
    expect(scale.world.x.max).toBe(55);
  });

  test("puts the first sample at the foot and the last at the head", () => {
    // R: ylim = c(1, num_samples), so row 1 is at the bottom.
    const scale = sampleCiScale(WIDTH, HEIGHT, simulation);

    expect(scale.toPixelY(1)).toBe(scale.area.bottom);
    expect(scale.toPixelY(20)).toBe(scale.area.top);
  });

  test("keeps a usable window when the population has no spread", () => {
    const scale = sampleCiScale(WIDTH, HEIGHT, {
      populationMean: 7,
      populationSd: Number.NaN,
      intervals: [],
    });

    expect(Number.isFinite(scale.world.x.min)).toBe(true);
    expect(Number.isFinite(scale.world.x.max)).toBe(true);
    expect(scale.world.x.min).toBeLessThan(scale.world.x.max);
  });
});
