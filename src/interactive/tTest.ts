/**
 * The interactive t test: move the sliders and watch the power change.
 *
 * This is the port of `interactive_t_test()` in
 * `../compstatslib/R/t_statistic_interactive.R`. R builds a miniUI gadget with
 * four sliders and a checkbox, and re-runs `plot_t_test()` whenever one moves.
 * This module does the same: it owns the controls and the values in them, and
 * hands every draw to `plotTTest`. It contains no drawing code and no
 * statistics.
 *
 * R's `runGadget()` blocks until "Done" and then returns nothing at all —
 * `stopApp(NULL)`. Nothing blocks in a browser, so this returns a handle at
 * once. `getValues()` reads the controls and `getStats()` reads what was last
 * drawn. `done()` reports the current values to the `onDone` callback: R hands
 * back nothing, but a callback with no argument would only send the caller
 * back to the handle for the values it just asked about.
 */

import { DEFAULT_T_TEST_OPTIONS } from "../core/ttest.js";
import type { TTestStats } from "../core/ttest.js";
import { plotTTest } from "../plot/tTest.js";
import type { PlotTTestOptions } from "../plot/tTest.js";
import { buildSlider } from "./controls.js";
import { resolveControlTarget } from "./target.js";
import type { ControlTarget } from "./target.js";

/** Everything the panel of controls holds. */
export interface TTestValues {
  /** The difference the alternative hypothesis claims. */
  readonly diff: number;
  /** The population standard deviation. */
  readonly sd: number;
  /** The sample size. */
  readonly n: number;
  /** The significance level. */
  readonly alpha: number;
  /** Whether the matrix of the four outcomes is showing. */
  readonly errorMatrix: boolean;
}

/**
 * What the component accepts.
 *
 * The options of `plotTTest` pass through to it, and the four test parameters
 * double as the starting positions of the sliders. This is the equivalent of
 * R's `...` forwarding.
 */
export interface InteractiveTTestOptions extends PlotTTestOptions {
  /** What to run on `done()`. */
  readonly onDone?: (values: TTestValues) => void;
}

/** What the caller holds after the component starts. */
export interface InteractiveTTestHandle {
  /** Return where the controls stand now. */
  getValues(): TTestValues;
  /** Return the statistics behind the last picture drawn. */
  getStats(): TTestStats;
  /** Hand the current values to the `onDone` callback. */
  done(): void;
  /** Stop listening and take back the controls that were built. */
  destroy(): void;
}

/** One slider, exactly as R's `sliderInput()` declares it. */
interface SliderSpec {
  readonly name: "diff" | "sd" | "n" | "alpha";
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/**
 * The four sliders of R's gadget.
 *
 * The starting positions are not here: they come from
 * `DEFAULT_T_TEST_OPTIONS`, which already holds R's own defaults, so the panel
 * and `plot_t_test()` cannot drift apart.
 */
const SLIDERS: readonly SliderSpec[] = [
  { name: "diff", label: "Difference", min: 0, max: 4, step: 0.1 },
  { name: "sd", label: "Std Dev", min: 1, max: 5, step: 0.1 },
  { name: "n", label: "Sample Size", min: 2, max: 500, step: 1 },
  { name: "alpha", label: "Alpha", min: 0.01, max: 0.1, step: 0.01 },
];

/** R: `checkboxInput("error_matrix", "Error Matrix", value = FALSE)`. */
const ERROR_MATRIX_NAME = "errorMatrix";
const ERROR_MATRIX_LABEL = "Error Matrix";

/**
 * Start an interactive t test on a target.
 *
 * The component builds its controls, draws once, and redraws on every change.
 *
 * @param target A container element, or a surface and a controls host. See
 * `./target.ts`.
 * @param options Starting values, a done callback, and the options of
 * `plotTTest`.
 * @returns The handle to the running component.
 * @throws Error If a canvas gives no 2D context.
 */
export function interactiveTTest(
  target: ControlTarget,
  options: InteractiveTTestOptions = {},
): InteractiveTTestHandle {
  // Everything `plotTTest` may grow later stays in `forwarded` and reaches it
  // untouched, so a new plot option needs no edit here.
  const { onDone, diff, sd, n, alpha, errorMatrix, ...forwarded } = options;
  const panel = resolveControlTarget(target);

  let values: TTestValues = {
    diff: diff ?? DEFAULT_T_TEST_OPTIONS.diff,
    sd: sd ?? DEFAULT_T_TEST_OPTIONS.sd,
    n: n ?? DEFAULT_T_TEST_OPTIONS.n,
    alpha: alpha ?? DEFAULT_T_TEST_OPTIONS.alpha,
    errorMatrix: errorMatrix ?? false,
  };

  const owner = panel.controls.ownerDocument;
  const built: HTMLElement[] = [];
  const inputs: HTMLInputElement[] = [];
  const readouts = new Map<string, HTMLElement>();
  let destroyed = false;

  function draw(): TTestStats {
    return plotTTest(panel.surface, { ...forwarded, ...values });
  }

  /** Read one control into a fresh set of values. */
  function withControl(input: HTMLInputElement): TTestValues {
    const numeric = Number(input.value);
    switch (input.name) {
      case "diff":
        return { ...values, diff: numeric };
      case "sd":
        return { ...values, sd: numeric };
      case "n":
        return { ...values, n: numeric };
      case "alpha":
        return { ...values, alpha: numeric };
      case ERROR_MATRIX_NAME:
        return { ...values, errorMatrix: input.checked };
      default:
        return values;
    }
  }

  function handleInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    values = withControl(input);
    const readout = readouts.get(input.name);
    if (readout !== undefined) {
      readout.textContent = input.value;
    }
    stats = draw();
  }

  /** Add one control to the panel and start listening to it. */
  function mount(wrapper: HTMLElement, input: HTMLInputElement): void {
    panel.controls.appendChild(wrapper);
    built.push(wrapper);
    inputs.push(input);
    input.addEventListener("input", handleInput);
  }

  for (const spec of SLIDERS) {
    const { wrapper, input, readout } = buildSlider(
      owner,
      spec.name,
      spec.label,
      spec,
      values[spec.name],
    );
    readouts.set(spec.name, readout);
    mount(wrapper, input);
  }

  const checkboxWrapper = owner.createElement("label");
  checkboxWrapper.style.display = "block";
  const checkbox = owner.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = ERROR_MATRIX_NAME;
  checkbox.checked = values.errorMatrix;
  checkboxWrapper.appendChild(checkbox);
  checkboxWrapper.appendChild(owner.createTextNode(` ${ERROR_MATRIX_LABEL}`));
  mount(checkboxWrapper, checkbox);

  let stats = draw();

  return {
    getValues: () => ({ ...values }),
    getStats: () => stats,
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
