/**
 * Tests for the 3D scatterplot.
 *
 * The expected structure comes from `.claude/plans/moderation-fixtures.md`
 * section 5, which dumped the object R's `plot_scatter3d()` actually builds
 * (`plotly::plotly_build(p)$x`, from a real Plotly install), and R's own
 * error messages, traced case by case:
 *
 * ```text
 * numeric columns: y, x, z, w
 * captured message: plot_scatter3d(): using numeric columns y, x, z;
 *   skipped w. Pass x/y/z to choose explicitly.
 *
 * type: scatter3d ; mode: markers
 * marker$opacity: 0.8 ; marker$size: 5
 * scene: aspectmode "manual"; aspectratio x/y/z = 1/1/1;
 *        xaxis$title "y"; yaxis$title "x"; zaxis$title "z";
 *        uirevision "scatter3d"
 * layout$uirevision: scatter3d
 * length(x): 200  length(y): 200  length(z): 200
 *
 * `aspect` must be a numeric vector of length 3.
 * `aspect` values must all be positive.
 * `opacity` must be a single numeric in (0, 1].
 * `size` must be a single positive numeric.
 * plot_scatter3d() needs at least 3 numeric columns; got 2. Supply x/y/z
 *   explicitly or add numeric columns.
 * Column "nope" (passed as `x`) is not in `data`.
 * Column "b" (passed as `x`) is factor; plot_scatter3d() requires numeric
 *   columns on x/y/z. Use `color` for categorical separation.
 *
 * aspect wrong length -> plot_ly call_count = 0
 * opacity 0           -> plot_ly call_count = 0
 * missing column      -> plot_ly call_count = 0
 * valid call          -> plot_ly call_count = 1
 * ```
 *
 * The last block is the contract this file pins hardest: every validation
 * error must fire before the engine is touched at all.
 */

import { describe, expect, test } from "bun:test";
import { plotScatter3d, scatter3dSpec } from "./scatter3d";
import { moderationData } from "../data/moderationData";
import { RecordingPlotly, plotlyTarget } from "../../test/recording-plotly";
import type { DataFrame } from "../core/frame";
import type { Scatter3dTrace } from "./plotly";

const THREE: DataFrame = { a: [1, 2, 3], b: [4, 5, 6], c: [7, 8, 9] };

const COLORED: DataFrame = {
  a: [1, 2, 3, 4],
  b: [5, 6, 7, 8],
  c: [9, 10, 11, 12],
  grp: ["dog", "cat", "dog", "fox"],
  flag: [false, true, true, false],
  score: [0.5, 1.5, 2.5, 3.5],
};

const TWO_NUMERIC: DataFrame = { a: [1, 2, 3], b: ["p", "q", "r"], c: [7, 8, 9] };

/** The traces, narrowed: every scatter3d spec builds scatter3d traces. */
function traces(spec: { readonly traces: readonly unknown[] }): Scatter3dTrace[] {
  return spec.traces as Scatter3dTrace[];
}

describe("scatter3dSpec column choice", () => {
  test("takes the first three numeric columns, in frame order", () => {
    const spec = scatter3dSpec(moderationData);
    const [trace] = traces(spec);

    expect(trace?.x).toEqual(moderationData.y);
    expect(trace?.y).toEqual(moderationData.x);
    expect(trace?.z).toEqual(moderationData.z);
    expect(trace?.x.length).toBe(200);
  });

  test("reports the chosen and the skipped columns, as R's message does", () => {
    expect(scatter3dSpec(moderationData).note).toBe(
      "plotScatter3d(): using numeric columns y, x, z; skipped w. " +
        "Pass x/y/z to choose explicitly.",
    );
  });

  test("says nothing when no column was skipped", () => {
    const spec = scatter3dSpec(THREE);

    expect(spec.note).toBe(null);
    expect(spec.traces.length).toBe(1);
    expect(traces(spec)[0]?.x).toEqual([1, 2, 3]);
    expect(traces(spec)[0]?.z).toEqual([7, 8, 9]);
  });

  test("says nothing when the caller named every axis", () => {
    const spec = scatter3dSpec(moderationData, { x: "x", y: "z", z: "y" });

    expect(spec.note).toBe(null);
    expect(traces(spec)[0]?.x).toEqual(moderationData.x);
    expect(traces(spec)[0]?.z).toEqual(moderationData.y);
  });

  test("fills only the axes the caller left out, and still reports", () => {
    const spec = scatter3dSpec(moderationData, { x: "w" });
    const [trace] = traces(spec);

    // R: x stays as given; y and z become chosen[2] and chosen[3].
    expect(trace?.x).toEqual(moderationData.w);
    expect(trace?.y).toEqual(moderationData.x);
    expect(trace?.z).toEqual(moderationData.z);
    expect(spec.note).toContain("skipped w");
  });
});

describe("scatter3dSpec trace and layout", () => {
  test("builds one marker trace with R's default marker", () => {
    const spec = scatter3dSpec(moderationData);

    expect(spec.traces.length).toBe(1);
    expect(traces(spec)[0]?.type).toBe("scatter3d");
    expect(traces(spec)[0]?.mode).toBe("markers");
    expect(traces(spec)[0]?.marker.opacity).toBe(0.8);
    expect(traces(spec)[0]?.marker.size).toBe(5);
  });

  test("builds R's scene, titled with the chosen column names", () => {
    const { layout } = scatter3dSpec(moderationData);

    expect(layout.uirevision).toBe("scatter3d");
    expect(layout.scene.uirevision).toBe("scatter3d");
    expect(layout.scene.aspectmode).toBe("manual");
    expect(layout.scene.aspectratio).toEqual({ x: 1, y: 1, z: 1 });
    expect(layout.scene.xaxis.title).toBe("y");
    expect(layout.scene.yaxis.title).toBe("x");
    expect(layout.scene.zaxis.title).toBe("z");
  });

  test("carries aspect, opacity and size through", () => {
    const spec = scatter3dSpec(moderationData, {
      aspect: [1, 2, 4],
      opacity: 0.3,
      size: 10,
    });

    expect(spec.layout.scene.aspectratio).toEqual({ x: 1, y: 2, z: 4 });
    expect(traces(spec)[0]?.marker.opacity).toBe(0.3);
    expect(traces(spec)[0]?.marker.size).toBe(10);
  });

  test("overrides only the titles it is given", () => {
    const { layout } = scatter3dSpec(moderationData, {
      x: "x",
      y: "z",
      z: "y",
      titles: { x: "IV", z: "Outcome" },
    });

    expect(layout.scene.xaxis.title).toBe("IV");
    expect(layout.scene.yaxis.title).toBe("z");
    expect(layout.scene.zaxis.title).toBe("Outcome");
  });

  test("sets a camera only when the caller gives one", () => {
    const plain = scatter3dSpec(THREE);
    expect("camera" in plain.layout.scene).toBe(false);

    const aimed = scatter3dSpec(THREE, {
      camera: { eye: { x: 1, y: 1, z: 1 } },
    });
    expect(aimed.layout.scene.camera).toEqual({ eye: { x: 1, y: 1, z: 1 } });
  });
});

describe("scatter3dSpec colour", () => {
  test("maps a numeric column onto one trace with a colour bar", () => {
    const spec = scatter3dSpec(COLORED, {
      x: "a",
      y: "b",
      z: "c",
      color: "score",
    });

    expect(spec.traces.length).toBe(1);
    expect(traces(spec)[0]?.marker.color).toEqual(COLORED.score as number[]);
    expect(traces(spec)[0]?.marker.colorscale).toBe("Viridis");
    expect(traces(spec)[0]?.marker.showscale).toBe(true);
  });

  test("splits a text column into one trace per level, first seen first", () => {
    const spec = scatter3dSpec(COLORED, {
      x: "a",
      y: "b",
      z: "c",
      color: "grp",
    });

    expect(spec.traces.map((trace) => (trace as Scatter3dTrace).name)).toEqual([
      "dog",
      "cat",
      "fox",
    ]);
    expect(traces(spec)[0]?.x).toEqual([1, 3]);
    expect(traces(spec)[0]?.y).toEqual([5, 7]);
    expect(traces(spec)[0]?.z).toEqual([9, 11]);
    expect(traces(spec)[1]?.x).toEqual([2]);
    expect(traces(spec)[2]?.x).toEqual([4]);
    expect(traces(spec).every((trace) => trace.showlegend === true)).toBe(true);
    expect(traces(spec)[0]?.marker.color).toBe(undefined);
    expect(traces(spec)[0]?.marker.showscale).toBe(undefined);
  });

  test("names the levels of a true-or-false column as text", () => {
    const spec = scatter3dSpec(COLORED, {
      x: "a",
      y: "b",
      z: "c",
      color: "flag",
    });

    expect(spec.traces.map((trace) => (trace as Scatter3dTrace).name)).toEqual([
      "false",
      "true",
    ]);
    expect(traces(spec)[0]?.x).toEqual([1, 4]);
    expect(traces(spec)[1]?.x).toEqual([2, 3]);
  });

  test("keeps the marker style on every level trace", () => {
    const spec = scatter3dSpec(COLORED, {
      x: "a",
      y: "b",
      z: "c",
      color: "grp",
      opacity: 0.25,
      size: 9,
    });

    expect(spec.traces.length).toBe(3);
    expect(
      traces(spec).every(
        (trace) => trace.marker.opacity === 0.25 && trace.marker.size === 9,
      ),
    ).toBe(true);
  });

  test("draws one plain trace when no colour column is named", () => {
    const spec = scatter3dSpec(THREE);
    const [trace] = traces(spec);

    expect(spec.traces.length).toBe(1);
    expect(trace?.x).toEqual([1, 2, 3]);
    expect(trace?.marker.color).toBe(undefined);
    expect(trace?.name).toBe(undefined);
    expect(trace?.showlegend).toBe(undefined);
  });
});

describe("scatter3dSpec refusals", () => {
  test("refuses an aspect that is not three numbers", () => {
    expect(() => scatter3dSpec(THREE, { aspect: [1, 2] })).toThrow(
      "`aspect` must be a numeric vector of length 3.",
    );
    expect(() =>
      scatter3dSpec(THREE, { aspect: [1, 2, Number.NaN] }),
    ).toThrow("`aspect` must be a numeric vector of length 3.");
  });

  test("refuses an aspect that is not positive", () => {
    expect(() => scatter3dSpec(THREE, { aspect: [1, -1, 1] })).toThrow(
      "`aspect` values must all be positive.",
    );
    expect(() => scatter3dSpec(THREE, { aspect: [1, 0, 1] })).toThrow(
      "`aspect` values must all be positive.",
    );
  });

  test("refuses an opacity outside R's range", () => {
    for (const opacity of [0, 1.5, -0.5, Number.NaN]) {
      expect(() => scatter3dSpec(THREE, { opacity })).toThrow(
        "`opacity` must be a single numeric in (0, 1].",
      );
    }
    expect(() => scatter3dSpec(THREE, { opacity: 1 })).not.toThrow();
  });

  test("refuses a size that is not a positive number", () => {
    for (const size of [0, -1, Number.NaN]) {
      expect(() => scatter3dSpec(THREE, { size })).toThrow(
        "`size` must be a single positive numeric.",
      );
    }
  });

  test("refuses a frame with fewer than three numeric columns", () => {
    expect(() => scatter3dSpec(TWO_NUMERIC)).toThrow(
      "plotScatter3d() needs at least 3 numeric columns; got 2. " +
        "Supply x/y/z explicitly or add numeric columns.",
    );
  });

  test("refuses an axis column that is not there", () => {
    expect(() =>
      scatter3dSpec(moderationData, { x: "nope", y: "x", z: "z" }),
    ).toThrow('Column "nope" (passed as `x`) is not in the data.');
  });

  test("refuses an axis column that is not numeric, pointing at colour", () => {
    expect(() =>
      scatter3dSpec(COLORED, { x: "grp", y: "a", z: "b" }),
    ).toThrow(
      'Column "grp" (passed as `x`) is text; plotScatter3d() requires ' +
        "numeric columns on x/y/z. Use `color` for categorical separation.",
    );
    expect(() =>
      scatter3dSpec(COLORED, { x: "a", y: "flag", z: "b" }),
    ).toThrow('Column "flag" (passed as `y`) is true or false;');
  });

  test("refuses a colour column that is not there", () => {
    expect(() => scatter3dSpec(THREE, { color: "nope" })).toThrow(
      'Column "nope" (passed as `color`) is not in the data.',
    );
  });

  test("refuses a ragged frame", () => {
    expect(() =>
      scatter3dSpec({ a: [1, 2, 3], b: [4, 5], c: [7, 8, 9] }),
    ).toThrow("every column needs the same number of rows");
  });

  test("checks the style before the columns, as R does", () => {
    // R validates aspect / opacity / size first, so a call that is wrong in
    // two ways reports the style, whatever the columns look like.
    expect(() =>
      scatter3dSpec(TWO_NUMERIC, { aspect: [1, 2], x: "nope" }),
    ).toThrow("`aspect` must be a numeric vector of length 3.");
    expect(() => scatter3dSpec(TWO_NUMERIC, { opacity: 0 })).toThrow(
      "`opacity` must be a single numeric in (0, 1].",
    );
  });
});

describe("plotScatter3d", () => {
  test("draws the spec through the engine and hands it back", async () => {
    const engine = new RecordingPlotly();
    const element = plotlyTarget();

    const handle = await plotScatter3d(element, moderationData, {
      plotly: engine,
    });
    const spec = scatter3dSpec(moderationData);

    expect(engine.calls.length).toBe(1);
    expect(engine.last().element).toBe(element);
    expect(engine.last().data).toEqual(spec.traces);
    expect(engine.last().layout).toEqual(spec.layout);
    expect(handle.traces).toEqual(spec.traces);
    expect(handle.layout).toEqual(spec.layout);
    expect(handle.note).toBe(spec.note);
    expect(handle.plotly).toBe(engine);
    expect(handle.element).toBe(element);
  });

  test("asks for a plot that follows its container", async () => {
    const engine = new RecordingPlotly();

    await plotScatter3d(plotlyTarget(), THREE, { plotly: engine });

    expect(engine.last().config).toEqual({ responsive: true });
  });

  test("redraws the same element rather than building a second plot", async () => {
    const engine = new RecordingPlotly();
    const element = plotlyTarget();

    await plotScatter3d(element, THREE, { plotly: engine });
    await plotScatter3d(element, THREE, { plotly: engine, size: 9 });

    expect(engine.calls.length).toBe(2);
    expect(engine.calls[0]?.element).toBe(element);
    expect(engine.calls[1]?.element).toBe(element);
    expect(
      (engine.calls[1]?.data[0] as Scatter3dTrace | undefined)?.marker.size,
    ).toBe(9);
  });

  test("never touches the engine on a refusal", async () => {
    const engine = new RecordingPlotly();
    const element = plotlyTarget();

    await expect(
      plotScatter3d(element, THREE, { plotly: engine, opacity: 0 }),
    ).rejects.toThrow("`opacity` must be a single numeric in (0, 1].");
    await expect(
      plotScatter3d(element, moderationData, { plotly: engine, x: "nope" }),
    ).rejects.toThrow('Column "nope" (passed as `x`) is not in the data.');
    await expect(
      plotScatter3d(element, TWO_NUMERIC, { plotly: engine }),
    ).rejects.toThrow("needs at least 3 numeric columns");

    expect(engine.calls.length).toBe(0);
  });
});
