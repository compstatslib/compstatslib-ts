/**
 * Tests for the three-panel sampling plot, ported from `plot_sampling()` in
 * `../compstatslib/R/sampling_plot.R`.
 *
 * These are structural checks, as in the other plot tests: the test counts the
 * shapes that reach the context and reads their colors, dash patterns and
 * text. It does not compare pixels with base R.
 *
 * What it does check closely is the state the function hands back, because
 * that is where the port replaces an R idiom rather than redrawing it. R's
 * `plot_sampling()` returns a `vars` list and its gadget feeds that back on
 * the next call, so the window stays put and the statistics pile up. Here the
 * caller holds that state, and these tests pin what the first call freezes,
 * what later calls accumulate, and that a later call cannot move the window.
 *
 * Two drawing details from the R source that the tests rely on:
 *
 * - The pooled curve is stroked twice. R calls `plot(samd, ...)`, then draws
 *   one translucent curve per sample, then calls `lines(samd, ...)` again to
 *   put the pooled curve back on top. Unlike the double-stroked alt curve of
 *   the t-test plot, this one is deliberate and is kept.
 * - The window comes from the population and every panel shares it, so the
 *   histogram's bars can fall outside it. R's device clips them; canvas has to
 *   be told to.
 */

import { describe, expect, test } from "bun:test";

import { mean, sd } from "../core/arith.js";
import { histogram } from "../core/histogram.js";
import { seededRng, type Rng } from "../core/rng.js";
import { RecordingContext } from "../../test/recording-context.js";
import type { DrawStyle } from "../../test/recording-context.js";
import { plotSampling, samplingScale } from "./sampling.js";
import type { SamplingPanel, SamplingState } from "./sampling.js";
import type { Extent } from "./axes.js";
import type { RenderTarget } from "./target.js";

const WIDTH = 600;
const HEIGHT = 600;

/** R: `rgb(0.7, 0.7, 0.7, 0.5)` on each sample's own curve. */
const SAMPLE_CURVE_COLOR = "rgba(179, 179, 179, 0.5)";
/** R's `hist()` default fill, with `border = FALSE`. */
const BAR_COLOR = "lightgray";
const BACKGROUND = "#ffffff";

function makeTarget(
  width = WIDTH,
  height = HEIGHT,
): { ctx: RecordingContext; target: RenderTarget } {
  const ctx = new RecordingContext();
  return { ctx, target: { ctx, width, height } };
}

/** A population wide enough for a density and a few distinct samples. */
const population = Array.from({ length: 200 }, (_unused, index) => index / 4);

/** Return every stroke drawn in one color. */
function strokesIn(ctx: RecordingContext, color: string) {
  return ctx
    .callsTo("stroke")
    .filter((call) => call.style.strokeStyle === color);
}

/** Return every filled rectangle drawn in one color. */
function barsIn(ctx: RecordingContext, color: string) {
  return ctx
    .callsTo("fillRect")
    .filter((call) => call.style.fillStyle === color);
}

/** A generator that counts how many values were taken from it. */
function countingRng(source: Rng): { rng: Rng; taken: () => number } {
  let taken = 0;
  return {
    rng: () => {
      taken += 1;
      return source();
    },
    taken: () => taken,
  };
}

describe("plotSampling state", () => {
  test("freezes the window on the range of the first population", () => {
    const { target } = makeTarget();
    const result = plotSampling(target, population, { rng: seededRng(1) });

    expect(result.state.xMin).toBe(0);
    expect(result.state.xMax).toBe(49.75);
  });

  test("keeps the frozen window when a later population is wider", () => {
    // R reads xmin/xmax from `vars` whenever it has them, and only falls back
    // to range(population) on the first call. A wider population later must
    // not move the window.
    const { target } = makeTarget();
    const first = plotSampling(target, population, { rng: seededRng(1) });
    const second = plotSampling(target, [-500, ...population, 500], {
      rng: seededRng(2),
      state: first.state,
    });

    expect(second.state.xMin).toBe(first.state.xMin);
    expect(second.state.xMax).toBe(first.state.xMax);
  });

  test("accumulates one statistic per sample across calls", () => {
    const { target } = makeTarget();
    const rng = seededRng(3);

    const first = plotSampling(target, population, { rng, reps: 2 });
    expect(first.state.sampleTheta).toHaveLength(2);

    const second = plotSampling(target, population, {
      rng,
      reps: 3,
      state: first.state,
    });
    expect(second.state.sampleTheta).toHaveLength(5);
    // The earlier statistics keep their places at the front.
    expect(second.state.sampleTheta.slice(0, 2)).toEqual([
      ...first.state.sampleTheta,
    ]);
  });

  test("returns this draw's samples and statistics as well as the state", () => {
    const { target } = makeTarget();
    const result = plotSampling(target, population, {
      rng: seededRng(4),
      sampleSize: 8,
      reps: 3,
    });

    expect(result.samples).toHaveLength(3);
    result.samples.forEach((sample) => expect(sample).toHaveLength(8));
    expect(result.thetas).toHaveLength(3);
    expect(result.thetas).toEqual(result.samples.map((s) => mean(s)));
    // This draw's statistics are the tail of the accumulated ones.
    expect(result.state.sampleTheta).toEqual([...result.thetas]);
  });

  test("does not modify the state it was given", () => {
    const { target } = makeTarget();
    const first = plotSampling(target, population, { rng: seededRng(5) });
    const held: SamplingState = {
      xMin: first.state.xMin,
      xMax: first.state.xMax,
      sampleTheta: [...first.state.sampleTheta],
    };

    plotSampling(target, population, { rng: seededRng(6), state: first.state });

    expect(first.state).toEqual(held);
  });

  test("takes the sample size and repetition count from R's defaults", () => {
    // R's interactive_sampling() defaults sample_size = 10, theta = mean, and
    // plot_sampling() defaults reps = 1.
    const { target } = makeTarget();
    const result = plotSampling(target, population, { rng: seededRng(7) });

    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]).toHaveLength(10);
    expect(result.thetas[0]).toBe(mean(result.samples[0] as number[]));
  });

  test("takes any statistic as theta", () => {
    const { target } = makeTarget();
    const result = plotSampling(target, population, {
      rng: seededRng(8),
      reps: 2,
      theta: (sample) => Math.max(...sample),
    });

    expect(result.thetas).toEqual(
      result.samples.map((sample) => Math.max(...sample)),
    );
  });
});

describe("plotSampling and the generator", () => {
  test("draws the same picture twice for one seed", () => {
    const { target: a } = makeTarget();
    const { target: b } = makeTarget();

    expect(
      plotSampling(a, population, { rng: seededRng(9), reps: 3 }).thetas,
    ).toEqual(plotSampling(b, population, { rng: seededRng(9), reps: 3 }).thetas);
  });

  test("carries on down one stream across calls", () => {
    const { target } = makeTarget();
    const rng = seededRng(10);
    const first = plotSampling(target, population, { rng });
    const second = plotSampling(target, population, { rng, state: first.state });

    expect(second.thetas).not.toEqual([...first.thetas]);
  });

  test("takes exactly reps times sampleSize values from the generator", () => {
    const { target } = makeTarget();
    const { rng, taken } = countingRng(seededRng(11));
    plotSampling(target, population, { rng, sampleSize: 6, reps: 4 });

    expect(taken()).toBe(24);
  });
});

describe("plotSampling drawing", () => {
  test("draws three panels sharing one window", () => {
    const { ctx, target } = makeTarget();
    plotSampling(target, population, { rng: seededRng(12) });

    // Each panel labels the same x ticks, so every tick label appears three
    // times over.
    const labels = ctx.texts().filter((text) => /^-?\d/.test(text));
    const counts = new Map<string, number>();
    labels.forEach((text) => counts.set(text, (counts.get(text) ?? 0) + 1));
    expect(counts.size).toBeGreaterThan(1);
    counts.forEach((count) => expect(count).toBe(3));
  });

  test("labels each panel where R does", () => {
    const { ctx, target } = makeTarget();
    plotSampling(target, population, { rng: seededRng(13), reps: 2 });
    const texts = ctx.texts();

    expect(texts).toContain("Population Distribution");
    expect(texts).toContain("Sample Distribution");
    // R: paste("Sampling Statistic", "\n(", length(sample_theta), ")"),
    // which joins with single spaces and breaks the line inside.
    expect(texts).toContain("Sampling Statistic ");
    expect(texts).toContain("( 2 )");
  });

  test("counts the accumulated statistics in the third label", () => {
    const { ctx, target } = makeTarget();
    const first = plotSampling(target, population, { rng: seededRng(14), reps: 2 });
    plotSampling(target, population, {
      rng: seededRng(15),
      reps: 3,
      state: first.state,
    });

    expect(ctx.texts()).toContain("( 5 )");
  });

  test("draws the population curve dotted and heavy", () => {
    const { ctx, target } = makeTarget();
    plotSampling(target, population, { rng: seededRng(16) });
    const dotted = ctx
      .callsTo("stroke")
      .filter((call) => call.style.lineDash.length > 0 && call.style.lineWidth === 2);

    expect(dotted).toHaveLength(1);
  });

  test("draws one translucent gray curve per sample, under the pooled one", () => {
    const { ctx, target } = makeTarget();
    plotSampling(target, population, {
      rng: seededRng(17),
      sampleSize: 20,
      reps: 4,
    });

    expect(strokesIn(ctx, SAMPLE_CURVE_COLOR)).toHaveLength(4);
  });

  test("strokes the pooled curve twice, as R does", () => {
    // R plots it, draws the per-sample curves over it, then re-strokes it.
    const { ctx, target } = makeTarget();
    plotSampling(target, population, {
      rng: seededRng(18),
      sampleSize: 20,
      reps: 3,
    });

    const solidHeavy = ctx
      .callsTo("stroke")
      .filter(
        (call) =>
          call.style.lineDash.length === 0 &&
          call.style.lineWidth === 2 &&
          call.style.strokeStyle !== SAMPLE_CURVE_COLOR,
      );
    const grayIndices = ctx.calls
      .map((call, index) => ({ call, index }))
      .filter(
        ({ call }) =>
          call.method === "stroke" &&
          call.style.strokeStyle === SAMPLE_CURVE_COLOR,
      )
      .map(({ index }) => index);
    const pooledIndices = ctx.calls
      .map((call, index) => ({ call, index }))
      .filter(
        ({ call }) =>
          call.method === "stroke" &&
          call.style.lineDash.length === 0 &&
          call.style.lineWidth === 2 &&
          call.style.strokeStyle !== SAMPLE_CURVE_COLOR,
      )
      .map(({ index }) => index);

    expect(solidHeavy).toHaveLength(2);
    expect(pooledIndices[0]).toBeLessThan(grayIndices[0] as number);
    expect(pooledIndices[1]).toBeGreaterThan(
      grayIndices[grayIndices.length - 1] as number,
    );
  });

  test("draws the histogram as bars with no border", () => {
    const { ctx, target } = makeTarget();
    const result = plotSampling(target, population, {
      rng: seededRng(19),
      reps: 8,
    });

    const bars = barsIn(ctx, BAR_COLOR);
    expect(bars.length).toBeGreaterThan(0);
    // One bar per cell, and the histogram is handed back rather than left for
    // the caller to compute again.
    expect(result.histogram).not.toBeNull();
    expect(result.histogram?.counts).toHaveLength(bars.length);
    // border = FALSE: nothing is stroked in the bar color.
    expect(strokesIn(ctx, BAR_COLOR)).toHaveLength(0);
  });

  test("clips every panel to its own plot area", () => {
    // A sample's curve can rise past the pooled curve's window, and a bar can
    // sit outside the frozen window. R's device clips both.
    const { ctx, target } = makeTarget();
    plotSampling(target, population, { rng: seededRng(20), reps: 2 });

    expect(ctx.callsTo("clip").length).toBeGreaterThanOrEqual(3);
  });

  test("paints the background before anything else", () => {
    const { ctx, target } = makeTarget();
    plotSampling(target, population, { rng: seededRng(21) });
    const first = ctx.calls.find((call) => call.method === "fillRect");

    expect(first?.style.fillStyle).toBe(BACKGROUND);
    expect(first?.args).toEqual([0, 0, WIDTH, HEIGHT]);
  });
});

describe("plotSampling histogram window", () => {
  // PLAN-006 Slice 1. The three panels share one window and the bars are
  // clipped to it, so a statistic outside the window cannot be drawn. It must
  // not set the width of the cells either: one Cauchy sample mean out at 800
  // would otherwise make every cell 100 units wide and leave a 124-wide panel
  // with one flat bar on it. Each test hands the pile in through the state and
  // asks for no new samples, so the pile is exact.
  const window = { xMin: 0, xMax: 10 };
  const inside = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  test("bins a pile that lies inside the window as histogram() does", () => {
    const { target } = makeTarget();
    const result = plotSampling(target, population, {
      reps: 0,
      state: { ...window, sampleTheta: inside },
    });

    expect(result.histogram?.breaks).toEqual(histogram(inside).breaks);
    expect(result.histogram?.counts).toEqual(histogram(inside).counts);
  });

  test("a statistic outside the window does not widen the cells", () => {
    const { target } = makeTarget();
    const result = plotSampling(target, population, {
      reps: 0,
      state: { ...window, sampleTheta: [...inside, 500] },
    });

    expect(result.histogram?.breaks).toEqual(histogram(inside).breaks);
  });

  test("counts every statistic in the label, drawn or not", () => {
    const { ctx, target } = makeTarget();
    plotSampling(target, population, {
      reps: 0,
      state: { ...window, sampleTheta: [...inside, 500] },
    });

    // R: paste("Sampling Statistic", "\n(", length(sample_theta), ")"). The
    // pile is what the reader collected, not what fits on the picture.
    expect(ctx.texts()).toContain("( 10 )");
  });

  test("draws no bars when every statistic is outside the window", () => {
    const { ctx, target } = makeTarget();
    const result = plotSampling(target, population, {
      reps: 0,
      state: { ...window, sampleTheta: [500, 600] },
    });

    // histogram() refuses an empty set, so there is no histogram to hand back.
    expect(result.histogram).toBeNull();
    expect(barsIn(ctx, BAR_COLOR)).toHaveLength(0);
    expect(ctx.texts()).toContain("( 2 )");
  });
});

describe("plotSampling densityWindow", () => {
  // PLAN-006 Slice 2. Every density here takes its grid from the range of the
  // values it is given, so a population that reaches far outside the drawn
  // window gets a grid step wider than the window itself and draws as one
  // straight line. "frozen" sets the grid to the window instead.
  const window = { min: 0, max: 49.75 };
  const leftEdge = samplingScale(
    WIDTH,
    HEIGHT,
    "population",
    window,
    1,
  ).toPixelX(window.min);

  /** The x pixel of every point drawn in the top band, curve and axis alike. */
  function topBandXs(ctx: RecordingContext): number[] {
    const band = HEIGHT / 3;
    return ctx.calls
      .filter((call) => call.method === "moveTo" || call.method === "lineTo")
      .filter((call) => (call.args[1] as number) <= band)
      .map((call) => call.args[0] as number);
  }

  test("draws past the window by default, as R's density() does", () => {
    const { ctx, target } = makeTarget();
    plotSampling(target, population, { rng: seededRng(31), reps: 0 });

    // R's default grid runs three bandwidths past the data on each side, and
    // the window here is the range of the data, so the curve overhangs it.
    expect(Math.min(...topBandXs(ctx))).toBeLessThan(leftEdge);
  });

  test("keeps the curve inside the window when it is frozen", () => {
    const { ctx, target } = makeTarget();
    plotSampling(target, population, {
      rng: seededRng(31),
      reps: 0,
      densityWindow: "frozen",
    });

    expect(Math.min(...topBandXs(ctx))).toBeCloseTo(leftEdge, 6);
  });

  test("freezes the sample curves too, not only the population", () => {
    // A sample of a long-tailed population spans far more than the window, and
    // its own grid step would then be wider than the window is.
    const { ctx, target } = makeTarget();
    plotSampling(target, [...population, 4000], {
      rng: seededRng(32),
      reps: 3,
      sampleSize: 5,
      densityWindow: "frozen",
      state: { xMin: window.min, xMax: window.max, sampleTheta: [] },
    });

    const middleBand = ctx.calls
      .filter((call) => call.method === "moveTo" || call.method === "lineTo")
      .filter((call) => {
        const y = call.args[1] as number;
        return y > HEIGHT / 3 && y <= (2 * HEIGHT) / 3;
      })
      .map((call) => call.args[0] as number);

    expect(Math.min(...middleBand)).toBeCloseTo(leftEdge, 6);
  });
});

describe("plotSampling guards", () => {
  test("draws empty panels for a population too small to have a density", () => {
    const { ctx, target } = makeTarget();
    const { rng, taken } = countingRng(seededRng(22));
    const result = plotSampling(target, [7], { rng });

    // R's density() needs two points and stops below that. A library draws
    // what it can instead: the frames and the axes, and no curves.
    expect(result.samples).toEqual([]);
    expect(result.thetas).toEqual([]);
    expect(result.state.sampleTheta).toEqual([]);
    expect(taken()).toBe(0);
    expect(ctx.texts()).toContain("Population Distribution");
    expect(strokesIn(ctx, SAMPLE_CURVE_COLOR)).toHaveLength(0);
  });

  test("takes the window from a one-value population all the same", () => {
    const { target } = makeTarget();
    const result = plotSampling(target, [7], { rng: seededRng(23) });

    expect(result.state.xMin).toBe(7);
    expect(result.state.xMax).toBe(7);
  });

  test("draws empty panels for no population at all", () => {
    const { ctx, target } = makeTarget();
    const result = plotSampling(target, [], { rng: seededRng(24) });

    expect(result.samples).toEqual([]);
    expect(result.state.sampleTheta).toEqual([]);
    expect(ctx.texts()).toContain("Sample Distribution");
    // Nothing to take a range from, so the window is the unit one. R has no
    // answer here at all: range(numeric(0)) is Inf to -Inf.
    expect(result.state.xMin).toBe(0);
    expect(result.state.xMax).toBe(1);
  });

  test("skips a sample's own curve when the sample is too small for one", () => {
    // Three samples of one value each: no sample has a density of its own,
    // but the three pooled together do.
    const { ctx, target } = makeTarget();
    plotSampling(target, population, {
      rng: seededRng(25),
      sampleSize: 1,
      reps: 3,
    });

    expect(strokesIn(ctx, SAMPLE_CURVE_COLOR)).toHaveLength(0);
    expect(
      ctx
        .callsTo("stroke")
        .filter(
          (call) =>
            call.style.lineDash.length === 0 && call.style.lineWidth === 2,
        ).length,
    ).toBeGreaterThan(0);
  });

  test("refuses a sample larger than the population", () => {
    const { target } = makeTarget();

    expect(() =>
      plotSampling(target, population, {
        rng: seededRng(26),
        sampleSize: population.length + 1,
      }),
    ).toThrow(RangeError);
  });
});

describe("samplingScale", () => {
  const window = { min: 0, max: 10 };

  test("stacks the three panels without overlapping", () => {
    const top = samplingScale(WIDTH, HEIGHT, "population", window, 1);
    const middle = samplingScale(WIDTH, HEIGHT, "samples", window, 1);
    const bottom = samplingScale(WIDTH, HEIGHT, "statistic", window, 1);

    expect(top.area.bottom).toBeLessThanOrEqual(middle.area.top);
    expect(middle.area.bottom).toBeLessThanOrEqual(bottom.area.top);
    expect(bottom.area.bottom).toBeLessThan(HEIGHT);
  });

  test("gives every panel the same horizontal mapping", () => {
    const top = samplingScale(WIDTH, HEIGHT, "population", window, 1);
    const bottom = samplingScale(WIDTH, HEIGHT, "statistic", window, 25);

    expect(bottom.toPixelX(4)).toBe(top.toPixelX(4));
    expect(bottom.area.left).toBe(top.area.left);
    expect(bottom.area.right).toBe(top.area.right);
  });

  test("puts zero at the foot of a panel and the maximum at its head", () => {
    const panel = samplingScale(WIDTH, HEIGHT, "samples", window, 8);

    expect(panel.toPixelY(0)).toBe(panel.area.bottom);
    expect(panel.toPixelY(8)).toBe(panel.area.top);
  });
});

// PLAN-009. The chosen statistic is marked on all three panels, in one color,
// so a reader sees the population, the last sample and the pile of statistics
// in one picture. The library draws two of the three numbers from what it has
// and takes the third — the population's truth — from the caller, because that
// is a fact about the shape and not about the values in the array.

/** Q5: the color the library already uses for a quantity computed from data. */
const MARK_COLOR = "cornflowerblue";
/** The same color at half alpha, as SAMPLE_CURVE_COLOR is for the curves. */
const SAMPLE_MARK_COLOR = "rgba(100, 149, 237, 0.5)";

/** One path, and the style in force when it was stroked or filled. */
interface DrawnPath {
  readonly points: readonly (readonly [number, number])[];
  readonly style: DrawStyle;
}

/**
 * Return every path that was stroked or filled in one color.
 *
 * The recording context keeps each call on its own, so this walks the calls
 * and gathers the points between one `beginPath` and the `stroke` or `fill`
 * that ends it. A clip path holds a `rect`, which is not gathered.
 */
function pathsIn(
  ctx: RecordingContext,
  method: "stroke" | "fill",
  color: string,
): DrawnPath[] {
  const found: DrawnPath[] = [];
  let points: (readonly [number, number])[] = [];

  for (const call of ctx.calls) {
    if (call.method === "beginPath") {
      points = [];
    } else if (call.method === "moveTo" || call.method === "lineTo") {
      points.push([call.args[0] as number, call.args[1] as number]);
    } else if (call.method === method) {
      const color2D =
        method === "stroke" ? call.style.strokeStyle : call.style.fillStyle;
      if (color2D === color) {
        found.push({ points: [...points], style: call.style });
      }
    }
  }
  return found;
}

/** Which of the three bands a path was drawn in. */
function panelOf(path: DrawnPath): SamplingPanel {
  const y = path.points[0]?.[1] ?? 0;
  const band = HEIGHT / 3;
  if (y < band) {
    return "population";
  }
  return y < 2 * band ? "samples" : "statistic";
}

/** Keep the paths drawn in one panel. */
function inPanel(paths: readonly DrawnPath[], panel: SamplingPanel) {
  return paths.filter((path) => panelOf(path) === panel);
}

/** The pixel column a world value takes in one panel. */
function columnOf(
  panel: SamplingPanel,
  value: number,
  window: Extent = { min: 0, max: 49.75 },
): number {
  return samplingScale(WIDTH, HEIGHT, panel, window, 1).toPixelX(value);
}

/** The horizontal reach of a path. */
function spanOf(path: DrawnPath | undefined): [number, number] {
  const xs = (path?.points ?? []).map(([x]) => x);
  return [Math.min(...xs), Math.max(...xs)];
}

describe("plotSampling marks", () => {
  /** A location statistic whose true value in the population is 20. */
  const location = {
    kind: "location",
    populationValue: 20,
    label: "mean",
  } as const;

  test("draws nothing new when the caller asks for no mark", () => {
    const { ctx, target } = makeTarget();
    const result = plotSampling(target, population, {
      rng: seededRng(30),
      sampleSize: 20,
      reps: 3,
    });

    expect(pathsIn(ctx, "stroke", MARK_COLOR)).toHaveLength(0);
    expect(pathsIn(ctx, "stroke", SAMPLE_MARK_COLOR)).toHaveLength(0);
    expect(pathsIn(ctx, "fill", MARK_COLOR)).toHaveLength(0);
    expect(ctx.texts().some((text) => text.startsWith("no true"))).toBe(false);
    expect(result.marks).toBeNull();
  });

  test("a location mark draws one line in each of the three panels", () => {
    const { ctx, target } = makeTarget();
    const result = plotSampling(target, population, {
      rng: seededRng(31),
      sampleSize: 20,
      mark: location,
    });

    const lines = pathsIn(ctx, "stroke", MARK_COLOR);
    expect(lines).toHaveLength(3);
    lines.forEach((line) => {
      // A vertical line: two points in one column.
      expect(line.points).toHaveLength(2);
      expect(line.points[0]?.[0]).toBe(line.points[1]?.[0] as number);
      expect(line.style.lineWidth).toBe(2);
      expect(line.style.lineDash).toHaveLength(0);
    });

    expect(inPanel(lines, "population")[0]?.points[0]?.[0]).toBeCloseTo(
      columnOf("population", 20),
    );
    expect(inPanel(lines, "samples")[0]?.points[0]?.[0]).toBeCloseTo(
      columnOf("samples", result.marks?.sample as number),
    );
    expect(inPanel(lines, "statistic")[0]?.points[0]?.[0]).toBeCloseTo(
      columnOf("statistic", result.marks?.pile as number),
    );
  });

  test("a statistic with no true value draws no line, and writes the note", () => {
    const { ctx, target } = makeTarget();
    plotSampling(target, population, {
      rng: seededRng(32),
      sampleSize: 20,
      mark: { ...location, populationValue: null },
    });

    expect(inPanel(pathsIn(ctx, "stroke", MARK_COLOR), "population")).toHaveLength(
      0,
    );
    // Q6: the caller supplies the singular word, and the panel writes the note
    // under its own label, in the mark color.
    const note = ctx
      .callsTo("fillText")
      .find((call) => call.args[0] === "no true mean");
    expect(note).toBeDefined();
    expect(note?.style.fillStyle).toBe(MARK_COLOR);
  });

  test("a spread mark spans the first two panels and lines the third", () => {
    const { ctx, target } = makeTarget();
    const result = plotSampling(target, population, {
      rng: seededRng(33),
      sampleSize: 30,
      theta: sd,
      mark: {
        kind: "spread",
        populationValue: 5,
        populationCenter: 25,
        label: "standard deviation",
      },
    });

    const drawn = pathsIn(ctx, "stroke", MARK_COLOR);
    // Q4: the span hangs from the center the caller declared.
    const [popLeft, popRight] = spanOf(inPanel(drawn, "population")[0]);
    expect(popLeft).toBeCloseTo(columnOf("population", 20));
    expect(popRight).toBeCloseTo(columnOf("population", 30));

    // The sample span hangs from the mean of the pooled sample.
    const center = mean(result.samples.flat());
    const value = result.marks?.sample as number;
    const [sampleLeft, sampleRight] = spanOf(inPanel(drawn, "samples")[0]);
    expect(sampleLeft).toBeCloseTo(columnOf("samples", center - value));
    expect(sampleRight).toBeCloseTo(columnOf("samples", center + value));

    // The third panel keeps a line: its axis holds the statistic itself.
    const line = inPanel(drawn, "statistic")[0];
    expect(line?.points).toHaveLength(2);
    expect(line?.points[0]?.[0]).toBe(line?.points[1]?.[0] as number);
    expect(line?.points[0]?.[0]).toBeCloseTo(
      columnOf("statistic", result.marks?.pile as number),
    );
  });

  test("draws one faint mark per sample and one solid mark for the pooled one", () => {
    const { ctx, target } = makeTarget();
    plotSampling(target, population, {
      rng: seededRng(34),
      sampleSize: 20,
      reps: 5,
      mark: location,
    });

    const faint = pathsIn(ctx, "stroke", SAMPLE_MARK_COLOR);
    expect(faint).toHaveLength(5);
    faint.forEach((path) => {
      expect(panelOf(path)).toBe("samples");
      expect(path.style.lineWidth).toBe(1);
    });
    expect(inPanel(pathsIn(ctx, "stroke", MARK_COLOR), "samples")).toHaveLength(1);
  });

  test("reps 0 marks no sample, and the pile line still draws", () => {
    const { ctx, target } = makeTarget();
    const window = { min: 0, max: 10 };
    const result = plotSampling(target, population, {
      reps: 0,
      state: { xMin: window.min, xMax: window.max, sampleTheta: [2, 4, 6] },
      mark: { ...location, populationValue: 5 },
    });

    expect(pathsIn(ctx, "stroke", SAMPLE_MARK_COLOR)).toHaveLength(0);
    const drawn = pathsIn(ctx, "stroke", MARK_COLOR);
    expect(inPanel(drawn, "samples")).toHaveLength(0);
    expect(result.marks?.sample).toBeNull();

    expect(inPanel(drawn, "statistic")[0]?.points[0]?.[0]).toBeCloseTo(
      columnOf("statistic", 4, window),
    );
    expect(result.marks?.pile).toBe(4);
  });

  test("an empty pile draws no line on the third panel", () => {
    const { ctx, target } = makeTarget();
    const result = plotSampling(target, population, {
      reps: 0,
      mark: location,
    });

    expect(inPanel(pathsIn(ctx, "stroke", MARK_COLOR), "statistic")).toHaveLength(
      0,
    );
    expect(result.marks?.pile).toBeNull();
  });

  test("the pile average counts the statistics the histogram drops", () => {
    // Q2: the line marks every statistic drawn so far. The third panel bins
    // only the ones inside the window, and the average must not follow it.
    const { target } = makeTarget();
    const inside = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const result = plotSampling(target, population, {
      reps: 0,
      state: { xMin: 0, xMax: 10, sampleTheta: [...inside, 500] },
      mark: location,
    });

    expect(result.marks?.pile).toBeCloseTo(54.5);
    expect(result.histogram?.breaks).toEqual(histogram(inside).breaks);
  });

  test("a mark above the window draws a caret at the right edge", () => {
    const { ctx, target } = makeTarget();
    const window = { min: 0, max: 10 };
    plotSampling(target, population, {
      reps: 0,
      state: { xMin: window.min, xMax: window.max, sampleTheta: [] },
      mark: { ...location, populationValue: 500 },
    });

    // Q7: a clipped line and an absent line look the same, so the panel says
    // which of the two it is.
    const carets = pathsIn(ctx, "fill", MARK_COLOR);
    expect(carets).toHaveLength(1);
    expect(panelOf(carets[0] as DrawnPath)).toBe("population");

    const { area } = samplingScale(WIDTH, HEIGHT, "population", window, 1);
    const [left, right] = spanOf(carets[0]);
    expect(right).toBeCloseTo(area.right);
    expect(left).toBeGreaterThanOrEqual(area.left);
    expect(inPanel(pathsIn(ctx, "stroke", MARK_COLOR), "population")).toHaveLength(
      0,
    );
  });

  test("a mark below the window draws a caret at the left edge", () => {
    const { ctx, target } = makeTarget();
    const window = { min: 0, max: 10 };
    plotSampling(target, population, {
      reps: 0,
      state: { xMin: window.min, xMax: window.max, sampleTheta: [] },
      mark: { ...location, populationValue: -500 },
    });

    const carets = pathsIn(ctx, "fill", MARK_COLOR);
    expect(carets).toHaveLength(1);
    const { area } = samplingScale(WIDTH, HEIGHT, "population", window, 1);
    const [left, right] = spanOf(carets[0]);
    expect(left).toBeCloseTo(area.left);
    expect(right).toBeLessThanOrEqual(area.right);
  });

  test("a spread carets each end that leaves the window", () => {
    const { ctx, target } = makeTarget();
    const window = { min: 0, max: 10 };
    plotSampling(target, population, {
      reps: 0,
      state: { xMin: window.min, xMax: window.max, sampleTheta: [] },
      mark: {
        kind: "spread",
        populationValue: 40,
        populationCenter: 5,
        label: "standard deviation",
      },
    });

    // The span reaches from -35 to 45, so both ends are outside.
    expect(pathsIn(ctx, "fill", MARK_COLOR)).toHaveLength(2);
  });

  test("reports the three numbers, and null where a number does not exist", () => {
    const { target } = makeTarget();
    const drawn = plotSampling(target, population, {
      rng: seededRng(35),
      sampleSize: 12,
      reps: 2,
      mark: location,
    });

    expect(drawn.marks?.population).toBe(20);
    expect(drawn.marks?.sample).toBeCloseTo(mean(drawn.samples.flat()));
    expect(drawn.marks?.pile).toBeCloseTo(mean(drawn.thetas));

    const empty = plotSampling(target, population, {
      reps: 0,
      mark: { ...location, populationValue: null },
    });
    expect(empty.marks).toEqual({
      population: null,
      sample: null,
      pile: null,
    });
  });

  test("a spread with no center draws no span and writes no note", () => {
    // The caller failed to say where the span hangs from. A span at an
    // invented center would be a lie, and the note would name the wrong gap.
    const { ctx, target } = makeTarget();
    plotSampling(target, population, {
      rng: seededRng(36),
      sampleSize: 20,
      theta: sd,
      mark: {
        kind: "spread",
        populationValue: 5,
        populationCenter: null,
        label: "standard deviation",
      },
    });

    expect(inPanel(pathsIn(ctx, "stroke", MARK_COLOR), "population")).toHaveLength(
      0,
    );
    expect(ctx.texts().some((text) => text.startsWith("no true"))).toBe(false);
  });
});
