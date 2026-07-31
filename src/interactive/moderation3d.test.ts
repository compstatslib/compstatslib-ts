/**
 * Tests for the interactive moderation surface.
 *
 * The component owns two rotation sliders and hands every draw to
 * `plotModeration3d`, which is tested on its own. These tests check the
 * controls, the state, and how a rotation reaches the drawn plot.
 *
 * The controls come from `../compstatslib/R/moderation_3d_interactive.R`:
 *
 * ```r
 * shiny::sliderInput("z_rot", "Z rotation", min = 0, max = 360, value = 40)
 * shiny::sliderInput("x_rot", "X rotation", min = -90, max = -70, value = -70)
 * output$wire <- shiny::renderPlot({ ... plot_moderation_3d(..., z_rot, x_rot) })
 * shiny::observeEvent(input$done, { shiny::stopApp(invisible(data)) })
 * ```
 *
 * R's help states what the sliders teach: "Try 0 to align the IV slope plane
 * with the screen, or 270 to align the moderator slope plane." That is why the
 * sliders are kept in a browser that can already drag the camera freely.
 *
 * **Why a slider must push the camera at the plot.** The plot layer sets a
 * constant `uirevision`, which is what keeps a user's drag across a redraw.
 * Plotly honours that literally: once the user has turned the plot, a later
 * `react` carrying a different `scene.camera` is ignored, because the user's
 * own edit wins. A slider would then move nothing. So a rotation change is
 * sent as a `relayout`, which is an instruction rather than a preference, and
 * every other redraw leaves the camera alone. The tests pin both halves: what
 * a slider change sends, and what a redraw that changes no rotation does not.
 */

import { describe, expect, test } from "bun:test";

import { RecordingPlotly, asPlotlyElement } from "../../test/recording-plotly";
import type { RecordedListeners } from "../../test/recording-plotly";
import { moderationSurface } from "../core/moderation";
import { moderationData } from "../data/moderationData";
import { cameraFromRotations, moderation3dSpec } from "../plot/moderation3d";
import type {
  PlotlyCamera,
  PlotlyRelayoutEvent,
  SurfaceTrace,
} from "../plot/plotly";
import { interactiveModeration3d } from "./moderation3d";
import type {
  InteractiveModeration3dOptions,
  Moderation3dValues,
} from "./moderation3d";

const MODEL = { outcome: "y", iv: "x", mod: "z" } as const;

/** Build the component against a recording engine and a split target. */
function setup(options: Partial<InteractiveModeration3dOptions> = {}) {
  const plotly = new RecordingPlotly();
  const plot = asPlotlyElement(document.createElement("div"));
  const controls = document.createElement("div");
  const handle = interactiveModeration3d({ plot, controls }, moderationData, {
    ...MODEL,
    plotly,
    ...options,
  });
  return { plotly, plot, controls, handle };
}

/** Build the component and wait for its first picture. */
async function drawn(options: Partial<InteractiveModeration3dOptions> = {}) {
  const parts = setup(options);
  await parts.handle.rendered();
  return parts;
}

function slider(controls: HTMLElement, name: string): HTMLInputElement {
  const found = controls.querySelector(`input[name="${name}"]`);
  expect(found).not.toBeNull();
  return found as HTMLInputElement;
}

/** Move a slider and wait for the redraw it asks for. */
async function moveSlider(
  handle: { rendered(): Promise<void> },
  controls: HTMLElement,
  name: string,
  value: string,
): Promise<void> {
  const input = slider(controls, name);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
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

/** A camera as Plotly reports one after the user has dragged the plot. */
const DRAGGED: PlotlyCamera = { eye: { x: 1.5, y: 0.25, z: -0.5 } };

describe("interactiveModeration3d", () => {
  describe("the control panel", () => {
    test("builds R's two rotation sliders, in R's order", async () => {
      const { controls } = await drawn();
      const inputs = [
        ...controls.querySelectorAll('input[type="range"]'),
      ] as HTMLInputElement[];

      expect(inputs.map((input) => input.name)).toEqual(["zRot", "xRot"]);
    });

    test("gives each slider R's range, step, and starting value", async () => {
      const { controls } = await drawn();

      const zRot = slider(controls, "zRot");
      expect(zRot.min).toBe("0");
      expect(zRot.max).toBe("360");
      expect(zRot.step).toBe("1");
      expect(zRot.value).toBe("40");

      const xRot = slider(controls, "xRot");
      expect(xRot.min).toBe("-90");
      expect(xRot.max).toBe("-70");
      expect(xRot.step).toBe("1");
      expect(xRot.value).toBe("-70");
    });

    test("labels the sliders as R labels them", async () => {
      const { controls } = await drawn();
      const text = controls.textContent ?? "";

      expect(text).toContain("Z rotation");
      expect(text).toContain("X rotation");
    });

    test("shows the value beside a slider that moved", async () => {
      const { controls, handle } = await drawn();

      await moveSlider(handle, controls, "zRot", "270");

      expect(controls.textContent).toContain("270");
    });

    test("starts at the rotations the caller gave", async () => {
      const { controls, handle } = await drawn({ zRot: 270, xRot: -85 });

      expect(slider(controls, "zRot").value).toBe("270");
      expect(slider(controls, "xRot").value).toBe("-85");
      expect(handle.getValues().zRot).toBe(270);
      expect(handle.getValues().xRot).toBe(-85);
    });

    test("clamps and snaps a starting rotation the slider cannot stand at", async () => {
      const { controls, handle } = await drawn({ zRot: 400.6, xRot: -100 });

      expect(handle.getValues().zRot).toBe(360);
      expect(handle.getValues().xRot).toBe(-90);
      expect(slider(controls, "zRot").value).toBe("360");
      expect(slider(controls, "xRot").value).toBe("-90");
    });

    test("snaps a rotation that misses the step", async () => {
      const { controls, handle } = await drawn({ zRot: 40.6 });

      expect(handle.getValues().zRot).toBe(41);
      expect(slider(controls, "zRot").value).toBe("41");
    });
  });

  describe("drawing", () => {
    test("draws once, into the plot element, as soon as it starts", async () => {
      const { plotly, plot } = await drawn();

      expect(plotly.calls).toHaveLength(1);
      expect(plotly.last().element).toBe(plot);
    });

    test("draws what the plot layer draws for the same options", async () => {
      const { plotly } = await drawn();
      const surface = moderationSurface(moderationData, MODEL);
      const spec = moderation3dSpec(surface, MODEL, { zRot: 40, xRot: -70 });

      expect(plotly.last().data).toEqual(spec.traces);
      expect(plotly.last().layout).toEqual(spec.layout);
    });

    test("draws through the plot function, not with drawing of its own", async () => {
      const { plotly } = await drawn();
      const trace = plotly.last().data[0] as SurfaceTrace;

      expect(plotly.last().layout.uirevision).toBe("moderation3d");
      expect(trace.type).toBe("surface");
      expect(trace.z).toHaveLength(15);
    });

    test("forwards every model option to the plot untouched", async () => {
      const { plotly, handle } = await drawn({
        controls: ["w"],
        interaction: false,
        zlim: [-10, 10],
      });
      const surface = moderationSurface(moderationData, {
        ...MODEL,
        controls: ["w"],
        interaction: false,
      });

      expect(plotly.last().layout.scene.zaxis.range).toEqual([-10, 10]);
      expect(plotly.last().data).toEqual(
        moderation3dSpec(surface, MODEL, { zRot: 40, xRot: -70 }).traces,
      );
      expect(handle.getSurface()?.coefficients).toEqual(surface.coefficients);
    });

    test("redraws when a rotation slider moves", async () => {
      const { plotly, controls, handle } = await drawn();

      await moveSlider(handle, controls, "zRot", "270");
      await moveSlider(handle, controls, "xRot", "-80");

      expect(plotly.calls).toHaveLength(3);
      expect(handle.getValues().zRot).toBe(270);
      expect(handle.getValues().xRot).toBe(-80);
    });

    test("keeps the uirevision, so a free drag survives every redraw", async () => {
      const { plotly, controls, handle } = await drawn();

      await moveSlider(handle, controls, "zRot", "100");

      const revisions = plotly.calls.map((call) => call.layout.uirevision);
      expect(new Set(revisions).size).toBe(1);
      expect(
        new Set(plotly.calls.map((call) => call.layout.scene.uirevision)).size,
      ).toBe(1);
    });
  });

  describe("the rotation the sliders ask for", () => {
    test("sends no camera instruction on the first picture", async () => {
      // Nothing has been drawn yet, so the layout's own camera applies.
      const { plotly } = await drawn();

      expect(plotly.relayouts).toHaveLength(0);
      expect(plotly.last().layout.scene.camera).toEqual(
        cameraFromRotations(40, -70),
      );
    });

    test("pushes the new camera at the plot when a slider moves", async () => {
      // A `react` alone would be ignored once the user has dragged the plot:
      // the constant uirevision keeps the user's own camera.
      const { plotly, controls, handle } = await drawn();

      await moveSlider(handle, controls, "zRot", "270");

      expect(plotly.relayouts).toHaveLength(1);
      expect(plotly.relayouts[0]?.update).toEqual({
        "scene.camera": cameraFromRotations(270, -70),
      });
    });

    test("pushes it after the redraw, not before", async () => {
      const { plotly, controls, handle } = await drawn();

      await moveSlider(handle, controls, "xRot", "-75");

      expect(plotly.log).toEqual(["react", "react", "relayout"]);
    });

    test("pushes it at the element the plot drew into", async () => {
      const { plotly, plot, controls, handle } = await drawn();

      await moveSlider(handle, controls, "zRot", "10");

      expect(plotly.relayouts[0]?.element).toBe(plot);
    });

    test("sends nothing when a redraw carries the rotations already drawn", async () => {
      // A drag reports the value it started from, and a redraw for any other
      // reason must leave the user's own view alone.
      const { plotly, controls, handle } = await drawn();

      await moveSlider(handle, controls, "zRot", "40");

      expect(plotly.calls).toHaveLength(2);
      expect(plotly.relayouts).toHaveLength(0);
    });

    test("follows the sliders back and forth", async () => {
      const { plotly, controls, handle } = await drawn();

      await moveSlider(handle, controls, "zRot", "0");
      await moveSlider(handle, controls, "zRot", "270");

      expect(plotly.relayouts.map((call) => call.update)).toEqual([
        { "scene.camera": cameraFromRotations(0, -70) },
        { "scene.camera": cameraFromRotations(270, -70) },
      ]);
    });
  });

  describe("the camera the user drags to", () => {
    test("listens to the element the plot drew into", async () => {
      const { plot } = await drawn();

      expect(listenerCount(plot)).toBe(1);
    });

    test("persists a dragged camera into the live layout", async () => {
      // Plotly's own modebar buttons (orbit, turntable, pan, zoom) relayout
      // the scene from the stored layout, whose camera is the sliders' one.
      // A drag lives only in the WebGL scene until it is written back, so
      // without this push every modebar click snapped the view to the
      // sliders' angles (user report, 2026-07-31). R cannot show the quirk —
      // lattice has no mouse rotation at all — so there is nothing to be
      // faithful to; keeping the view wins.
      const { plotly, plot } = await drawn();

      emitRelayout(plot, { "scene.camera": DRAGGED });

      expect(plotly.relayouts).toHaveLength(1);
      expect(plotly.relayouts[0]?.element).toBe(plot);
      expect(plotly.relayouts[0]?.update).toEqual({ "scene.camera": DRAGGED });
    });

    test("does not persist the echo of its own push", async () => {
      // The persisting relayout itself fires plotly_relayout with the same
      // camera as a fresh object. Pushing again on that echo would relayout
      // without end, so the comparison must be by value.
      const { plotly, plot } = await drawn();

      emitRelayout(plot, { "scene.camera": DRAGGED });
      emitRelayout(plot, {
        "scene.camera": { eye: { x: 1.5, y: 0.25, z: -0.5 } },
      });

      expect(plotly.relayouts).toHaveLength(1);
    });

    test("does not persist the echo of a slider's own push", async () => {
      const { plotly, plot, controls, handle } = await drawn();

      await moveSlider(handle, controls, "zRot", "270");
      expect(plotly.relayouts).toHaveLength(1);

      emitRelayout(plot, { "scene.camera": cameraFromRotations(270, -70) });

      expect(plotly.relayouts).toHaveLength(1);
    });

    test("lets a slider override the drag, as the module documents", async () => {
      const { plotly, plot, controls, handle } = await drawn();

      emitRelayout(plot, { "scene.camera": DRAGGED });
      await moveSlider(handle, controls, "zRot", "270");

      expect(plotly.relayouts.map((call) => call.update)).toEqual([
        { "scene.camera": DRAGGED },
        { "scene.camera": cameraFromRotations(270, -70) },
      ]);
    });

    test("re-persists the drag across a redraw that asks for no new view", async () => {
      // Such a redraw reacts with the sliders' camera in its layout while
      // the screen keeps the drag (uirevision). Plotly's stored layout would
      // then disagree with the view on screen, and the next modebar click
      // would snap to the sliders' angles after all.
      const { plotly, plot, controls, handle } = await drawn();

      emitRelayout(plot, { "scene.camera": DRAGGED });
      await moveSlider(handle, controls, "zRot", "40");

      expect(plotly.relayouts.map((call) => call.update)).toEqual([
        { "scene.camera": DRAGGED },
        { "scene.camera": DRAGGED },
      ]);
    });

    test("ignores a move that carries no camera", async () => {
      const { plotly, plot } = await drawn();

      emitRelayout(plot, { "scene.dragmode": "orbit" });

      expect(plotly.relayouts).toHaveLength(0);
    });

    test("stops listening on destroy", async () => {
      const { plot, handle } = await drawn();

      handle.destroy();

      expect(listenerCount(plot)).toBe(0);
    });
  });

  describe("the note about held predictors", () => {
    test("shows what R messages when a predictor is held off the axes", async () => {
      const { controls, handle } = await drawn({ controls: ["w"] });
      const note = controls.querySelector("p");

      expect(note?.textContent).toBe(
        "Surface shows predicted y over x and z. " +
          "Other predictors are held at their typical values.",
      );
      expect(note?.hidden).toBe(false);
      expect(handle.getSpec()?.note).toBe(note?.textContent ?? null);
    });

    test("says it once, however often the picture is redrawn", async () => {
      // R messages on the first render only. The note here is one element
      // whose text is replaced, so a redraw cannot pile the sentence up.
      const { controls, handle } = await drawn({ controls: ["w"] });

      await moveSlider(handle, controls, "zRot", "90");
      await moveSlider(handle, controls, "zRot", "180");

      expect(controls.querySelectorAll("p")).toHaveLength(1);
      expect(controls.querySelector("p")?.textContent).toContain(
        "held at their typical values",
      );
    });

    test("stays empty when every predictor is on the plot", async () => {
      const { controls, handle } = await drawn();
      const note = controls.querySelector("p");

      expect(handle.getSpec()?.note).toBeNull();
      expect(note?.textContent).toBe("");
      expect(note?.hidden).toBe(true);
    });
  });

  describe("the handle", () => {
    test("reports the rotations and the model it is drawing", async () => {
      const { controls, handle } = await drawn({ controls: ["w"] });

      await moveSlider(handle, controls, "zRot", "270");

      expect(handle.getValues()).toEqual({
        outcome: "y",
        iv: "x",
        mod: "z",
        controls: ["w"],
        zRot: 270,
        xRot: -70,
      } as Moderation3dValues);
    });

    test("hands out a copy of the values", async () => {
      const { controls, handle } = await drawn();
      await moveSlider(handle, controls, "zRot", "270");

      const values = handle.getValues() as { zRot: number };
      values.zRot = 999;

      expect(handle.getValues().zRot).toBe(270);
    });

    test("reports the surface the last picture was drawn from", async () => {
      const { handle } = await drawn();
      const surface = moderationSurface(moderationData, MODEL);

      expect(handle.getSurface()?.coefficients).toEqual(surface.coefficients);
      expect(handle.getSurface()?.predictions).toEqual(surface.predictions);
    });

    test("hands the current values to onDone", async () => {
      let seen: unknown = null;
      const { controls, handle } = await drawn({
        onDone: (values) => {
          seen = values;
        },
      });

      await moveSlider(handle, controls, "xRot", "-88");
      handle.done();

      expect(seen).toEqual(handle.getValues());
      expect((seen as Moderation3dValues).xRot).toBe(-88);
    });

    test("does nothing on done without a callback", async () => {
      const { plotly, controls, handle } = await drawn();
      await moveSlider(handle, controls, "zRot", "120");

      expect(() => handle.done()).not.toThrow();
      // Done reports; it does not draw, and it changes nothing.
      expect(plotly.calls).toHaveLength(2);
      expect(handle.getValues().zRot).toBe(120);
    });

    test("keeps running after done, as nothing in a browser blocks", async () => {
      const { plotly, controls, handle } = await drawn();

      handle.done();
      await moveSlider(handle, controls, "zRot", "200");

      expect(plotly.calls).toHaveLength(2);
      expect(handle.getValues().zRot).toBe(200);
    });

    test("stops redrawing once destroyed", async () => {
      const { plotly, controls, handle } = await drawn();
      // Hold the control first: destroying takes it back out.
      const input = slider(controls, "zRot");

      handle.destroy();
      input.value = "300";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await handle.rendered();

      expect(plotly.calls).toHaveLength(1);
    });

    test("purges the plot and takes back its controls when destroyed", async () => {
      const { plotly, plot, controls, handle } = await drawn();
      expect(controls.children.length).toBeGreaterThan(0);

      handle.destroy();

      expect(plotly.purged).toEqual([plot]);
      expect(controls.children).toHaveLength(0);
    });

    test("survives being destroyed twice", async () => {
      const { plotly, handle } = await drawn();

      handle.destroy();

      expect(() => handle.destroy()).not.toThrow();
      expect(plotly.purged).toHaveLength(1);
    });

    test("does not pile up listeners or controls while a slider is dragged", async () => {
      const { plotly, controls, handle } = await drawn();
      const children = controls.children.length;

      for (let visit = 0; visit < 10; visit += 1) {
        await moveSlider(handle, controls, "zRot", "80");
        await moveSlider(handle, controls, "zRot", "90");
      }

      expect(plotly.calls).toHaveLength(21);
      expect(controls.children).toHaveLength(children);
    });
  });

  describe("mounting into a container", () => {
    test("fills a container with a plot element and a strip of controls", async () => {
      const container = document.createElement("div");
      const plotly = new RecordingPlotly();

      const handle = interactiveModeration3d(container, moderationData, {
        ...MODEL,
        plotly,
      });
      await handle.rendered();

      expect(container.children).toHaveLength(2);
      expect(container.querySelectorAll('input[type="range"]')).toHaveLength(2);
      expect(plotly.last().element.parentElement).toBe(container);
      handle.destroy();
    });

    test("takes back everything it built when destroyed", async () => {
      const container = document.createElement("div");
      const plotly = new RecordingPlotly();
      const handle = interactiveModeration3d(container, moderationData, {
        ...MODEL,
        plotly,
      });
      await handle.rendered();
      expect(container.children).toHaveLength(2);
      expect(container.querySelectorAll('input[type="range"]')).toHaveLength(2);

      handle.destroy();

      expect(container.children).toHaveLength(0);
      expect(plotly.purged).toHaveLength(1);
    });

    test("refuses a canvas, which Plotly cannot draw into", () => {
      const canvas = document.createElement("canvas");

      expect(() =>
        interactiveModeration3d(canvas, moderationData, {
          ...MODEL,
          plotly: new RecordingPlotly(),
        }),
      ).toThrow(/container element/);
    });
  });
});
