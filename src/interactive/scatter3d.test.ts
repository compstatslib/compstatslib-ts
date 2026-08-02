/**
 * Tests for the interactive 3D scatterplot.
 *
 * The component owns four pickers, five sliders, and the camera the user
 * turned the plot to. Everything it draws goes through `plotScatter3d`, which
 * is tested on its own, so these tests check the controls, the state, the
 * camera, and that a change reaches the plot — not the picture.
 *
 * The controls and the validation come from
 * `../compstatslib/R/scatter3d_interactive.R` and its helper file:
 *
 * ```r
 * shiny::selectInput("x", "X", choices = num_cols, selected = init_x)
 * shiny::selectInput("y", "Y", choices = num_cols, selected = init_y)
 * shiny::selectInput("z", "Z", choices = num_cols, selected = init_z)
 * shiny::selectInput("color", "Color",
 *                    choices = c("(none)", names(data)), selected = init_color)
 * shiny::sliderInput("aspect_x", "Aspect X", min = 0.1, max = 10,
 *                    value = aspect[1], step = 0.1)
 * shiny::sliderInput("aspect_y", "Aspect Y", ... aspect[2] ...)
 * shiny::sliderInput("aspect_z", "Aspect Z", ... aspect[3] ...)
 * shiny::sliderInput("opacity", "Opacity", min = 0.05, max = 1,
 *                    value = opacity, step = 0.05)
 * shiny::sliderInput("size", "Size", min = 1, max = 20, value = size, step = 1)
 *
 * scatter3d_validate_style(aspect, opacity, size, camera)   # first of all
 * num_cols <- scatter3d_numeric_cols(data)
 * scatter3d_require_3_numeric(num_cols, "interactive_scatter3d")
 * stop("Initial `", axis_name, "` (\"", val, "\") is not a numeric column ",
 *      "of `data`. Numeric columns: ", paste(num_cols, collapse = ", "), ".")
 * stop("Initial `color` (\"", color, "\") is not in `data`.")
 * ```
 *
 * R validates before it builds anything, so a bad argument leaves no gadget
 * and no plot. That order is pinned here by counting the engine's calls and
 * the controls that were built.
 *
 * **Out of range is not the same as invalid.** R's `scatter3d_validate_style`
 * refuses an opacity of 0 and a negative aspect outright, but says nothing
 * about the slider bounds: `aspect = 12` passes it, and the shipped
 * `ion.rangeSlider.js` then clamps the handle to the slider's maximum. So this
 * component throws exactly where R throws, and clamps and snaps where R's
 * widget clamps — the same rule the matrix-inverse component follows.
 *
 * **The camera is captured, not computed.** R stores whatever
 * `plotly_relayout` reports under `scene.camera` in a reactive value, re-passes
 * it into every render, and hands it back on Done. It never redraws on its own
 * account when the user turns the plot: Plotly has already moved the picture.
 */

import { describe, expect, test } from "bun:test";

import {
  RecordingPlotly,
  asPlotlyElement,
  type RecordedListeners,
} from "../../test/recording-plotly";
import type { DataFrame } from "../core/frame";
import { scatter3dSpec } from "../plot/scatter3d";
import type { Scatter3dTrace } from "../plot/plotly";
import type {
  PlotlyCamera,
  PlotlyConfig,
  PlotlyHTMLElement,
  PlotlyLayout,
  PlotlyLike,
  PlotlyRelayoutEvent,
  PlotlyRelayoutUpdate,
  PlotlyTrace,
} from "../plot/plotly";
import { interactiveScatter3d } from "./scatter3d";
import type {
  InteractiveScatter3dOptions,
  Scatter3dValues,
} from "./scatter3d";

/** Four numeric columns, so that a fourth is left over, plus a categorical. */
const FRAME: DataFrame = {
  a: [1, 2, 3, 4],
  b: [5, 6, 7, 8],
  c: [9, 10, 11, 12],
  grp: ["dog", "cat", "dog", "fox"],
  d: [0.5, 1.5, 2.5, 3.5],
};

/** A frame with too few numeric columns to fill three axes. */
const THIN: DataFrame = { a: [1, 2], b: ["p", "q"] };

/** A camera as Plotly reports one after the user has turned the plot. */
const TURNED: PlotlyCamera = {
  eye: { x: 0.5, y: -1.5, z: 0.75 },
};

/** A second reported camera, unlike the first. */
const FURTHER: PlotlyCamera = {
  eye: { x: -1, y: 1, z: 0.5 },
  up: { x: 0, y: 0, z: 1 },
};

/** Build the component against a recording engine and a split target. */
function setup(options: InteractiveScatter3dOptions = {}, data: DataFrame = FRAME) {
  const plotly = new RecordingPlotly();
  const plot = asPlotlyElement(document.createElement("div"));
  const controls = document.createElement("div");
  const handle = interactiveScatter3d({ plot, controls }, data, {
    plotly,
    ...options,
  });
  return { plotly, plot, controls, handle };
}

/** Build the component and wait for its first picture. */
async function drawn(
  options: InteractiveScatter3dOptions = {},
  data: DataFrame = FRAME,
) {
  const parts = setup(options, data);
  await parts.handle.rendered();
  return parts;
}

/** One control, by name. */
function control<T extends HTMLElement>(controls: HTMLElement, name: string): T {
  const found = controls.querySelector(`[name="${name}"]`);
  expect(found).not.toBeNull();
  return found as T;
}

function slider(controls: HTMLElement, name: string): HTMLInputElement {
  return control<HTMLInputElement>(controls, name);
}

function picker(controls: HTMLElement, name: string): HTMLSelectElement {
  return control<HTMLSelectElement>(controls, name);
}

/** Set a control and fire the event a browser fires for it. */
function setControl(
  input: HTMLInputElement | HTMLSelectElement,
  value: string,
  event: "input" | "change",
): void {
  input.value = value;
  input.dispatchEvent(new Event(event, { bubbles: true }));
}

/** Move a slider and wait for the redraw it asks for. */
async function moveSlider(
  handle: { rendered(): Promise<void> },
  controls: HTMLElement,
  name: string,
  value: string,
): Promise<void> {
  setControl(slider(controls, name), value, "input");
  await handle.rendered();
}

/** Choose from a picker and wait for the redraw it asks for. */
async function choose(
  handle: { rendered(): Promise<void> },
  controls: HTMLElement,
  name: string,
  value: string,
): Promise<void> {
  setControl(picker(controls, name), value, "change");
  await handle.rendered();
}

/** Hand the element the event Plotly fires when the user moves the plot. */
function emitRelayout(plot: HTMLElement, event: PlotlyRelayoutEvent): void {
  const listeners = plot as unknown as RecordedListeners;
  for (const handler of listeners.handlers.get("plotly_relayout") ?? []) {
    handler(event);
  }
}

/** How many handlers the element carries for Plotly's move event. */
function listenerCount(plot: HTMLElement): number {
  const listeners = plot as unknown as RecordedListeners;
  return (listeners.handlers.get("plotly_relayout") ?? []).length;
}

/** The traces of the last call, narrowed. */
function lastTraces(plotly: RecordingPlotly): Scatter3dTrace[] {
  return plotly.last().data as Scatter3dTrace[];
}

/** An engine that only draws when the test lets it. */
class SlowPlotly implements PlotlyLike {
  readonly calls: {
    readonly data: readonly PlotlyTrace[];
    readonly layout: PlotlyLayout;
  }[] = [];
  readonly relayouts: PlotlyRelayoutUpdate[] = [];
  private waiting: (() => void)[] = [];

  react(
    element: HTMLElement,
    data: readonly PlotlyTrace[],
    layout: PlotlyLayout,
    _config?: PlotlyConfig,
  ): Promise<PlotlyHTMLElement> {
    this.calls.push({ data, layout });
    return new Promise((resolve) => {
      this.waiting.push(() => resolve(asPlotlyElement(element)));
    });
  }

  relayout(
    element: HTMLElement,
    update: PlotlyRelayoutUpdate,
  ): Promise<PlotlyHTMLElement> {
    this.relayouts.push(update);
    return Promise.resolve(asPlotlyElement(element));
  }

  purge(): void {
    // Nothing to take back: this engine never drew.
  }

  /** How many draws are waiting to finish. */
  get inFlight(): number {
    return this.waiting.length;
  }

  /** Let every waiting draw finish. */
  release(): void {
    const waiting = this.waiting;
    this.waiting = [];
    for (const resolve of waiting) {
      resolve();
    }
  }
}

/** Let the microtask queue run, so a released draw can proceed. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
}

describe("interactiveScatter3d", () => {
  describe("the control panel", () => {
    test("builds R's four pickers, in R's order", async () => {
      const { controls } = await drawn();
      const selects = [...controls.querySelectorAll("select")];

      expect(selects.map((select) => select.name)).toEqual([
        "x",
        "y",
        "z",
        "color",
      ]);
    });

    test("offers only the numeric columns on the three axes", async () => {
      const { controls } = await drawn();

      for (const name of ["x", "y", "z"]) {
        const options = [...picker(controls, name).options].map(
          (option) => option.value,
        );
        expect(options).toEqual(["a", "b", "c", "d"]);
      }
    });

    test("offers R's `(none)` sentinel and every column for color", async () => {
      const { controls } = await drawn();
      const options = [...picker(controls, "color").options].map(
        (option) => option.value,
      );

      expect(options).toEqual(["(none)", "a", "b", "c", "grp", "d"]);
    });

    test("starts on the first three numeric columns and no color", async () => {
      const { controls } = await drawn();

      expect(picker(controls, "x").value).toBe("a");
      expect(picker(controls, "y").value).toBe("b");
      expect(picker(controls, "z").value).toBe("c");
      expect(picker(controls, "color").value).toBe("(none)");
    });

    test("builds R's five sliders with R's ranges, steps and defaults", async () => {
      const { controls } = await drawn();
      const expected = [
        { name: "aspectX", min: "0.1", max: "10", step: "0.1", value: "1" },
        { name: "aspectY", min: "0.1", max: "10", step: "0.1", value: "1" },
        { name: "aspectZ", min: "0.1", max: "10", step: "0.1", value: "1" },
        { name: "opacity", min: "0.05", max: "1", step: "0.05", value: "0.8" },
        { name: "size", min: "1", max: "20", step: "1", value: "5" },
      ];

      for (const wanted of expected) {
        const input = slider(controls, wanted.name);
        expect(input.type).toBe("range");
        expect(input.min).toBe(wanted.min);
        expect(input.max).toBe(wanted.max);
        expect(input.step).toBe(wanted.step);
        expect(input.value).toBe(wanted.value);
      }
    });

    test("labels every control as R labels it", async () => {
      const { controls } = await drawn();
      const text = controls.textContent ?? "";

      for (const label of [
        "X",
        "Y",
        "Z",
        "Color",
        "Aspect X",
        "Aspect Y",
        "Aspect Z",
        "Opacity",
        "Size",
      ]) {
        expect(text).toContain(label);
      }
    });

    test("shows the value beside a slider that moved", async () => {
      const { controls, handle } = await drawn();

      await moveSlider(handle, controls, "size", "12");

      expect(controls.textContent).toContain("12");
    });
  });

  describe("starting values", () => {
    test("puts the caller's columns into the pickers and the picture", async () => {
      const { controls, plotly } = await drawn({
        x: "d",
        y: "c",
        z: "a",
        color: "grp",
      });

      expect(picker(controls, "x").value).toBe("d");
      expect(picker(controls, "y").value).toBe("c");
      expect(picker(controls, "z").value).toBe("a");
      expect(picker(controls, "color").value).toBe("grp");
      const { scene } = plotly.last().layout;
      expect([scene.xaxis.title, scene.yaxis.title, scene.zaxis.title]).toEqual([
        "d",
        "c",
        "a",
      ]);
      // Three levels of `grp` give three traces, as the plot layer decides,
      // and between them they carry every row of the chosen column.
      expect(lastTraces(plotly)).toHaveLength(3);
      expect(lastTraces(plotly).flatMap((trace) => trace.x).sort()).toEqual(
        [...(FRAME.d as number[])].sort(),
      );
    });

    test("puts the caller's style into the sliders and the picture", async () => {
      const { controls, plotly } = await drawn({
        aspect: [2, 0.5, 3],
        opacity: 0.5,
        size: 9,
      });

      expect(slider(controls, "aspectX").value).toBe("2");
      expect(slider(controls, "aspectY").value).toBe("0.5");
      expect(slider(controls, "aspectZ").value).toBe("3");
      expect(slider(controls, "opacity").value).toBe("0.5");
      expect(slider(controls, "size").value).toBe("9");
      expect(plotly.last().layout.scene.aspectratio).toEqual({
        x: 2,
        y: 0.5,
        z: 3,
      });
      expect(lastTraces(plotly)[0]?.marker).toEqual({ opacity: 0.5, size: 9 });
    });

    test("clamps a slider value outside the slider's range", async () => {
      // R's own widget does this: ion.rangeSlider's validate() moves the
      // handle to the nearer bound. R's style check passes 12 and 100.
      const { controls, handle } = await drawn({ aspect: [12, 0.01, 1], size: 100 });

      expect(handle.getValues().aspect).toEqual([10, 0.1, 1]);
      expect(handle.getValues().size).toBe(20);
      expect(slider(controls, "aspectX").value).toBe("10");
      expect(slider(controls, "aspectY").value).toBe("0.1");
      expect(slider(controls, "size").value).toBe("20");
    });

    test("snaps a slider value that misses the step", async () => {
      // An HTML range input will not stand at 1.23 on a step of 0.1, so a
      // component that held it would draw one picture and show another.
      const { controls, handle } = await drawn({
        aspect: [1.23, 1, 1],
        opacity: 0.83,
        size: 7.4,
      });

      expect(handle.getValues().aspect?.[0]).toBe(1.2);
      expect(handle.getValues().opacity).toBe(0.85);
      expect(handle.getValues().size).toBe(7);
      expect(slider(controls, "aspectX").value).toBe("1.2");
      expect(slider(controls, "opacity").value).toBe("0.85");
      expect(slider(controls, "size").value).toBe("7");
    });

    test("threads the axis titles through, though no control shows them", async () => {
      // R: "the title arg has no in-gadget UI but threads through every
      // render and into the Done output".
      const { plotly, handle } = await drawn({ titles: { x: "Score" } });

      expect(plotly.last().layout.scene.xaxis.title).toBe("Score");
      expect(handle.getValues().titles).toEqual({ x: "Score" });
    });

    test("opens at a camera the caller supplied", async () => {
      const { plotly, handle } = await drawn({ camera: TURNED });

      expect(plotly.last().layout.scene.camera).toEqual(TURNED);
      expect(handle.getValues().camera).toEqual(TURNED);
    });
  });

  describe("validation, before anything is built", () => {
    test("refuses a frame with fewer than three numeric columns", () => {
      const plotly = new RecordingPlotly();
      const plot = document.createElement("div");
      const controls = document.createElement("div");

      expect(() =>
        interactiveScatter3d({ plot, controls }, THIN, { plotly }),
      ).toThrow(
        "interactiveScatter3d() needs at least 3 numeric columns; got 1. " +
          "Supply x/y/z explicitly or add numeric columns.",
      );
      expect(controls.children).toHaveLength(0);
      expect(plotly.calls).toHaveLength(0);
    });

    test("refuses an initial axis column that is not numeric", () => {
      const plotly = new RecordingPlotly();
      const plot = document.createElement("div");
      const controls = document.createElement("div");

      expect(() =>
        interactiveScatter3d({ plot, controls }, FRAME, {
          plotly,
          y: "grp",
        }),
      ).toThrow(
        'Initial `y` ("grp") is not a numeric column of `data`. ' +
          "Numeric columns: a, b, c, d.",
      );
      expect(controls.children).toHaveLength(0);
      expect(plotly.calls).toHaveLength(0);
    });

    test("refuses an initial axis column that is not in the frame", () => {
      expect(() =>
        interactiveScatter3d(
          { plot: document.createElement("div"), controls: document.createElement("div") },
          FRAME,
          { plotly: new RecordingPlotly(), z: "nope" },
        ),
      ).toThrow(/Initial `z` \("nope"\) is not a numeric column/);
    });

    test("refuses an initial color column that is not in the frame", () => {
      const plotly = new RecordingPlotly();
      const controls = document.createElement("div");

      expect(() =>
        interactiveScatter3d(
          { plot: document.createElement("div"), controls },
          FRAME,
          { plotly, color: "nope" },
        ),
      ).toThrow('Initial `color` ("nope") is not in `data`.');
      expect(controls.children).toHaveLength(0);
      expect(plotly.calls).toHaveLength(0);
    });

    test("refuses a style R's own check refuses, before the columns", () => {
      // R runs scatter3d_validate_style first of all, so a bad style is
      // reported even when the frame could not have been drawn either.
      const controls = document.createElement("div");
      const build = (options: InteractiveScatter3dOptions) => () =>
        interactiveScatter3d(
          { plot: document.createElement("div"), controls },
          THIN,
          { plotly: new RecordingPlotly(), ...options },
        );

      expect(build({ aspect: [1, 1] })).toThrow(
        "`aspect` must be a numeric vector of length 3.",
      );
      expect(build({ aspect: [1, -1, 1] })).toThrow(
        "`aspect` values must all be positive.",
      );
      expect(build({ opacity: 0 })).toThrow(
        "`opacity` must be a single numeric in (0, 1].",
      );
      expect(build({ size: 0 })).toThrow(
        "`size` must be a single positive numeric.",
      );
      expect(controls.children).toHaveLength(0);
    });
  });

  describe("drawing", () => {
    test("draws once, into the plot element, as soon as it starts", async () => {
      const { plotly, plot } = await drawn();

      expect(plotly.calls).toHaveLength(1);
      expect(plotly.last().element).toBe(plot);
    });

    test("draws through the plot function, not with drawing of its own", async () => {
      // The uirevision and the manual aspect mode can only have come from
      // `plotScatter3d`.
      const { plotly } = await drawn();
      const { layout } = plotly.last();

      expect(layout.uirevision).toBe("scatter3d");
      expect(layout.scene.uirevision).toBe("scatter3d");
      expect(layout.scene.aspectmode).toBe("manual");
    });

    test("redraws with the new column when an axis picker changes", async () => {
      const { plotly, controls, handle } = await drawn();

      await choose(handle, controls, "x", "d");

      expect(plotly.calls).toHaveLength(2);
      expect(lastTraces(plotly)[0]?.x).toEqual(FRAME.d as number[]);
      expect(plotly.last().layout.scene.xaxis.title).toBe("d");
      expect(handle.getValues().x).toBe("d");
    });

    test("splits the points when a categorical color column is chosen", async () => {
      const { plotly, controls, handle } = await drawn();

      await choose(handle, controls, "color", "grp");

      expect(lastTraces(plotly)).toHaveLength(3);
      expect(handle.getValues().color).toBe("grp");
    });

    test("takes the color off again on R's `(none)` sentinel", async () => {
      const { plotly, controls, handle } = await drawn({ color: "grp" });

      await choose(handle, controls, "color", "(none)");

      expect(lastTraces(plotly)).toHaveLength(1);
      expect(handle.getValues().color).toBeUndefined();
    });

    test("redraws with the new style when each slider moves", async () => {
      const { plotly, controls, handle } = await drawn();

      await moveSlider(handle, controls, "aspectX", "2.5");
      await moveSlider(handle, controls, "aspectY", "0.5");
      await moveSlider(handle, controls, "aspectZ", "3");
      await moveSlider(handle, controls, "opacity", "0.3");
      await moveSlider(handle, controls, "size", "11");

      expect(plotly.calls).toHaveLength(6);
      expect(plotly.last().layout.scene.aspectratio).toEqual({
        x: 2.5,
        y: 0.5,
        z: 3,
      });
      expect(lastTraces(plotly)[0]?.marker).toEqual({ opacity: 0.3, size: 11 });
      expect(handle.getValues().aspect).toEqual([2.5, 0.5, 3]);
    });

    test("keeps drawing through the engine it was given", async () => {
      const { plotly, controls, handle } = await drawn();

      await choose(handle, controls, "y", "d");
      await moveSlider(handle, controls, "size", "8");

      expect(plotly.calls).toHaveLength(3);
    });

    test("never asks the engine to relayout for a control change", async () => {
      // The scatterplot has no computed camera. What the caller supplied
      // travels in the layout, so a picker or slider change needs no push at
      // the plot. The one relayout this component makes is the camera
      // persistence tested under "the camera" below.
      const { plotly, controls, handle } = await drawn({ camera: TURNED });

      await choose(handle, controls, "x", "d");

      expect(plotly.relayouts).toHaveLength(0);
    });
  });

  describe("the resumable state", () => {
    test("reproduces the drawn picture when fed back to the plot layer", async () => {
      const { plotly, controls, handle } = await drawn();

      await choose(handle, controls, "color", "grp");
      await moveSlider(handle, controls, "opacity", "0.45");
      const spec = scatter3dSpec(FRAME, handle.getValues());

      expect(plotly.last().data).toEqual(spec.traces);
      expect(plotly.last().layout).toEqual(spec.layout);
    });

    test("carries a captured camera into the state it hands back", async () => {
      const { plot, handle } = await drawn();

      emitRelayout(plot, { "scene.camera": TURNED });
      const spec = scatter3dSpec(FRAME, handle.getValues());

      expect(handle.getValues().camera).toEqual(TURNED);
      expect(spec.layout.scene.camera).toEqual(TURNED);
    });

    test("reports what the last draw specified", async () => {
      const { plotly, handle } = await drawn();

      expect(plotly.last().data).toEqual(handle.getSpec()?.traces ?? []);
      expect(plotly.last().layout).toEqual(
        handle.getSpec()?.layout as PlotlyLayout,
      );
    });

    test("hands out a copy of the values", async () => {
      const { handle } = await drawn();

      const values = handle.getValues() as { x: string };
      values.x = "d";

      expect(handle.getValues().x).toBe("a");
    });
  });

  describe("the note about the column choice", () => {
    test("shows none, because the component names every axis", async () => {
      // R's gadget behaves the same way: `plot_scatter3d()` messages only
      // when it chooses the columns itself, and the gadget always passes
      // `input$x`, `input$y` and `input$z`. The choice is visible in the
      // pickers, which is more than a console message gives.
      const { handle, controls } = await drawn();

      expect(handle.getSpec()?.note).toBeNull();
      const note = controls.querySelector("p");
      expect(note).not.toBeNull();
      expect(note?.textContent).toBe("");
      expect(note?.hidden).toBe(true);
    });

    test("shows the pickers standing on the columns R would have chosen", async () => {
      const { controls } = await drawn();

      expect(
        ["x", "y", "z"].map((name) => picker(controls, name).value),
      ).toEqual(["a", "b", "c"]);
    });
  });

  describe("the camera", () => {
    test("listens to the element the plot drew into", async () => {
      const { plot } = await drawn();

      expect(listenerCount(plot)).toBe(1);
    });

    test("keeps a camera the user turned to, and re-passes it", async () => {
      const { plotly, plot, controls, handle } = await drawn();

      emitRelayout(plot, { "scene.camera": TURNED });
      await choose(handle, controls, "z", "d");

      expect(plotly.last().layout.scene.camera).toEqual(TURNED);
    });

    test("does not redraw when the user turns the plot", async () => {
      // Plotly has already moved the picture; R only stores the camera.
      const { plotly, plot, handle } = await drawn();

      emitRelayout(plot, { "scene.camera": TURNED });
      await handle.rendered();

      expect(plotly.calls).toHaveLength(1);
    });

    test("ignores a move that carries no camera", async () => {
      const { plot, handle } = await drawn();

      emitRelayout(plot, { "scene.aspectratio": { x: 1, y: 1, z: 1 } });
      expect(handle.getValues().camera).toBeUndefined();

      // The contrast: a move that does carry one is kept, and a later move
      // without one leaves it standing.
      emitRelayout(plot, { "scene.camera": TURNED });
      emitRelayout(plot, { "scene.aspectratio": { x: 2, y: 2, z: 2 } });
      expect(handle.getValues().camera).toEqual(TURNED);
    });

    test("adds no second listener however often it redraws", async () => {
      const { plot, controls, handle } = await drawn();

      for (const value of ["4", "6", "8"]) {
        await moveSlider(handle, controls, "size", value);
      }

      expect(listenerCount(plot)).toBe(1);
    });

    test("persists a captured camera into the live layout", async () => {
      // Plotly's own modebar buttons (orbit, turntable, pan, zoom) relayout
      // the scene from the stored layout, and a dragged camera lives only in
      // the WebGL scene until it is written back. Without this push every
      // modebar click snapped the view to the default (user report,
      // 2026-07-31). The R gadget rides the same modebar and shares the
      // quirk; keeping the view is a deliberate deviation.
      const { plotly, plot } = await drawn();

      emitRelayout(plot, { "scene.camera": TURNED });

      expect(plotly.relayouts).toHaveLength(1);
      expect(plotly.relayouts[0]?.element).toBe(plot);
      expect(plotly.relayouts[0]?.update).toEqual({ "scene.camera": TURNED });
    });

    test("does not persist the echo of its own push", async () => {
      // The persisting relayout itself fires plotly_relayout with the same
      // camera. Pushing again on that echo would relayout without end. The
      // echo is a fresh object carrying the same numbers, so the comparison
      // must be by value, not by reference.
      const { plotly, plot } = await drawn();

      emitRelayout(plot, { "scene.camera": TURNED });
      emitRelayout(plot, { "scene.camera": { eye: { x: 0.5, y: -1.5, z: 0.75 } } });

      expect(plotly.relayouts).toHaveLength(1);
    });

    test("persists each new view the user turns to", async () => {
      const { plotly, plot, handle } = await drawn();

      emitRelayout(plot, { "scene.camera": TURNED });
      emitRelayout(plot, { "scene.camera": FURTHER });

      expect(plotly.relayouts.map((call) => call.update)).toEqual([
        { "scene.camera": TURNED },
        { "scene.camera": FURTHER },
      ]);
      expect(handle.getValues().camera).toEqual(FURTHER);
    });
  });

  describe("the handle", () => {
    test("hands the current state to onDone", async () => {
      let seen: unknown = null;
      const { controls, handle } = await drawn({
        onDone: (values) => {
          seen = values;
        },
      });

      await choose(handle, controls, "color", "grp");
      handle.done();

      expect(seen).toEqual(handle.getValues());
      expect((seen as Scatter3dValues).color).toBe("grp");
    });

    test("hands back no camera unless one was supplied or turned to", async () => {
      // R: "camera is NULL unless the user rotated or zoomed during the
      // session (or supplied an initial camera)".
      let seen: unknown = null;
      const { plot, handle } = await drawn({
        onDone: (values) => {
          seen = values;
        },
      });

      handle.done();
      expect((seen as Scatter3dValues).camera).toBeUndefined();

      emitRelayout(plot, { "scene.camera": TURNED });
      handle.done();
      expect((seen as Scatter3dValues).camera).toEqual(TURNED);
    });

    test("does nothing on done without a callback", async () => {
      const { plotly, controls, handle } = await drawn();
      await choose(handle, controls, "x", "d");

      expect(() => handle.done()).not.toThrow();
      // Done reports; it does not draw, and it changes nothing.
      expect(plotly.calls).toHaveLength(2);
      expect(handle.getValues().x).toBe("d");
    });

    test("keeps running after done, as nothing in a browser blocks", async () => {
      const { plotly, controls, handle } = await drawn();

      handle.done();
      await moveSlider(handle, controls, "size", "3");

      expect(plotly.calls).toHaveLength(2);
      expect(handle.getValues().size).toBe(3);
    });

    test("stops redrawing once destroyed", async () => {
      const { plotly, controls, handle } = await drawn();
      // Hold the control first: destroying takes it back out.
      const input = slider(controls, "size");

      handle.destroy();
      setControl(input, "3", "input");
      await settle();

      expect(plotly.calls).toHaveLength(1);
    });

    test("purges the plot and drops the camera listener when destroyed", async () => {
      const { plotly, plot, handle } = await drawn();

      handle.destroy();

      expect(plotly.purged).toEqual([plot]);
      expect(listenerCount(plot)).toBe(0);
    });

    test("takes back every control it built", async () => {
      const { controls, handle } = await drawn();
      expect(controls.children.length).toBeGreaterThan(0);

      handle.destroy();

      expect(controls.children).toHaveLength(0);
    });

    test("survives being destroyed twice", async () => {
      const { plotly, handle } = await drawn();

      handle.destroy();

      expect(() => handle.destroy()).not.toThrow();
      expect(plotly.purged).toHaveLength(1);
    });

    test("still reports the last state after being destroyed", async () => {
      const { controls, handle } = await drawn();

      await choose(handle, controls, "x", "d");
      handle.destroy();

      expect(handle.getValues().x).toBe("d");
      expect(handle.getSpec()).not.toBeNull();
    });

    /**
     * A slider fires an event for every step of a drag, so a listener added
     * per redraw would pile up unseen. Returning to a value already drawn
     * must cost exactly what it cost the first time.
     */
    test("does not pile up listeners or controls while a slider is dragged", async () => {
      const { plotly, controls, handle } = await drawn();
      const children = controls.children.length;

      for (let visit = 0; visit < 10; visit += 1) {
        await moveSlider(handle, controls, "size", "6");
        await moveSlider(handle, controls, "size", "7");
      }

      expect(plotly.calls).toHaveLength(21);
      expect(controls.children).toHaveLength(children);
    });
  });

  describe("overlapping draws", () => {
    test("never asks the engine to draw twice at once", async () => {
      const engine = new SlowPlotly();
      const plot = asPlotlyElement(document.createElement("div"));
      const controls = document.createElement("div");
      const handle = interactiveScatter3d({ plot, controls }, FRAME, {
        plotly: engine,
      });

      setControl(slider(controls, "size"), "6", "input");
      setControl(slider(controls, "size"), "7", "input");
      await settle();

      expect(engine.calls).toHaveLength(1);
      expect(engine.inFlight).toBe(1);
      handle.destroy();
    });

    test("paints a burst once more, at the last value the user chose", async () => {
      const engine = new SlowPlotly();
      const plot = asPlotlyElement(document.createElement("div"));
      const controls = document.createElement("div");
      const handle = interactiveScatter3d({ plot, controls }, FRAME, {
        plotly: engine,
      });

      // A drag: three steps while the first picture is still being drawn.
      for (const value of ["6", "7", "8"]) {
        setControl(slider(controls, "size"), value, "input");
      }
      engine.release();
      await settle();
      engine.release();
      await handle.rendered();

      expect(engine.calls).toHaveLength(2);
      const sizes = engine.calls.map(
        (call) => (call.data as Scatter3dTrace[])[0]?.marker.size,
      );
      expect(sizes).toEqual([5, 8]);
      handle.destroy();
    });
  });

  describe("mounting into a container", () => {
    test("fills a container with a plot element and a strip of controls", async () => {
      const container = document.createElement("div");
      const plotly = new RecordingPlotly();

      const handle = interactiveScatter3d(container, FRAME, { plotly });
      await handle.rendered();

      expect(container.children).toHaveLength(2);
      expect(container.querySelectorAll("select")).toHaveLength(4);
      expect(container.querySelectorAll('input[type="range"]')).toHaveLength(5);
      expect(plotly.last().element.parentElement).toBe(container);
      handle.destroy();
    });

    test("takes back everything it built when destroyed", async () => {
      const container = document.createElement("div");
      const plotly = new RecordingPlotly();
      const handle = interactiveScatter3d(container, FRAME, { plotly });
      await handle.rendered();
      expect(container.children).toHaveLength(2);
      expect(container.querySelectorAll("select")).toHaveLength(4);

      handle.destroy();

      expect(container.children).toHaveLength(0);
      expect(plotly.purged).toHaveLength(1);
    });

    test("refuses a canvas, which Plotly cannot draw into", () => {
      const canvas = document.createElement("canvas");

      expect(() =>
        interactiveScatter3d(canvas, FRAME, { plotly: new RecordingPlotly() }),
      ).toThrow(/container element/);
    });
  });
});
