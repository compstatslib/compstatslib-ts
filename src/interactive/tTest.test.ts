/**
 * Tests for the interactive t test.
 *
 * The component owns a panel of controls and the values in them. Everything it
 * draws goes through `plotTTest`, which is tested on its own, so these tests
 * check the controls, the state, and that a change reaches the plot — not the
 * picture.
 *
 * Control ranges come from `../compstatslib/R/t_statistic_interactive.R`.
 */

import { describe, expect, test } from "bun:test";

import { RecordingContext } from "../../test/recording-context";
import { tTestStats } from "../core/ttest";
import { interactiveTTest } from "./tTest";
import type { InteractiveTTestOptions } from "./tTest";

const WIDTH = 640;
const HEIGHT = 400;

/** Build the component against a recording surface and a real controls host. */
function setup(options: InteractiveTTestOptions = {}) {
  const ctx = new RecordingContext();
  const controls = document.createElement("div");
  const handle = interactiveTTest(
    { surface: { ctx, width: WIDTH, height: HEIGHT }, controls },
    options,
  );
  return { ctx, controls, handle };
}

/** The range input that carries one test parameter. */
function slider(controls: HTMLElement, name: string): HTMLInputElement {
  const found = controls.querySelector(`input[name="${name}"]`);
  expect(found).not.toBeNull();
  return found as HTMLInputElement;
}

/** Set a control and fire the event a browser fires. */
function setControl(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function toggle(input: HTMLInputElement, checked: boolean): void {
  input.checked = checked;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("interactiveTTest", () => {
  describe("the control panel", () => {
    test("builds the four sliders R builds", () => {
      const { controls } = setup();
      expect(controls.querySelectorAll('input[type="range"]')).toHaveLength(4);
    });

    test("gives each slider R's range, step, and starting value", () => {
      const { controls } = setup();
      const expected = [
        { name: "diff", min: "0", max: "4", step: "0.1", value: "0.5" },
        { name: "sd", min: "1", max: "5", step: "0.1", value: "4" },
        { name: "n", min: "2", max: "500", step: "1", value: "100" },
        { name: "alpha", min: "0.01", max: "0.1", step: "0.01", value: "0.05" },
      ];
      for (const { name, min, max, step, value } of expected) {
        const input = slider(controls, name);
        expect(input.min).toBe(min);
        expect(input.max).toBe(max);
        expect(input.step).toBe(step);
        expect(input.value).toBe(value);
      }
    });

    test("labels the controls as R labels them", () => {
      const { controls } = setup();
      const text = controls.textContent ?? "";
      for (const label of [
        "Difference",
        "Std Dev",
        "Sample Size",
        "Alpha",
        "Error Matrix",
      ]) {
        expect(text).toContain(label);
      }
    });

    test("starts the error-matrix checkbox unticked, as R does", () => {
      const { controls } = setup();
      const box = slider(controls, "errorMatrix");
      expect(box.type).toBe("checkbox");
      expect(box.checked).toBe(false);
    });

    test("shows the current value beside each slider", () => {
      const { controls } = setup();
      expect(controls.textContent).toContain("0.5");
      setControl(slider(controls, "diff"), "2.5");
      expect(controls.textContent).toContain("2.5");
    });
  });

  describe("drawing", () => {
    test("draws once as soon as it starts", () => {
      const { ctx } = setup();
      expect(ctx.calls.length).toBeGreaterThan(0);
    });

    test("reports the statistics of what it drew", () => {
      const { handle } = setup();
      expect(handle.getStats()).toEqual(tTestStats());
    });

    test("redraws with the new value when a slider moves", () => {
      const { ctx, controls, handle } = setup();
      const before = ctx.calls.length;
      setControl(slider(controls, "n"), "10");
      expect(ctx.calls.length).toBeGreaterThan(before);
      expect(handle.getStats().df).toBe(9);
      expect(handle.getStats()).toEqual(tTestStats({ n: 10 }));
    });

    test("redraws for every one of the four sliders", () => {
      const { controls, handle } = setup();
      setControl(slider(controls, "diff"), "2");
      expect(handle.getValues().diff).toBe(2);
      setControl(slider(controls, "sd"), "2");
      expect(handle.getValues().sd).toBe(2);
      setControl(slider(controls, "n"), "10");
      expect(handle.getValues().n).toBe(10);
      setControl(slider(controls, "alpha"), "0.01");
      expect(handle.getValues().alpha).toBe(0.01);
      expect(handle.getStats()).toEqual(
        tTestStats({ diff: 2, sd: 2, n: 10, alpha: 0.01 }),
      );
    });

    test("shows and hides the error matrix with its checkbox", () => {
      const { ctx, controls } = setup();
      expect(ctx.texts()).not.toContain("Type I error");

      toggle(slider(controls, "errorMatrix"), true);
      expect(ctx.texts()).toContain("Type I error");

      const seen = ctx.calls.length;
      toggle(slider(controls, "errorMatrix"), false);
      const afterHiding = ctx.calls.slice(seen);
      expect(
        afterHiding.filter((call) => call.args[0] === "Type I error"),
      ).toHaveLength(0);
    });
  });

  describe("starting values from the options", () => {
    test("puts the given values into the sliders", () => {
      const { controls } = setup({ diff: 2, sd: 2, n: 10, alpha: 0.01 });
      expect(slider(controls, "diff").value).toBe("2");
      expect(slider(controls, "sd").value).toBe("2");
      expect(slider(controls, "n").value).toBe("10");
      expect(slider(controls, "alpha").value).toBe("0.01");
    });

    test("draws with them from the start", () => {
      const { handle } = setup({ diff: 2, sd: 2, n: 10, alpha: 0.01 });
      expect(handle.getStats()).toEqual(
        tTestStats({ diff: 2, sd: 2, n: 10, alpha: 0.01 }),
      );
    });

    test("ticks the checkbox when the error matrix starts on", () => {
      const { ctx, controls } = setup({ errorMatrix: true });
      expect(slider(controls, "errorMatrix").checked).toBe(true);
      expect(ctx.texts()).toContain("Type I error");
    });

    /** A value set at the start has to survive a different slider moving. */
    test("keeps the other values when one slider moves", () => {
      const { controls, handle } = setup({ diff: 2, sd: 2, n: 10, alpha: 0.01 });
      setControl(slider(controls, "n"), "50");
      expect(handle.getValues()).toEqual({
        diff: 2,
        sd: 2,
        n: 50,
        alpha: 0.01,
        errorMatrix: false,
      });
    });

    test("keeps the error matrix on while a slider moves", () => {
      const { ctx, controls } = setup({ errorMatrix: true });
      const seen = ctx.calls.length;
      setControl(slider(controls, "n"), "50");
      const redraw = ctx.calls.slice(seen);
      expect(
        redraw.filter((call) => call.args[0] === "Type I error").length,
      ).toBeGreaterThan(0);
    });
  });

  describe("the handle", () => {
    test("reports every current value", () => {
      const { handle } = setup();
      expect(handle.getValues()).toEqual({
        diff: 0.5,
        sd: 4,
        n: 100,
        alpha: 0.05,
        errorMatrix: false,
      });
    });

    test("hands the current values to onDone", () => {
      let seen: unknown = null;
      const { controls, handle } = setup({
        onDone: (values) => {
          seen = values;
        },
      });
      setControl(slider(controls, "n"), "10");
      handle.done();
      expect(seen).toEqual({
        diff: 0.5,
        sd: 4,
        n: 10,
        alpha: 0.05,
        errorMatrix: false,
      });
    });

    test("does nothing on done without a callback", () => {
      const { handle } = setup();
      expect(() => handle.done()).not.toThrow();
    });

    test("stops redrawing once destroyed", () => {
      const { ctx, controls, handle } = setup();
      // Hold the input first: destroying takes the controls back out.
      const input = slider(controls, "n");
      handle.destroy();
      const after = ctx.calls.length;
      setControl(input, "10");
      expect(ctx.calls.length).toBe(after);
    });

    /**
     * A slider fires an event for every step of a drag, so a listener added
     * per redraw would pile up unseen. Returning to a value it has already
     * drawn must cost exactly what it cost the first time.
     */
    test("does not pile up listeners or controls while a slider is dragged", () => {
      const { ctx, controls, handle } = setup();
      const input = slider(controls, "n");
      const childrenAtStart = controls.children.length;

      const costs = new Set<number>();
      for (let visit = 0; visit < 20; visit += 1) {
        for (const value of ["50", "300"]) {
          const before = ctx.calls.length;
          setControl(input, value);
          if (value === "50") {
            costs.add(ctx.calls.length - before);
          }
        }
      }

      expect(costs.size).toBe(1);
      expect(controls.children).toHaveLength(childrenAtStart);
      handle.destroy();
    });

    test("still reports the last values after being destroyed", () => {
      const { handle } = setup();
      handle.destroy();
      expect(handle.getValues().n).toBe(100);
    });

    test("survives being destroyed twice", () => {
      const { handle } = setup();
      handle.destroy();
      expect(() => handle.destroy()).not.toThrow();
    });
  });

  /**
   * The container route builds its own canvas, which happy-dom will not give
   * a 2D context. Lending the prototype a recording context lets these tests
   * exercise the route that a browser takes.
   */
  describe("mounting into a container", () => {
    function withCanvasContext(run: (container: HTMLElement) => void): void {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = (() =>
        new RecordingContext()) as unknown as typeof original;
      try {
        run(document.createElement("div"));
      } finally {
        HTMLCanvasElement.prototype.getContext = original;
      }
    }

    /**
     * A screen with more device pixels than layout pixels needs a bigger
     * pixel store, or the browser stretches the picture and softens it. The
     * surface must still report layout pixels, so that everything downstream
     * keeps working in the units it was written for.
     */
    test("matches the pixel store to the density of the screen", () => {
      const scaled: number[][] = [];
      const original = HTMLCanvasElement.prototype.getContext;
      const describedRatio = Object.getOwnPropertyDescriptor(
        globalThis,
        "devicePixelRatio",
      );
      HTMLCanvasElement.prototype.getContext = (() => {
        const ctx = new RecordingContext() as RecordingContext & {
          scale(x: number, y: number): void;
        };
        ctx.scale = (x, y) => scaled.push([x, y]);
        return ctx;
      }) as unknown as typeof original;
      Object.defineProperty(globalThis, "devicePixelRatio", {
        value: 2,
        configurable: true,
      });

      try {
        const container = document.createElement("div");
        const handle = interactiveTTest(container);
        const canvas = container.querySelector("canvas") as HTMLCanvasElement;

        // The store is twice the layout size, the style holds the layout size,
        // and the drawing transform absorbs the difference.
        expect(canvas.width).toBe(1280);
        expect(canvas.height).toBe(800);
        expect(canvas.style.width).toBe("640px");
        expect(canvas.style.height).toBe("400px");
        expect(scaled).toEqual([[2, 2]]);

        // Everything drawn afterwards still works in layout pixels.
        expect(handle.getStats()).toEqual(tTestStats());
        handle.destroy();
      } finally {
        HTMLCanvasElement.prototype.getContext = original;
        if (describedRatio !== undefined) {
          Object.defineProperty(globalThis, "devicePixelRatio", describedRatio);
        }
      }
    });

    test("leaves the transform alone on an ordinary screen", () => {
      const scaled: number[][] = [];
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = (() => {
        const ctx = new RecordingContext() as RecordingContext & {
          scale(x: number, y: number): void;
        };
        ctx.scale = (x, y) => scaled.push([x, y]);
        return ctx;
      }) as unknown as typeof original;

      try {
        const container = document.createElement("div");
        const handle = interactiveTTest(container);
        const canvas = container.querySelector("canvas") as HTMLCanvasElement;
        expect(canvas.width).toBe(640);
        expect(scaled).toHaveLength(0);
        handle.destroy();
      } finally {
        HTMLCanvasElement.prototype.getContext = original;
      }
    });

    test("builds a canvas and the controls inside the element", () => {
      withCanvasContext((container) => {
        const handle = interactiveTTest(container);
        expect(container.querySelector("canvas")).not.toBeNull();
        expect(container.querySelectorAll('input[type="range"]')).toHaveLength(
          4,
        );
        handle.destroy();
      });
    });

    test("takes back what it built when destroyed", () => {
      withCanvasContext((container) => {
        const handle = interactiveTTest(container);
        handle.destroy();
        expect(container.querySelector("canvas")).toBeNull();
        expect(container.querySelectorAll('input[type="range"]')).toHaveLength(
          0,
        );
      });
    });

    test("leaves the container as it found it when there is no context", () => {
      const container = document.createElement("div");
      expect(() => interactiveTTest(container)).toThrow();
      expect(container.children).toHaveLength(0);
    });

    test("refuses a canvas, which has no room for the controls", () => {
      const canvas = document.createElement("canvas");
      expect(() => interactiveTTest(canvas)).toThrow(/container element/);
    });

    test("keeps a supplied controls host but empties what it built", () => {
      const { controls, handle } = setup();
      expect(controls.children.length).toBeGreaterThan(0);
      handle.destroy();
      // The caller owns this element, so only the controls it built go away.
      expect(controls.children).toHaveLength(0);
    });
  });
});
