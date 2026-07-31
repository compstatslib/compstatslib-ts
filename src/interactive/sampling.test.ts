/**
 * Tests for the interactive sampling demonstration.
 *
 * The component owns two selects, a button, one generator, and the state that
 * piles up across draws. Everything it draws goes through `plotSampling`,
 * which is tested on its own, so these tests check the controls, the state and
 * the generator — not the picture.
 *
 * Control choices come from `../compstatslib/R/sampling_interactive.R`:
 *
 * ```r
 * selectInput("sample_size", "Sample size",
 *             choices = c(10, 100, 500, 1000, 5000, 10000), selected = sample_size)
 * selectInput("reps", "Repetitions", choices = c(1, 5, 10, 50, 100), selected = 1)
 * actionButton("run", "Sample")
 * ```
 *
 * Two behaviours separate this gadget from the t test's. R redraws only when
 * the button is pressed — `observeEvent(input$run, ...)` bumps a trigger and
 * the plot reads that trigger, isolating the two selects — so changing a
 * select alone must draw nothing. And R's `renderPlot` runs once when the
 * gadget opens, so one draw happens at startup.
 */

import { describe, expect, test } from "bun:test";

import { RecordingContext } from "../../test/recording-context";
import type { Rng } from "../core/rng";
import { interactiveSampling } from "./sampling";
import type { InteractiveSamplingOptions } from "./sampling";

const WIDTH = 640;
const HEIGHT = 600;

/** A population wide enough for a density and distinct samples. */
const population = Array.from({ length: 2000 }, (_unused, index) => index / 40);

/** A generator that counts how many values were taken from it. */
function countingRng(): { rng: Rng; taken: () => number } {
  let taken = 0;
  let state = 1;
  return {
    rng: () => {
      taken += 1;
      state = (state * 48271) % 2147483647;
      return state / 2147483647;
    },
    taken: () => taken,
  };
}

/** Build the component against a recording surface and a real controls host. */
function setup(options: InteractiveSamplingOptions = {}) {
  const ctx = new RecordingContext();
  const controls = document.createElement("div");
  const handle = interactiveSampling(
    { surface: { ctx, width: WIDTH, height: HEIGHT }, controls },
    population,
    options,
  );
  return { ctx, controls, handle };
}

/** The select that carries one control. */
function select(controls: HTMLElement, name: string): HTMLSelectElement {
  const found = controls.querySelector(`select[name="${name}"]`);
  expect(found).not.toBeNull();
  return found as HTMLSelectElement;
}

/** The button that draws. */
function sampleButton(controls: HTMLElement): HTMLButtonElement {
  const found = controls.querySelector("button");
  expect(found).not.toBeNull();
  return found as HTMLButtonElement;
}

/** Set a select and fire the event a browser fires. */
function choose(input: HTMLSelectElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Press the button. */
function press(controls: HTMLElement): void {
  sampleButton(controls).dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** The options of a select, in order. */
function choicesOf(input: HTMLSelectElement): string[] {
  return [...input.querySelectorAll("option")].map((option) => option.value);
}

/** How many times the surface was painted over — one per draw. */
function backgroundPaints(ctx: RecordingContext): number {
  return ctx
    .callsTo("fillRect")
    .filter(
      (call) =>
        call.style.fillStyle === "#ffffff" &&
        call.args[2] === WIDTH &&
        call.args[3] === HEIGHT,
    ).length;
}

describe("the control panel", () => {
  test("builds the two selects and the button R builds", () => {
    const { controls } = setup();

    expect(controls.querySelectorAll("select")).toHaveLength(2);
    expect(controls.querySelectorAll("button")).toHaveLength(1);
  });

  test("offers R's sample sizes, starting at ten", () => {
    const { controls } = setup();
    const input = select(controls, "sampleSize");

    expect(choicesOf(input)).toEqual(["10", "100", "500", "1000", "5000", "10000"]);
    expect(input.value).toBe("10");
  });

  test("offers R's repetition counts, starting at one", () => {
    const { controls } = setup();
    const input = select(controls, "reps");

    expect(choicesOf(input)).toEqual(["1", "5", "10", "50", "100"]);
    expect(input.value).toBe("1");
  });

  test("labels the controls as R labels them", () => {
    const { controls } = setup();
    const text = controls.textContent ?? "";

    expect(text).toContain("Sample size");
    expect(text).toContain("Repetitions");
    expect(sampleButton(controls).textContent).toBe("Sample");
  });

  test("starts at the sample size the caller asks for", () => {
    const { controls, handle } = setup({ sampleSize: 500 });

    expect(select(controls, "sampleSize").value).toBe("500");
    expect(handle.getValues().sampleSize).toBe(500);
  });

  test("falls back to the first choice for a size R would not offer", () => {
    // R's selectInput drops a `selected` that is not among the choices, and
    // the browser then shows the first option. This does the same rather than
    // draw at a size the select cannot show.
    const { controls, handle } = setup({ sampleSize: 42 });

    expect(select(controls, "sampleSize").value).toBe("10");
    expect(handle.getValues().sampleSize).toBe(10);
  });

  test("takes a repetition count from the options the same way", () => {
    // R's gadget has no `reps` argument at all; the plot function does, so a
    // caller can still ask, under the same rule as the sample size.
    expect(setup({ reps: 50 }).handle.getValues().reps).toBe(50);
    expect(setup({ reps: 7 }).handle.getValues().reps).toBe(1);
  });
});

describe("drawing", () => {
  test("draws once when it opens", () => {
    // R's renderPlot runs as the gadget opens, at the initial settings.
    const { ctx, handle } = setup();

    expect(ctx.calls.length).toBeGreaterThan(0);
    expect(handle.getState().sampleTheta).toHaveLength(1);
  });

  test("does not draw when a select changes", () => {
    const { ctx, controls, handle } = setup();
    const before = ctx.calls.length;

    choose(select(controls, "sampleSize"), "100");
    choose(select(controls, "reps"), "10");

    expect(ctx.calls.length).toBe(before);
    expect(handle.getState().sampleTheta).toHaveLength(1);
    // The values are still remembered, ready for the next press.
    expect(handle.getValues()).toEqual({ sampleSize: 100, reps: 10 });
  });

  test("draws when the button is pressed", () => {
    const { ctx, controls, handle } = setup();
    const before = ctx.calls.length;

    press(controls);

    expect(ctx.calls.length).toBeGreaterThan(before);
    expect(handle.getState().sampleTheta).toHaveLength(2);
  });

  test("uses the settings in force when the button is pressed", () => {
    const { rng, taken } = countingRng();
    const { controls } = setup({ rng });
    const afterOpening = taken();

    choose(select(controls, "sampleSize"), "100");
    choose(select(controls, "reps"), "5");
    press(controls);

    // Five samples of a hundred: five hundred values from the generator.
    expect(taken() - afterOpening).toBe(500);
  });

  test("piles the statistics up across presses", () => {
    const { controls, handle } = setup();

    choose(select(controls, "reps"), "5");
    press(controls);
    press(controls);

    // One at the opening, then five and five.
    expect(handle.getState().sampleTheta).toHaveLength(11);
  });

  test("keeps the window frozen at the first draw", () => {
    const { controls, handle } = setup();
    const first = handle.getState();

    choose(select(controls, "sampleSize"), "1000");
    press(controls);

    expect(handle.getState().xMin).toBe(first.xMin);
    expect(handle.getState().xMax).toBe(first.xMax);
  });

  test("draws down one stream for its whole life", () => {
    const { rng, taken } = countingRng();
    const { controls, handle } = setup({ rng, sampleSize: 10 });

    press(controls);
    press(controls);

    // Ten values per sample, three draws, no restarting.
    expect(taken()).toBe(30);
    const [first, second, third] = handle.getState().sampleTheta;
    expect(new Set([first, second, third]).size).toBeGreaterThan(1);
  });

  test("forwards the statistic it was given", () => {
    const { controls, handle } = setup({ theta: () => 42 });

    press(controls);

    expect(handle.getState().sampleTheta).toEqual([42, 42]);
  });
});

describe("the handle", () => {
  test("reports the control values", () => {
    const { handle } = setup({ sampleSize: 100 });

    expect(handle.getValues()).toEqual({ sampleSize: 100, reps: 1 });
  });

  test("hands the accumulated state to onDone", () => {
    let handed: unknown = null;
    const { controls, handle } = setup({ onDone: (state) => (handed = state) });

    press(controls);
    handle.done();

    // R's gadget is the only one of the four that returns its cache.
    expect(handed).toEqual(handle.getState());
    expect((handed as { sampleTheta: readonly number[] }).sampleTheta).toHaveLength(2);
  });

  test("empties the statistics on reset and redraws", () => {
    const { ctx, controls, handle } = setup();
    press(controls);
    const before = ctx.calls.length;

    handle.reset();

    expect(handle.getState().sampleTheta).toEqual([]);
    expect(ctx.calls.length).toBeGreaterThan(before);
    expect(ctx.texts()).toContain("( 0 )");
  });

  test("draws no samples while resetting", () => {
    const { rng, taken } = countingRng();
    const { handle } = setup({ rng, sampleSize: 10 });
    const afterOpening = taken();

    handle.reset();

    expect(taken()).toBe(afterOpening);
  });

  test("starts the pile again after a reset", () => {
    const { controls, handle } = setup();
    press(controls);
    handle.reset();
    press(controls);

    expect(handle.getState().sampleTheta).toHaveLength(1);
  });

  test("keeps a window to draw in after a reset", () => {
    const { handle } = setup();
    const before = handle.getState();

    handle.reset();

    expect(handle.getState().xMin).toBe(before.xMin);
    expect(handle.getState().xMax).toBe(before.xMax);
  });

  test("stops drawing once destroyed", () => {
    // Both controls have to be held before destroying, since destroying takes
    // them out of the panel; dispatching at them afterwards proves the
    // listeners went with them.
    const { ctx, controls, handle } = setup();
    const button = sampleButton(controls);
    const repetitions = select(controls, "reps");

    handle.destroy();
    const after = ctx.calls.length;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    repetitions.value = "10";
    repetitions.dispatchEvent(new Event("change", { bubbles: true }));

    expect(ctx.calls.length).toBe(after);
  });

  test("takes back the controls it built", () => {
    const { controls, handle } = setup();
    expect(controls.children.length).toBeGreaterThan(0);

    handle.destroy();

    expect(controls.children).toHaveLength(0);
  });

  test("still reports its state after being destroyed", () => {
    const { handle } = setup();
    handle.destroy();

    expect(handle.getState().sampleTheta).toHaveLength(1);
    expect(handle.getValues().sampleSize).toBe(10);
  });

  test("survives being destroyed twice", () => {
    const { handle } = setup();
    handle.destroy();

    expect(() => handle.destroy()).not.toThrow();
  });

  /**
   * The button fires on every press, so a listener added per draw would pile
   * up unseen. What a press costs cannot be the measure here, as it can in
   * the t test: this picture grows with the pile of statistics, so a later
   * press legitimately draws more shapes than an earlier one. The invariant
   * is the count of *draws*, and each draw paints the background exactly
   * once.
   */
  test("does not pile up listeners or controls as the button is pressed", () => {
    const { ctx, controls, handle } = setup();
    const childrenAtStart = controls.children.length;

    for (let visit = 0; visit < 20; visit += 1) {
      const before = backgroundPaints(ctx);
      press(controls);
      expect(backgroundPaints(ctx) - before).toBe(1);
    }

    expect(controls.children).toHaveLength(childrenAtStart);
    handle.destroy();
  });
});

/**
 * The container route builds its own canvas, which happy-dom will not give a
 * 2D context. Lending the prototype a recording context lets these tests
 * exercise the route a browser takes.
 */
describe("mounting into a container", () => {
  function withLentContext<T>(run: (ctx: RecordingContext) => T): T {
    const ctx = new RecordingContext();
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() =>
      ctx) as unknown as typeof original;
    try {
      return run(ctx);
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  }

  test("builds a canvas and a controls column, and takes both back", () => {
    withLentContext((ctx) => {
      const container = document.createElement("div");
      const handle = interactiveSampling(container, population);

      expect(container.querySelectorAll("canvas")).toHaveLength(1);
      expect(container.querySelectorAll("select")).toHaveLength(2);
      expect(ctx.calls.length).toBeGreaterThan(0);

      handle.destroy();
      expect(container.querySelectorAll("canvas")).toHaveLength(0);
      expect(container.querySelectorAll("select")).toHaveLength(0);
    });
  });

  test("ignores a click on the picture", () => {
    // Unlike the regression and logit gadgets, nothing here collects points.
    // R's plot pane is not clickable, and neither is this.
    withLentContext((ctx) => {
      const container = document.createElement("div");
      const handle = interactiveSampling(container, population);
      const canvas = container.querySelector("canvas") as HTMLCanvasElement;
      const before = ctx.calls.length;
      const state = handle.getState();

      canvas.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 100 }),
      );

      expect(ctx.calls.length).toBe(before);
      expect(handle.getState()).toEqual(state);
      handle.destroy();
    });
  });

  test("refuses a canvas as the container", () => {
    const canvas = document.createElement("canvas");

    expect(() => interactiveSampling(canvas, population)).toThrow();
  });
});
