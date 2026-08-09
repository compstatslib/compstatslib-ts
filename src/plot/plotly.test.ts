/**
 * Tests for the Plotly seam.
 *
 * Nothing here loads Plotly. The one thing that must be proved about the
 * loader is that it cannot be loaded by accident: the library may only be
 * fetched inside `loadPlotly()`, through a dynamic `import`, so that a
 * consumer of the 2D entry never pays for four megabytes of 3D code and the
 * 3D entry pays only when it draws.
 */

import { describe, expect, test } from "bun:test";
import { loadPlotly } from "./plotly";
import { RecordingPlotly, plotlyTarget } from "../../test/recording-plotly";
import type { PlotlyLayout, PlotlyTrace } from "./plotly";

const SOURCE = await Bun.file(
  new URL("./plotly.ts", import.meta.url).pathname,
).text();

const MANIFEST = (await Bun.file(
  new URL("../../package.json", import.meta.url).pathname,
).json()) as {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>;
};

const PLOTLY = "plotly.js-dist-min";

describe("the Plotly dependency", () => {
  test("is not a runtime dependency", () => {
    expect(MANIFEST.dependencies ?? {}).not.toHaveProperty(PLOTLY);
  });

  test("is a peer dependency the consumer may skip", () => {
    expect(MANIFEST.peerDependencies?.[PLOTLY]).toBeString();
    expect(MANIFEST.peerDependenciesMeta?.[PLOTLY]?.optional).toBe(true);
  });

  test("is still installed here, because the demo server serves the file", () => {
    expect(MANIFEST.devDependencies?.[PLOTLY]).toBeString();
  });
});

describe("loadPlotly", () => {
  test("is a function that the caller must invoke", () => {
    expect(typeof loadPlotly).toBe("function");
  });

  test("names Plotly only inside a dynamic import", () => {
    expect(SOURCE).toContain('import("plotly.js-dist-min")');
    expect(SOURCE).not.toMatch(/^\s*import[^(]*["']plotly\.js-dist-min["']/m);
    expect(SOURCE).not.toContain('from "plotly.js-dist-min"');
  });

  test("mentions the library in exactly one place", () => {
    const mentions = SOURCE.match(/plotly\.js-dist-min/g) ?? [];
    expect(mentions.length).toBe(1);
  });
});

describe("PlotlyLike", () => {
  test("a stub engine satisfies the interface the plots draw through", async () => {
    const engine = new RecordingPlotly();
    const element = plotlyTarget();
    const traces: readonly PlotlyTrace[] = [
      {
        type: "scatter3d",
        mode: "markers",
        x: [1],
        y: [2],
        z: [3],
        marker: { opacity: 0.8, size: 5 },
      },
    ];
    const layout: PlotlyLayout = {
      uirevision: "test",
      scene: {
        xaxis: { title: { text: "a" } },
        yaxis: { title: { text: "b" } },
        zaxis: { title: { text: "c" } },
      },
    };

    const rendered = await engine.react(element, traces, layout);

    expect(engine.calls.length).toBe(1);
    expect(engine.last().data).toEqual(traces);
    expect(typeof rendered.on).toBe("function");

    engine.purge(element);
    expect(engine.purged).toEqual([element]);
  });
});
