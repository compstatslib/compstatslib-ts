/**
 * The interactive matrix inverse: move the four sliders and watch the inverse
 * answer.
 *
 * This is the port of `interactive_matrix_inverse()` in
 * `../compstatslib/R/matrix_inverse_interactive.R`. R builds a miniUI gadget
 * with four sliders, one for each entry of the matrix, and re-runs
 * `plot_matrix_inverse()` whenever one moves. This module does the same: it
 * owns the controls and the matrix in them, and hands every draw to
 * `plotMatrixInverse`. It contains no drawing of the picture and no
 * arithmetic.
 *
 * `plotMatrixInverse` takes no options, so there is nothing for this module to
 * forward and the forwarding rule of CLAUDE.md is met by having nothing to
 * pass. **A plot option added later must be threaded through here**, in the
 * way `interactiveTTest` does it: pull the component's own fields out of the
 * options object and pass the rest to the plot untouched.
 *
 * R's `runGadget()` blocks until "Done" and then returns nothing at all —
 * `stopApp(NULL)`, from both Done and Cancel, and there is no Reset. Nothing
 * blocks in a browser, so this returns a handle at once. `getValues()` reads
 * the sliders and `getResult()` reads what was last drawn. `done()` reports
 * the current matrix to the `onDone` callback: R hands back nothing, but a
 * callback with no argument would only send the caller back to the handle for
 * the values it just asked about.
 *
 * **The component draws one thing itself: the notice.** When the matrix has no
 * inverse, `plotMatrixInverse` makes no drawing call at all, because R's
 * `solve()` stops the R function before it draws. In R the user is not left
 * looking at the last picture: shiny catches the error and prints it in the
 * plot panel, which is not part of `plot_matrix_inverse`. So this module
 * clears the surface and writes R's own message on it. That is the state of
 * the gadget, reported to the user, and not a second way to draw a matrix.
 */

import type { Matrix2, MatrixInversion } from "../core/matrix";
import { plotMatrixInverse } from "../plot/matrixInverse";
import type { RenderTarget } from "../plot/target";
import { resolveControlTarget } from "./target";
import type { ControlTarget } from "./target";

/**
 * Where the sliders start: R's `x1_init = 1, y1_init = 2, x2_init = 2,
 * y2_init = 1`.
 *
 * The matrix inverts, and both of its columns and both columns of its inverse
 * are inside the fixed window of the plot.
 */
export const DEFAULT_MATRIX_INVERSE_VALUES: Matrix2 = {
  x1: 1,
  y1: 2,
  x2: 2,
  y2: 1,
};

/**
 * What the component accepts.
 *
 * The four entries are the starting positions of the sliders, named as R names
 * the matrix. R calls its own arguments `x1_init` and so on, to keep them
 * apart from the reactive inputs of the same name; an options object is
 * already the starting state, so the suffix would say nothing here.
 *
 * A value outside the slider range, or one that misses its step, is corrected
 * at construction. See `startingValue`.
 */
export interface InteractiveMatrixInverseOptions extends Partial<Matrix2> {
  /** What to run on `done()`. */
  readonly onDone?: (values: Matrix2) => void;
}

/** What the caller holds after the component starts. */
export interface InteractiveMatrixInverseHandle {
  /** Return the matrix the sliders stand at now. */
  getValues(): Matrix2;
  /**
   * Return what the last draw reported: the determinant, the inverse, and the
   * singularity. The inverse is null exactly when the picture is a notice.
   */
  getResult(): MatrixInversion;
  /** Hand the current matrix to the `onDone` callback. */
  done(): void;
  /** Stop listening and take back the controls that were built. */
  destroy(): void;
}

/**
 * R's four sliders, in R's order.
 *
 * Every one of them is `sliderInput("x1", "x1", min = -2, max = 2, value =
 * x1_init, step = 0.1)`, so the name is also the caption R shows, and the
 * range is the same for all four. The starting positions are not here: they
 * come from `DEFAULT_MATRIX_INVERSE_VALUES`.
 */
const ENTRIES = ["x1", "y1", "x2", "y2"] as const;
const SLIDER_MIN = -2;
const SLIDER_MAX = 2;
const SLIDER_STEP = 0.1;

const NOTICE_BACKGROUND = "#ffffff";
/** A colour of this port's own choosing, so a message does not read as a
 * picture. R leaves the styling of its error text to shiny. */
const NOTICE_COLOR = "#b22222";
const NOTICE_FONT = "12px monospace";
const NOTICE_MARGIN = 12;
/** C's `%g` carries six significant digits, which is what R's error shows. */
const SIGNIFICANT_DIGITS = 6;

/**
 * Start an interactive matrix inverse on a target.
 *
 * The component builds its controls, draws once, and redraws on every change.
 *
 * @param target A container element, or a surface and a controls host. See
 * `./target.ts`.
 * @param options Starting entries and a done callback.
 * @returns The handle to the running component.
 * @throws Error If the target is a canvas, or if a canvas gives no 2D context.
 */
export function interactiveMatrixInverse(
  target: ControlTarget,
  options: InteractiveMatrixInverseOptions = {},
): InteractiveMatrixInverseHandle {
  const { onDone } = options;
  const panel = resolveControlTarget(target);

  let values: Matrix2 = {
    x1: startingValue("x1", options.x1),
    y1: startingValue("y1", options.y1),
    x2: startingValue("x2", options.x2),
    y2: startingValue("y2", options.y2),
  };

  const owner = panel.controls.ownerDocument;
  const built: HTMLElement[] = [];
  const inputs: HTMLInputElement[] = [];
  const readouts = new Map<string, HTMLElement>();
  let destroyed = false;

  function draw(): MatrixInversion {
    const drawn = plotMatrixInverse(panel.surface, values);
    if (drawn.singularity !== null) {
      showNotice(panel.surface, drawn);
    }
    return drawn;
  }

  function handleInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const name = input.name as keyof Matrix2;
    if (!(name in values)) {
      return;
    }

    // A slider keeps its own value inside the range and on the step, so what
    // it reports needs no correcting.
    values = { ...values, [name]: Number(input.value) };
    const readout = readouts.get(name);
    if (readout !== undefined) {
      readout.textContent = input.value;
    }
    result = draw();
  }

  for (const name of ENTRIES) {
    const wrapper = owner.createElement("label");
    wrapper.style.display = "block";

    const caption = owner.createElement("span");
    caption.textContent = `${name} `;

    const readout = owner.createElement("output");
    readout.textContent = String(values[name]);
    readouts.set(name, readout);

    const input = owner.createElement("input");
    input.type = "range";
    input.name = name;
    input.min = String(SLIDER_MIN);
    input.max = String(SLIDER_MAX);
    input.step = String(SLIDER_STEP);
    input.value = String(values[name]);
    input.style.width = "100%";

    wrapper.appendChild(caption);
    wrapper.appendChild(readout);
    wrapper.appendChild(input);
    panel.controls.appendChild(wrapper);
    built.push(wrapper);
    inputs.push(input);
    input.addEventListener("input", handleInput);
  }

  let result = draw();

  return {
    getValues: () => ({ ...values }),
    getResult: () => result,
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
      panel.release();
    },
  };
}

/**
 * Correct one starting value to something the slider can stand at.
 *
 * Three rules, in order. A value that is not a number becomes the minimum,
 * which is what R's own widget does: `if (typeof o.from !== "number" ||
 * isNaN(o.from)) o.from = o.min;` in the `validate()` of the
 * `ion.rangeSlider.js` that ships inside shiny. A value outside the range
 * moves to the nearer bound, from the two lines below that one. A value that
 * misses the step moves to the nearest step.
 *
 * The third rule is not R's: `validate()` says nothing about the step, and R
 * leaves the handle wherever it was asked to stand. An HTML range input does
 * not allow that. It rounds a step-mismatched value to the nearest value it
 * does allow, and takes the larger of two equal neighbours, so a component
 * that held 1.25 would draw one matrix and show a slider standing at another.
 * The step is counted from the minimum, as a browser counts it.
 */
function startingValue(
  name: keyof Matrix2,
  given: number | undefined,
): number {
  if (given === undefined) {
    return DEFAULT_MATRIX_INVERSE_VALUES[name];
  }
  if (!Number.isFinite(given)) {
    return SLIDER_MIN;
  }

  const clamped = Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, given));
  // Scaling both sides by the step's own precision keeps a value that sits
  // exactly halfway from rounding the wrong way: 1.25 is 32.5 steps above the
  // minimum, and 3.25 / 0.1 alone lands a hair below that.
  const decimals = decimalsOf(SLIDER_STEP);
  const factor = 10 ** decimals;
  const steps = Math.round(
    ((clamped - SLIDER_MIN) * factor) / (SLIDER_STEP * factor),
  );
  return Number((SLIDER_MIN + steps * SLIDER_STEP).toFixed(decimals));
}

/** Return how many decimals a step carries. */
function decimalsOf(step: number): number {
  return String(step).split(".")[1]?.length ?? 0;
}

/**
 * Clear the surface and write why there is no picture.
 *
 * The text is R's own, from the two errors `solve()` raises. A surface too
 * narrow for the line cuts it off: the drawing surface of this library has no
 * way to measure text, and R's message is one line.
 */
function showNotice(surface: RenderTarget, report: MatrixInversion): void {
  const { ctx, width, height } = surface;

  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = NOTICE_BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = NOTICE_COLOR;
  ctx.font = NOTICE_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(messageFor(report), NOTICE_MARGIN, NOTICE_MARGIN);
  ctx.restore();
}

/** Build R's own error message for a matrix that has no inverse. */
function messageFor(report: MatrixInversion): string {
  if (report.singularity === "exact") {
    const pivot = report.zeroPivot ?? 1;
    return `Lapack routine dgesv: system is exactly singular: U[${pivot},${pivot}] = 0`;
  }
  return (
    "system is computationally singular: reciprocal condition number = " +
    formatConditionNumber(report.rcond)
  );
}

/**
 * Format the condition number as R's error prints it.
 *
 * R writes it with C's `%g`: six significant digits and no trailing zeros. R's
 * own message reads `reciprocal condition number = 5.55112e-17`, which is six
 * digits; the fixture document calls it five.
 *
 * Only one branch of `%g` can happen here, so only that branch is written.
 * This message is built for a matrix R calls computationally singular, and
 * that name is given only below one machine epsilon, where `%g` always takes
 * the exponent form. Do not reuse this for a number of another size: `%g`
 * writes anything from 1e-4 up in the plain form instead.
 */
function formatConditionNumber(value: number): string {
  const [mantissa, exponentText] = value
    .toExponential(SIGNIFICANT_DIGITS - 1)
    .split("e");
  const exponent = Number(exponentText);
  // C writes the exponent with a sign and at least two digits.
  const sign = exponent < 0 ? "-" : "+";
  const digits = String(Math.abs(exponent)).padStart(2, "0");

  return `${withoutTrailingZeros(String(mantissa))}e${sign}${digits}`;
}

/** Drop the trailing zeros of a decimal fraction, and a bare decimal point. */
function withoutTrailingZeros(text: string): string {
  if (!text.includes(".")) {
    return text;
  }
  return text.replace(/0+$/, "").replace(/\.$/, "");
}
