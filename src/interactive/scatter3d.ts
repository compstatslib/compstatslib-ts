/**
 * The interactive 3D scatterplot: choose the columns, set the style, turn the
 * cloud, and take the resulting call away with you.
 *
 * This is the port of `interactive_scatter3d()` in
 * `../compstatslib/R/scatter3d_interactive.R`. R builds a shiny gadget with
 * four pickers and five sliders and re-runs `plot_scatter3d()` on every
 * change. This module does the same: it owns the controls, the state in them,
 * and the camera the user turned to, and hands every draw to `plotScatter3d`.
 * It builds no trace and no layout of its own.
 *
 * Four things are worth knowing before reading the code.
 *
 * **Everything is checked before anything is built.** R validates the style,
 * then the axis arguments, then the frame, and only then opens the gadget, so
 * a bad argument leaves no window and no plot. The order and the wording here
 * are R's, and the style check is R's own function, imported from the plot
 * layer rather than written again.
 *
 * **Out of range is not the same as invalid.** R's check refuses a style no
 * plot could be drawn with — an opacity of 0, a negative aspect — and says
 * nothing about the bounds of its own sliders. `aspect = 12` passes it, and
 * the widget then clamps the handle to 10. So this component throws exactly
 * where R throws, and clamps and snaps where R's widget clamps.
 *
 * **The camera is captured, not computed.** Plotly reports where the user
 * turned the plot to through `plotly_relayout`; the component stores that
 * camera and re-passes it into every later draw, so that changing a column
 * does not throw the angle away. Turning the plot draws nothing: Plotly has
 * already moved the picture. The captured camera is also written back into
 * Plotly's own stored layout, because the modebar's buttons relayout the
 * scene from that layout and would otherwise snap the view to the default —
 * a Plotly quirk the R gadget shares, and one deliberate deviation here.
 *
 * **Done hands back a state, not a printed call.** R prints a copy-pasteable
 * `plot_scatter3d(...)` line to the console and returns the same arguments
 * invisibly. A library has no console, and a string would have to be parsed
 * to be used again; so `getValues()` returns the options object that
 * reproduces the picture, and `onDone` receives it. Feeding it back to
 * `plotScatter3d` — or to this function — is R's `do.call` equivalent.
 *
 * One R behavior is absent for R's own reason: the gadget shows no message
 * about the column choice. `plot_scatter3d()` writes one when it picks the
 * columns itself, and neither gadget lets it: R passes `input$x`, `input$y`
 * and `input$z` on every render, as this component passes its own state. The
 * choice is visible in the pickers instead.
 */

import { numericColumns, requireThreeNumericColumns } from "../core/frame";
import type { DataFrame } from "../core/frame";
import {
  DEFAULT_SCATTER3D_STYLE,
  plotScatter3d,
  validateScatter3dStyle,
} from "../plot/scatter3d";
import type {
  PlotScatter3dOptions,
  Scatter3dSpec,
  Scatter3dSpecOptions,
} from "../plot/scatter3d";
import { sameCamera } from "../plot/plotly";
import type {
  PlotlyHTMLElement,
  PlotlyLike,
  PlotlyRelayoutEvent,
} from "../plot/plotly";
import {
  buildNote,
  buildSelect,
  buildSlider,
  startingSliderValue,
} from "./controls";
import type { SliderRange } from "./controls";
import { resolvePlot3dTarget } from "./target";
import type { Plot3dTarget } from "./target";

/**
 * Everything the panel holds, and everything that reproduces the picture.
 *
 * This is `Scatter3dSpecOptions` with the parts the gadget always settles —
 * the three axes and the three style numbers — made certain. Hand it to
 * `plotScatter3d`, or back to `interactiveScatter3d`, to open at the same
 * view. It is the port's answer to the call R prints on Done.
 */
export interface Scatter3dValues extends Scatter3dSpecOptions {
  /** The column on the first horizontal axis. */
  readonly x: string;
  /** The column on the second horizontal axis. */
  readonly y: string;
  /** The column on the vertical axis. */
  readonly z: string;
  /** The three axis proportions. */
  readonly aspect: readonly number[];
  /** How solid each marker is. */
  readonly opacity: number;
  /** How large each marker is. */
  readonly size: number;
}

/**
 * What the component accepts.
 *
 * Every option of `plotScatter3d` is a starting value, exactly as in R, and
 * anything the plot grows later reaches it untouched.
 */
export interface InteractiveScatter3dOptions extends PlotScatter3dOptions {
  /** What to run on `done()`. */
  readonly onDone?: (values: Scatter3dValues) => void;
}

/** What the caller holds after the component starts. */
export interface InteractiveScatter3dHandle {
  /**
   * Return the state the panel stands at: the options that reproduce the
   * picture, including a camera the user turned to.
   */
  getValues(): Scatter3dValues;
  /**
   * Return what the last draw specified — its traces, its layout, and the
   * plot layer's note. Null until the first picture is drawn.
   */
  getSpec(): Scatter3dSpec | null;
  /**
   * Wait for the drawing now in flight. Drawing is asynchronous, so this is
   * how a caller — or a test — knows the picture is on the screen.
   */
  rendered(): Promise<void>;
  /** Hand the current state to the `onDone` callback. */
  done(): void;
  /** Stop listening, purge the plot, and take back what was built. */
  destroy(): void;
}

/** R's `choices = c("(none)", names(data))` sentinel for no color. */
const NONE = "(none)";

/** R: `sliderInput("aspect_x", "Aspect X", min = 0.1, max = 10, step = .1)`. */
const ASPECT_RANGE: SliderRange = { min: 0.1, max: 10, step: 0.1 };
/** R: `sliderInput("opacity", "Opacity", min = 0.05, max = 1, step = 0.05)`. */
const OPACITY_RANGE: SliderRange = { min: 0.05, max: 1, step: 0.05 };
/** R: `sliderInput("size", "Size", min = 1, max = 20, step = 1)`. */
const SIZE_RANGE: SliderRange = { min: 1, max: 20, step: 1 };

/** The three aspect sliders, in R's order, with the axis each one drives. */
const ASPECT_SLIDERS = [
  { name: "aspectX", label: "Aspect X" },
  { name: "aspectY", label: "Aspect Y" },
  { name: "aspectZ", label: "Aspect Z" },
] as const;

/**
 * Start an interactive 3D scatterplot on a target.
 *
 * The component builds its controls, draws once, and redraws on every change.
 *
 * @param target A container element, or a plot element and a controls host.
 *   See `./target.ts`.
 * @param data The frame to read. It needs three numeric columns.
 * @param options Starting values, a done callback, and the options of
 *   `plotScatter3d`.
 * @returns The handle to the running component. Await `rendered()` for the
 *   first picture.
 * @throws RangeError If the style is one no plot could be drawn with, if the
 *   frame has fewer than three numeric columns, or if an initial column is
 *   not one the picker could stand on. Nothing is built and nothing is drawn
 *   in any of those cases.
 * @throws Error If a canvas is passed as the container.
 */
export function interactiveScatter3d(
  target: Plot3dTarget,
  data: DataFrame,
  options: InteractiveScatter3dOptions = {},
): InteractiveScatter3dHandle {
  // Everything `plotScatter3d` may grow later stays in `forwarded` and
  // reaches it untouched, so a new plot option needs no edit here.
  const {
    plotly: givenEngine,
    onDone,
    x,
    y,
    z,
    color,
    aspect,
    opacity,
    size,
    camera,
    titles,
    ...forwarded
  } = options;

  // R's order, and R's own check: the style first of all.
  const style = {
    aspect: aspect ?? DEFAULT_SCATTER3D_STYLE.aspect,
    opacity: opacity ?? DEFAULT_SCATTER3D_STYLE.opacity,
    size: size ?? DEFAULT_SCATTER3D_STYLE.size,
  };
  validateScatter3dStyle(style.aspect, style.opacity, style.size);

  const numeric = numericColumns(data);
  requireThreeNumericColumns(numeric, "interactiveScatter3d");
  for (const [axis, given] of [
    ["x", x],
    ["y", y],
    ["z", z],
  ] as const) {
    if (given !== undefined && !numeric.includes(given)) {
      throw new RangeError(
        `Initial \`${axis}\` ("${given}") is not a numeric column of ` +
          `\`data\`. Numeric columns: ${numeric.join(", ")}.`,
      );
    }
  }
  if (color !== undefined && data[color] === undefined) {
    throw new RangeError(`Initial \`color\` ("${color}") is not in \`data\`.`);
  }

  const panel = resolvePlot3dTarget(target);
  const owner = panel.controls.ownerDocument;

  let values: Scatter3dValues = {
    x: x ?? numeric[0],
    y: y ?? numeric[1],
    z: z ?? numeric[2],
    color,
    aspect: style.aspect.map((value, axis) =>
      startingSliderValue(
        value,
        DEFAULT_SCATTER3D_STYLE.aspect[axis],
        ASPECT_RANGE,
      ),
    ),
    opacity: startingSliderValue(
      style.opacity,
      DEFAULT_SCATTER3D_STYLE.opacity,
      OPACITY_RANGE,
    ),
    size: startingSliderValue(
      style.size,
      DEFAULT_SCATTER3D_STYLE.size,
      SIZE_RANGE,
    ),
    camera,
    titles,
  };

  let spec: Scatter3dSpec | null = null;
  let engine: PlotlyLike | undefined = givenEngine;
  let element: PlotlyHTMLElement | null = null;
  let listening = false;
  let destroyed = false;
  let inFlight: Promise<void> | null = null;
  let queued = false;

  const note = buildNote(owner);

  /**
   * Draw once, at whatever the panel stands at now.
   *
   * The engine is resolved by the first draw and held afterwards, so a
   * component loads Plotly once however often it redraws.
   */
  async function renderOnce(): Promise<void> {
    const drawn = await plotScatter3d(panel.plot, data, {
      ...forwarded,
      ...values,
      plotly: engine,
    });
    if (destroyed) {
      return;
    }

    engine = drawn.plotly;
    element = drawn.element;
    spec = { traces: drawn.traces, layout: drawn.layout, note: drawn.note };
    note.show(drawn.note);

    // One listener for the life of the component: Plotly hands back the same
    // element every time, so attaching per draw would pile them up.
    if (!listening) {
      listening = true;
      element.on("plotly_relayout", handleRelayout);
    }
  }

  /**
   * Draw, and never draw twice at once.
   *
   * A dragged slider fires an event for every step, and each draw is
   * asynchronous. Overlapping draws could reach the engine out of order and
   * leave the picture at a value the user has already left. So a request that
   * arrives while a draw is in flight is remembered, not started, and the
   * draw that follows reads the state as it stands then: the last value
   * always wins, and one draw is in flight at a time.
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

  /**
   * R's observer: store the camera, and leave the picture alone — with one
   * addition R does not need. Plotly's own modebar buttons (orbit, turntable,
   * pan, zoom) relayout the scene from the stored layout, and a dragged
   * camera lives only in the WebGL scene until it is written back; without
   * the push below, every modebar click snapped the view to the default. The
   * push itself echoes through this handler with the same camera as a fresh
   * object, which is what the value comparison recognizes and drops.
   */
  function handleRelayout(event: PlotlyRelayoutEvent): void {
    const moved = event["scene.camera"];
    if (moved === undefined || destroyed || sameCamera(moved, values.camera)) {
      return;
    }
    values = { ...values, camera: moved };
    if (element !== null && engine !== undefined) {
      // Fire and forget: the picture is already at this view, so a failure
      // here (a plot purged mid-flight) has nothing to repair.
      engine.relayout(element, { "scene.camera": moved }).catch(() => undefined);
    }
  }

  function handleChange(event: Event): void {
    const input = event.target as HTMLSelectElement;
    if (input.name === "color") {
      values = {
        ...values,
        color: input.value === NONE ? undefined : input.value,
      };
    } else {
      values = { ...values, [input.name]: input.value };
    }
    requestRender();
  }

  function handleInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    // A slider keeps its own value inside the range and on the step, so what
    // it reports needs no correcting.
    const moved = Number(input.value);
    const axis = ASPECT_SLIDERS.findIndex(
      (slider) => slider.name === input.name,
    );
    if (axis >= 0) {
      values = {
        ...values,
        aspect: values.aspect.map((was, index) =>
          index === axis ? moved : was,
        ),
      };
    } else {
      values = { ...values, [input.name]: moved };
    }

    const readout = readouts.get(input.name);
    if (readout !== undefined) {
      readout.textContent = input.value;
    }
    requestRender();
  }

  const built: HTMLElement[] = [];
  const selects: HTMLSelectElement[] = [];
  const sliders: HTMLInputElement[] = [];
  const readouts = new Map<string, HTMLElement>();

  for (const [axis, label] of [
    ["x", "X"],
    ["y", "Y"],
    ["z", "Z"],
  ] as const) {
    const picker = buildSelect(owner, axis, label, numeric, values[axis]);
    panel.controls.appendChild(picker.wrapper);
    built.push(picker.wrapper);
    selects.push(picker.input);
  }

  const colorPicker = buildSelect(
    owner,
    "color",
    "Color",
    [NONE, ...Object.keys(data)],
    values.color ?? NONE,
  );
  panel.controls.appendChild(colorPicker.wrapper);
  built.push(colorPicker.wrapper);
  selects.push(colorPicker.input);

  for (const [axis, wanted] of ASPECT_SLIDERS.entries()) {
    const control = buildSlider(
      owner,
      wanted.name,
      wanted.label,
      ASPECT_RANGE,
      values.aspect[axis],
    );
    panel.controls.appendChild(control.wrapper);
    built.push(control.wrapper);
    sliders.push(control.input);
    readouts.set(wanted.name, control.readout);
  }

  for (const [name, label, range, value] of [
    ["opacity", "Opacity", OPACITY_RANGE, values.opacity],
    ["size", "Size", SIZE_RANGE, values.size],
  ] as const) {
    const control = buildSlider(owner, name, label, range, value);
    panel.controls.appendChild(control.wrapper);
    built.push(control.wrapper);
    sliders.push(control.input);
    readouts.set(name, control.readout);
  }

  panel.controls.appendChild(note.element);
  built.push(note.element);

  for (const select of selects) {
    select.addEventListener("change", handleChange);
  }
  for (const slider of sliders) {
    slider.addEventListener("input", handleInput);
  }

  // R's renderPlot runs as the gadget opens, at the initial settings.
  requestRender();

  /** A copy deep enough that a caller cannot reach back into the state. */
  function currentValues(): Scatter3dValues {
    return { ...values, aspect: [...values.aspect] };
  }

  return {
    getValues: currentValues,
    getSpec: () => spec,
    rendered: () => inFlight ?? Promise.resolve(),
    done() {
      onDone?.(currentValues());
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      for (const select of selects) {
        select.removeEventListener("change", handleChange);
      }
      for (const slider of sliders) {
        slider.removeEventListener("input", handleInput);
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
