/**
 * Tests for the interactive matrix inverse.
 *
 * The component owns a panel of four sliders and the matrix in them.
 * Everything it draws goes through `plotMatrixInverse`, which is tested on its
 * own, so these tests check the controls, the state, and that a change reaches
 * the plot — not the picture.
 *
 * Control ranges come from `../compstatslib/R/matrix_inverse_interactive.R`:
 *
 * ```r
 * interactive_matrix_inverse <- function(x1_init = 1, y1_init = 2,
 *                                        x2_init = 2, y2_init = 1) {
 *   ...
 *   shiny::sliderInput("x1", "x1", min = -2, max = 2, value = x1_init, step = 0.1, ...)
 *   shiny::sliderInput("y1", "y1", min = -2, max = 2, value = y1_init, step = 0.1, ...)
 *   shiny::sliderInput("x2", "x2", min = -2, max = 2, value = x2_init, step = 0.1, ...)
 *   shiny::sliderInput("y2", "y2", min = -2, max = 2, value = y2_init, step = 0.1, ...)
 *   ...
 *   output$matrix_plot <- shiny::renderPlot({
 *     plot_matrix_inverse(input$x1, input$y1, input$x2, input$y2)
 *   })
 *   shiny::observeEvent(input$done,   { shiny::stopApp(NULL) })
 *   shiny::observeEvent(input$cancel, { shiny::stopApp(NULL) })
 * }
 * ```
 *
 * Two behaviors below need their evidence stated, because neither is obvious.
 *
 * **The message on a singular matrix.** `plotMatrixInverse` draws nothing at
 * all when the matrix has no inverse, because R's `solve()` stops the R
 * function before it draws (fixture document, section 3.4). In R the user is
 * not left looking at the last picture: shiny catches the error and prints it
 * in the plot panel. That panel is not part of `plot_matrix_inverse`, so the
 * message belongs here, and the text is R's own, from the fixture document:
 * `Lapack routine dgesv: system is exactly singular: U[2,2] = 0` and
 * `system is computationally singular: reciprocal condition number =
 * 1.76226e-17`. The number is C's `%g`, which carries six significant digits.
 * (The fixture document calls it five; `5.55112e-17` in its own recorded error
 * has six.)
 *
 * **Snapping a starting value to the step.** R does not snap. The `validate()`
 * method of the shipped `ion.rangeSlider.js`, read at
 * `<shiny>/www/shared/ionrangeslider/js/ion.rangeSlider.js`, clamps `from` to
 * `min` and `max` and replaces a value that is not a number with `min`, and
 * does nothing about the step. An HTML range input is not so relaxed: it
 * rounds a step-mismatched value to the nearest step it does allow, taking the
 * larger of two equal neighbours. So a port that kept 1.25 would hold one
 * number and show a slider standing at another. The component therefore snaps
 * at construction, which keeps the picture and the panel in step — the same
 * rule the sampling component follows for a select value it cannot show.
 */

import { describe, expect, test } from "bun:test";

import { RecordingContext } from "../../test/recording-context.js";
import { invertMatrix } from "../core/matrix.js";
import type { Matrix2 } from "../core/matrix.js";
import {
  DEFAULT_MATRIX_INVERSE_VALUES,
  interactiveMatrixInverse,
} from "./matrixInverse.js";
import type { InteractiveMatrixInverseOptions } from "./matrixInverse.js";

const WIDTH = 640;
const HEIGHT = 400;

/** R's `rgb(1, 0, 0, 0.1)` and `rgb(0, 0, 1, 0.1)`, from the plot. */
const MATRIX_FILL = "#FF00001A";
const INVERSE_FILL = "#0000FF1A";

/** Four ones: R's "exactly singular", reachable at the slider's own step. */
const EXACTLY_SINGULAR: Matrix2 = { x1: 1, y1: 1, x2: 1, y2: 1 };
/** Fixture F4a, every entry on the 0.1 grid inside the slider range. */
const COMPUTATIONALLY_SINGULAR: Matrix2 = {
  x1: -2,
  y1: -1.6,
  x2: -1.5,
  y2: -1.2,
};

/** Build the component against a recording surface and a real controls host. */
function setup(options: InteractiveMatrixInverseOptions = {}) {
  const ctx = new RecordingContext();
  const controls = document.createElement("div");
  const handle = interactiveMatrixInverse(
    { surface: { ctx, width: WIDTH, height: HEIGHT }, controls },
    options,
  );
  return { ctx, controls, handle };
}

/** The range input that carries one matrix entry. */
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

/** Move all four sliders to a matrix, in one go. */
function setMatrix(controls: HTMLElement, matrix: Matrix2): void {
  for (const name of ["x1", "y1", "x2", "y2"] as const) {
    setControl(slider(controls, name), String(matrix[name]));
  }
}

/** The fill color of every filled shape, in order. */
function fills(ctx: RecordingContext): string[] {
  return ctx.callsTo("fill").map((call) => String(call.style.fillStyle));
}

describe("interactiveMatrixInverse", () => {
  describe("the control panel", () => {
    test("builds the four sliders R builds, in R's order", () => {
      const { controls } = setup();
      const inputs = [
        ...controls.querySelectorAll('input[type="range"]'),
      ] as HTMLInputElement[];

      expect(inputs).toHaveLength(4);
      expect(inputs.map((input) => input.name)).toEqual([
        "x1",
        "y1",
        "x2",
        "y2",
      ]);
    });

    test("gives each slider R's range, step, and starting value", () => {
      const { controls } = setup();
      const expected = [
        { name: "x1", value: "1" },
        { name: "y1", value: "2" },
        { name: "x2", value: "2" },
        { name: "y2", value: "1" },
      ];

      for (const { name, value } of expected) {
        const input = slider(controls, name);
        expect(input.min).toBe("-2");
        expect(input.max).toBe("2");
        expect(input.step).toBe("0.1");
        expect(input.value).toBe(value);
      }
    });

    test("labels the sliders as R labels them", () => {
      const { controls } = setup();
      const text = controls.textContent ?? "";

      for (const label of ["x1", "y1", "x2", "y2"]) {
        expect(text).toContain(label);
      }
    });

    test("shows the current value beside each slider", () => {
      const { controls } = setup();

      setControl(slider(controls, "x1"), "-1.5");

      expect(controls.textContent).toContain("-1.5");
    });
  });

  describe("drawing", () => {
    test("draws once as soon as it starts", () => {
      const { ctx } = setup();

      expect(ctx.calls.length).toBeGreaterThan(0);
    });

    test("reports what the plot reported about the matrix", () => {
      const { ctx, handle } = setup();

      expect(ctx.calls.length).toBeGreaterThan(0);
      expect(handle.getResult()).toEqual(
        invertMatrix(DEFAULT_MATRIX_INVERSE_VALUES),
      );
    });

    test("draws through the plot, not with drawing of its own", () => {
      // The two parallelograms in R's two colors can only have come from
      // `plotMatrixInverse`.
      const { ctx } = setup();

      expect(fills(ctx)).toEqual([MATRIX_FILL, INVERSE_FILL]);
    });

    test("redraws with the new matrix when a slider moves", () => {
      const { ctx, controls, handle } = setup();
      const before = ctx.calls.length;

      setControl(slider(controls, "x1"), "-1.5");

      expect(ctx.calls.length).toBeGreaterThan(before);
      expect(handle.getValues().x1).toBe(-1.5);
      expect(handle.getResult()).toEqual(
        invertMatrix({ ...DEFAULT_MATRIX_INVERSE_VALUES, x1: -1.5 }),
      );
    });

    test("redraws for every one of the four sliders", () => {
      const { controls, handle } = setup();
      const wanted: Matrix2 = { x1: -0.5, y1: 1.3, x2: 0.4, y2: -1.9 };

      setMatrix(controls, wanted);

      expect(handle.getValues()).toEqual(wanted);
      expect(handle.getResult()).toEqual(invertMatrix(wanted));
    });
  });

  describe("starting values from the options", () => {
    test("puts the given values into the sliders and the first picture", () => {
      const wanted: Matrix2 = { x1: -2, y1: 0.5, x2: 1.1, y2: 2 };
      const { controls, handle } = setup(wanted);

      expect(slider(controls, "x1").value).toBe("-2");
      expect(slider(controls, "y1").value).toBe("0.5");
      expect(slider(controls, "x2").value).toBe("1.1");
      expect(slider(controls, "y2").value).toBe("2");
      expect(handle.getResult()).toEqual(invertMatrix(wanted));
    });

    test("keeps R's defaults for the entries the caller left out", () => {
      const { handle } = setup({ y2: -1 });

      expect(handle.getValues()).toEqual({ x1: 1, y1: 2, x2: 2, y2: -1 });
    });

    test("R's own defaults are 1, 2, 2, 1", () => {
      expect(DEFAULT_MATRIX_INVERSE_VALUES).toEqual({
        x1: 1,
        y1: 2,
        x2: 2,
        y2: 1,
      });
      const { controls, handle } = setup();
      expect(handle.getValues()).toEqual(DEFAULT_MATRIX_INVERSE_VALUES);
      expect(slider(controls, "x1").value).toBe("1");
      expect(slider(controls, "y1").value).toBe("2");
    });

    test("clamps a value outside the slider range, at both ends", () => {
      // R's own widget does this: ion.rangeSlider's validate() moves `from`
      // to the nearer bound before the slider is first drawn.
      const { controls, handle } = setup({ x1: -5, y1: 5 });

      expect(handle.getValues().x1).toBe(-2);
      expect(handle.getValues().y1).toBe(2);
      // The panel shows what the component holds.
      expect(slider(controls, "x1").value).toBe("-2");
      expect(slider(controls, "y1").value).toBe("2");
    });

    test("snaps a value that misses the step to the nearest step", () => {
      // See the note on this file: an HTML range input will not show 1.25 on
      // a step of 0.1, so holding it would put the picture out of step with
      // the panel. Steps are counted from the minimum, and a tie takes the
      // larger neighbour, which is what a browser does.
      const { controls, handle } = setup({ x1: 1.25, y1: -0.02 });

      expect(handle.getValues().x1).toBe(1.3);
      expect(handle.getValues().y1).toBe(0);
      expect(slider(controls, "x1").value).toBe("1.3");
      expect(slider(controls, "y1").value).toBe("0");
    });

    test("replaces a value that is not a number with the minimum", () => {
      // ion.rangeSlider: `if (typeof o.from !== "number" || isNaN(o.from))
      // o.from = o.min;`.
      const { controls, handle } = setup({ x1: Number.NaN });

      expect(handle.getValues().x1).toBe(-2);
      expect(slider(controls, "x1").value).toBe("-2");
    });
  });

  describe("a matrix with no inverse", () => {
    test("clears the surface, since the plot draws nothing", () => {
      const { ctx, controls } = setup();

      setMatrix(controls, EXACTLY_SINGULAR);
      const cleared = ctx.callsTo("fillRect").at(-1);

      expect(cleared?.args).toEqual([0, 0, WIDTH, HEIGHT]);
      expect(String(cleared?.style.fillStyle)).toBe("#ffffff");
    });

    test("draws no picture, only the notice", () => {
      const { ctx, controls } = setup();

      setMatrix(controls, EXACTLY_SINGULAR);
      const before = ctx.calls.length;
      setControl(slider(controls, "x1"), "1"); // already 1: redraw, still singular
      const redraw = ctx.calls.slice(before);

      expect(
        redraw.filter((call) => call.method === "fill"),
      ).toHaveLength(0);
      // No axes either: the only text is the message.
      expect(
        redraw
          .filter((call) => call.method === "fillText")
          .map((call) => String(call.args[0])),
      ).toHaveLength(1);
    });

    test("shows R's own message for an exactly singular matrix", () => {
      const { ctx, controls } = setup();

      setMatrix(controls, EXACTLY_SINGULAR);

      expect(ctx.texts().at(-1)).toBe(
        "Lapack routine dgesv: system is exactly singular: U[2,2] = 0",
      );
    });

    test("names the pivot R names when the first column is zero", () => {
      // Fixture section 2c: the all-zero matrix is the one case where R's
      // message reads U[1,1]. Every slider can reach 0.
      const { ctx, controls } = setup();

      setMatrix(controls, { x1: 0, y1: 0, x2: 0, y2: 0 });

      expect(ctx.texts().at(-1)).toBe(
        "Lapack routine dgesv: system is exactly singular: U[1,1] = 0",
      );
    });

    test("shows R's own message for a computationally singular matrix", () => {
      // R prints the condition number through C's %g: six significant digits.
      const { ctx, controls } = setup();

      setMatrix(controls, COMPUTATIONALLY_SINGULAR);

      expect(ctx.texts().at(-1)).toBe(
        "system is computationally singular: reciprocal condition number = 1.76226e-17",
      );
    });

    test("still reports why the picture is missing", () => {
      const { controls, handle } = setup();

      setMatrix(controls, EXACTLY_SINGULAR);
      const exact = handle.getResult();
      setMatrix(controls, COMPUTATIONALLY_SINGULAR);
      const computational = handle.getResult();

      expect(exact.singularity).toBe("exact");
      expect(exact.zeroPivot).toBe(2);
      expect(computational.singularity).toBe("computational");
      expect(computational.rcond).toBeLessThan(Number.EPSILON);
    });

    test("draws the picture again on the way out of a singular setting", () => {
      const { ctx, controls, handle } = setup();

      setMatrix(controls, EXACTLY_SINGULAR);
      const before = ctx.calls.length;
      setControl(slider(controls, "y1"), "2");
      const redraw = ctx.calls.slice(before);

      expect(handle.getResult().singularity).toBeNull();
      expect(
        redraw
          .filter((call) => call.method === "fill")
          .map((call) => String(call.style.fillStyle)),
      ).toEqual([MATRIX_FILL, INVERSE_FILL]);
    });
  });

  describe("the handle", () => {
    test("reports the four current values", () => {
      const { controls, handle } = setup();

      setControl(slider(controls, "x2"), "-0.3");

      expect(handle.getValues()).toEqual({ x1: 1, y1: 2, x2: -0.3, y2: 1 });
    });

    test("hands out a copy of the values", () => {
      const { controls, handle } = setup();
      setControl(slider(controls, "x1"), "-0.3");

      const values = handle.getValues() as { x1: number };
      values.x1 = 99;

      expect(handle.getValues().x1).toBe(-0.3);
    });

    test("hands the current values to onDone", () => {
      let seen: unknown = null;
      const { controls, handle } = setup({
        onDone: (values) => {
          seen = values;
        },
      });

      setControl(slider(controls, "y2"), "-2");
      handle.done();

      expect(seen).toEqual({ x1: 1, y1: 2, x2: 2, y2: -2 });
    });

    test("does nothing on done without a callback", () => {
      const { controls, handle } = setup();
      setControl(slider(controls, "x1"), "-1");

      expect(() => handle.done()).not.toThrow();
      expect(handle.getValues().x1).toBe(-1);
    });

    test("keeps running after done, as nothing in a browser blocks", () => {
      const { ctx, controls, handle } = setup();

      handle.done();
      const before = ctx.calls.length;
      setControl(slider(controls, "x1"), "-1");

      expect(ctx.calls.length).toBeGreaterThan(before);
      expect(handle.getValues().x1).toBe(-1);
    });

    test("stops redrawing once destroyed", () => {
      const { ctx, controls, handle } = setup();
      // Hold the input first: destroying takes the controls back out.
      const input = slider(controls, "x1");

      handle.destroy();
      const after = ctx.calls.length;
      setControl(input, "-1");

      expect(ctx.calls.length).toBe(after);
    });

    /**
     * A slider fires an event for every step of a drag, so a listener added
     * per redraw would pile up unseen. This plot accumulates nothing, so
     * returning to a value it has already drawn must cost exactly what it
     * cost the first time.
     */
    test("does not pile up listeners or controls while a slider is dragged", () => {
      const { ctx, controls, handle } = setup();
      const input = slider(controls, "x1");
      const childrenAtStart = controls.children.length;

      const costs = new Set<number>();
      for (let visit = 0; visit < 20; visit += 1) {
        for (const value of ["1", "-1.5"]) {
          const before = ctx.calls.length;
          setControl(input, value);
          if (value === "1") {
            costs.add(ctx.calls.length - before);
          }
        }
      }

      expect(costs.size).toBe(1);
      expect(controls.children).toHaveLength(childrenAtStart);
      handle.destroy();
    });

    test("still reports the last values after being destroyed", () => {
      const { controls, handle } = setup();

      setControl(slider(controls, "x1"), "-1");
      handle.destroy();

      expect(handle.getValues().x1).toBe(-1);
      expect(handle.getResult().singularity).toBeNull();
    });

    test("survives being destroyed twice", () => {
      const { controls, handle } = setup();
      expect(controls.querySelectorAll('input[type="range"]')).toHaveLength(4);

      handle.destroy();

      expect(() => handle.destroy()).not.toThrow();
      expect(controls.querySelectorAll('input[type="range"]')).toHaveLength(0);
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

    test("fills a container with a canvas and a column of controls", () => {
      withCanvasContext((container) => {
        const handle = interactiveMatrixInverse(container);

        expect(container.querySelectorAll("canvas")).toHaveLength(1);
        expect(
          container.querySelectorAll('input[type="range"]'),
        ).toHaveLength(4);
        expect(handle.getResult().singularity).toBeNull();
        handle.destroy();
      });
    });

    test("takes back everything it built when destroyed", () => {
      withCanvasContext((container) => {
        const handle = interactiveMatrixInverse(container);
        expect(container.querySelectorAll("canvas")).toHaveLength(1);
        expect(
          container.querySelectorAll('input[type="range"]'),
        ).toHaveLength(4);

        handle.destroy();

        expect(container.querySelectorAll("canvas")).toHaveLength(0);
        expect(container.children).toHaveLength(0);
      });
    });

    test("refuses a canvas, which has no room for the controls", () => {
      const canvas = document.createElement("canvas");

      expect(() => interactiveMatrixInverse(canvas)).toThrow(
        /container element/,
      );
    });
  });
});
