/**
 * The interactive moderation surface: turn the wireframe and watch the twist
 * of the interaction appear and disappear.
 *
 * This is the port of `interactive_moderation_3d()` in
 * `../compstatslib/R/moderation_3d_interactive.R`. R builds a shiny gadget
 * with two rotation sliders and re-runs `plot_moderation_3d()` whenever one
 * moves. This module does the same: it owns the two sliders and hands every
 * draw to `plotModeration3d`. It fits nothing and draws nothing itself.
 *
 * Three things are worth knowing before reading the code.
 *
 * **The sliders are kept, although a browser can drag the camera.** They are
 * what R's help teaches with: "Try 0 to align the IV slope plane with the
 * screen, or 270 to align the moderator slope plane." A free drag cannot name
 * an angle, and those two angles are the lesson. Dragging still works, and
 * the two live together: a drag is preserved until a slider asks for
 * something else.
 *
 * **A slider must push the camera at the plot.** The plot layer sets a
 * constant `uirevision`, which is what keeps a drag across a redraw. Plotly
 * honours it literally: once the user has turned the plot, a later `react`
 * carrying a different `scene.camera` is ignored, because the user's own edit
 * wins. The sliders would then move nothing. So a rotation change is sent
 * after the redraw as a `relayout`, which is an instruction rather than a
 * preference. The alternative — changing the `uirevision` whenever a slider
 * moves — would have to reach into the layout the plot layer owns, and would
 * throw away the drag on every redraw whether or not the view changed.
 * Nothing new is pushed when the rotations have not moved, so a redraw for
 * any other reason leaves the user's own view alone. The one other push this
 * component makes runs the opposite way: a camera the user drags to is
 * written back into Plotly's stored layout (see `handleRelayout`), because
 * the modebar's own buttons relayout the scene from that layout and would
 * otherwise snap the view to the sliders' angles.
 *
 * **Done hands back the current view.** R returns `data`, which the caller
 * already holds and which says nothing about the picture. The rotations do,
 * and together with the model they reopen the same plot — the same choice the
 * t-test component made for the same reason.
 *
 * There is no Reset: R has Done and Cancel only. There is no validation of
 * the model here either. R's gadget opens and lets `plot_moderation_3d()`
 * report a bad column in the plot pane; the port's equivalent is a rejected
 * `rendered()`, so a caller that wants to hear about it must await.
 */

import type { DataFrame } from "../core/frame";
import type { ModerationOptions, ModerationSurface } from "../core/moderation";
import { plotModeration3d } from "../plot/moderation3d";
import type {
  Moderation3dSpec,
  Moderation3dViewOptions,
  PlotModeration3dOptions,
} from "../plot/moderation3d";
import { sameCamera } from "../plot/plotly";
import type {
  PlotlyCamera,
  PlotlyHTMLElement,
  PlotlyLike,
  PlotlyRelayoutEvent,
} from "../plot/plotly";
import { buildNote, buildSlider, startingSliderValue } from "./controls";
import type { SliderRange } from "./controls";
import { resolvePlot3dTarget } from "./target";
import type { Plot3dTarget } from "./target";

/**
 * Everything the panel holds: the two rotations, and the model behind the
 * surface. Hand it back to `interactiveModeration3d` or to
 * `plotModeration3d` to reopen the same picture.
 */
export interface Moderation3dValues
  extends ModerationOptions,
    Moderation3dViewOptions {
  /** The turn about the vertical axis, in degrees. */
  readonly zRot: number;
  /** The tilt, in degrees. */
  readonly xRot: number;
}

/**
 * What the component accepts.
 *
 * Every option of `plotModeration3d` is a starting value, and anything the
 * plot grows later reaches it untouched. The model itself — which column is
 * the outcome, the IV and the moderator — is required, as it is by the plot.
 */
export interface InteractiveModeration3dOptions
  extends PlotModeration3dOptions {
  /** What to run on `done()`. */
  readonly onDone?: (values: Moderation3dValues) => void;
}

/** What the caller holds after the component starts. */
export interface InteractiveModeration3dHandle {
  /** Return the rotations the sliders stand at, and the model being drawn. */
  getValues(): Moderation3dValues;
  /** Return the fit and the grid behind the last picture. */
  getSurface(): ModerationSurface | null;
  /** Return the traces, the layout, and the note of the last draw. */
  getSpec(): Moderation3dSpec | null;
  /** Wait for the drawing now in flight. Drawing is asynchronous. */
  rendered(): Promise<void>;
  /** Hand the current values to the `onDone` callback. */
  done(): void;
  /** Stop listening, purge the plot, and take back what was built. */
  destroy(): void;
}

/** R: `sliderInput("z_rot", "Z rotation", min = 0, max = 360, value = 40)`. */
const Z_ROT_RANGE: SliderRange = { min: 0, max: 360, step: 1 };
/**
 * R: `sliderInput("x_rot", "X rotation", min = -90, max = -70, value = -70)`.
 */
const X_ROT_RANGE: SliderRange = { min: -90, max: -70, step: 1 };
/** R's own starting angles, from the same two `sliderInput` calls. */
const DEFAULT_Z_ROT = 40;
const DEFAULT_X_ROT = -70;

/** The two sliders, in R's order. */
const SLIDERS = [
  {
    name: "zRot",
    label: "Z rotation",
    range: Z_ROT_RANGE,
    fallback: DEFAULT_Z_ROT,
  },
  {
    name: "xRot",
    label: "X rotation",
    range: X_ROT_RANGE,
    fallback: DEFAULT_X_ROT,
  },
] as const;

/**
 * Start an interactive moderation surface on a target.
 *
 * The component builds its two sliders, draws once, and redraws on every
 * change.
 *
 * @param target A container element, or a plot element and a controls host.
 *   See `./target.ts`.
 * @param data The frame holding every column the model names.
 * @param options The model, the starting rotations, a done callback, and the
 *   options of `plotModeration3d`.
 * @returns The handle to the running component. Await `rendered()` for the
 *   first picture, and to hear about a model the data cannot carry.
 * @throws Error If a canvas is passed as the container.
 */
export function interactiveModeration3d(
  target: Plot3dTarget,
  data: DataFrame,
  options: InteractiveModeration3dOptions,
): InteractiveModeration3dHandle {
  // Everything `plotModeration3d` may grow later stays in `model` and reaches
  // it untouched, so a new plot option needs no edit here.
  const { plotly: givenEngine, onDone, zRot, xRot, ...model } = options;

  const panel = resolvePlot3dTarget(target);
  const owner = panel.controls.ownerDocument;

  let values: Moderation3dValues = {
    ...model,
    zRot: startingSliderValue(zRot, DEFAULT_Z_ROT, Z_ROT_RANGE),
    xRot: startingSliderValue(xRot, DEFAULT_X_ROT, X_ROT_RANGE),
  };

  let spec: Moderation3dSpec | null = null;
  let surface: ModerationSurface | null = null;
  let engine: PlotlyLike | undefined = givenEngine;
  let element: PlotlyHTMLElement | null = null;
  /** The rotations the plot was last told to stand at, or null before then. */
  let painted: { readonly zRot: number; readonly xRot: number } | null = null;
  /**
   * The camera this component last put into Plotly's stored layout — by a
   * slider's push or by persisting a drag — or undefined before either. What
   * the capture handler compares against to recognize its own echo.
   */
  let seenCamera: PlotlyCamera | undefined;
  let listening = false;
  let destroyed = false;
  let inFlight: Promise<void> | null = null;
  let queued = false;

  const note = buildNote(owner);

  /**
   * Draw once, at whatever the sliders stand at now, and move the camera if
   * they ask for a view the plot is not already at.
   *
   * The camera pushed is the one the plot layer computed, read back out of
   * the layout it built. Nothing here works out where a camera goes.
   */
  async function renderOnce(): Promise<void> {
    const wanted = { zRot: values.zRot, xRot: values.xRot };
    const drawn = await plotModeration3d(panel.plot, data, {
      ...values,
      plotly: engine,
    });
    if (destroyed) {
      return;
    }

    engine = drawn.plotly;
    element = drawn.element;
    surface = drawn.surface;
    spec = { traces: drawn.traces, layout: drawn.layout, note: drawn.note };
    note.show(drawn.note);

    // One listener for the life of the component: Plotly hands back the same
    // element every time, so attaching per draw would pile them up.
    if (!listening) {
      listening = true;
      element.on("plotly_relayout", handleRelayout);
    }

    const moved =
      painted !== null &&
      (painted.zRot !== wanted.zRot || painted.xRot !== wanted.xRot);
    painted = wanted;

    const camera = drawn.layout.scene.camera;
    if (moved && camera !== undefined) {
      seenCamera = camera;
      await drawn.plotly.relayout(element, { "scene.camera": camera });
    } else if (seenCamera !== undefined && !sameCamera(seenCamera, camera)) {
      // A redraw that asked for no new view: the react above rewrote the
      // stored layout with the sliders' camera while the screen keeps the
      // user's drag (uirevision). Re-persist the drag, or Plotly's own
      // relayouts would rebuild at the sliders' angles after all.
      await drawn.plotly.relayout(element, { "scene.camera": seenCamera });
    }
  }

  /**
   * Persist a camera the user dragged to into Plotly's stored layout.
   *
   * Plotly's own modebar buttons (orbit, turntable, pan, zoom) relayout the
   * scene from that layout, and a drag lives only in the WebGL scene until it
   * is written back; without this, every modebar click snapped the view to
   * the sliders' angles. The push itself echoes through this handler with the
   * same camera as a fresh object, which is what the value comparison
   * recognizes and drops. The sliders stay in charge: their own pushes set
   * `seenCamera` first, so a slider still overrides any drag before it.
   */
  function handleRelayout(event: PlotlyRelayoutEvent): void {
    const moved = event["scene.camera"];
    if (moved === undefined || destroyed || sameCamera(moved, seenCamera)) {
      return;
    }
    seenCamera = moved;
    if (element !== null && engine !== undefined) {
      // Fire and forget: the picture is already at this view, so a failure
      // here (a plot purged mid-flight) has nothing to repair.
      engine.relayout(element, { "scene.camera": moved }).catch(() => undefined);
    }
  }

  /**
   * Draw, and never draw twice at once.
   *
   * A dragged slider fires an event for every step, and each draw is
   * asynchronous. A request that arrives while a draw is in flight is
   * remembered, not started, and the draw that follows reads the sliders as
   * they stand then: the last value wins, and the pictures cannot arrive out
   * of order.
   */
  function requestRender(): void {
    if (destroyed) {
      return;
    }
    queued = true;
    inFlight ??= start();
  }

  function start(): Promise<void> {
    const run = pump();
    // A caller that never awaits must not be handed an unhandled rejection;
    // `rendered()` still reports the failure to anyone who asks.
    run.catch(() => undefined);
    return run;
  }

  async function pump(): Promise<void> {
    try {
      while (queued && !destroyed) {
        queued = false;
        await renderOnce();
      }
    } finally {
      inFlight = null;
    }
  }

  function handleInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    // A slider keeps its own value inside the range and on the step, so what
    // it reports needs no correcting.
    values = { ...values, [input.name]: Number(input.value) };

    const readout = readouts.get(input.name);
    if (readout !== undefined) {
      readout.textContent = input.value;
    }
    requestRender();
  }

  const built: HTMLElement[] = [];
  const inputs: HTMLInputElement[] = [];
  const readouts = new Map<string, HTMLElement>();

  for (const slider of SLIDERS) {
    const control = buildSlider(
      owner,
      slider.name,
      slider.label,
      slider.range,
      values[slider.name],
    );
    panel.controls.appendChild(control.wrapper);
    built.push(control.wrapper);
    inputs.push(control.input);
    readouts.set(slider.name, control.readout);
    control.input.addEventListener("input", handleInput);
  }

  panel.controls.appendChild(note.element);
  built.push(note.element);

  // R's renderPlot runs as the gadget opens, at the initial settings.
  requestRender();

  return {
    getValues: () => ({ ...values }),
    getSurface: () => surface,
    getSpec: () => spec,
    rendered: () => inFlight ?? Promise.resolve(),
    done() {
      onDone?.({ ...values });
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      for (const input of inputs) {
        input.removeEventListener("input", handleInput);
      }
      for (const node of built) {
        node.remove();
      }
      if (element !== null) {
        element.removeAllListeners("plotly_relayout");
        engine?.purge(element);
      }
      panel.release();
    },
  };
}
