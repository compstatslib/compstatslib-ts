/**
 * The interactive sampling demonstration: press Sample and watch the
 * distribution of the statistic fill in.
 *
 * This is the port of `interactive_sampling()` in
 * `../compstatslib/R/sampling_interactive.R`. R builds a miniUI gadget with
 * two selects and a button, and re-runs `plot_sampling()` when the button is
 * pressed. This module does the same: it owns the controls, one generator, and
 * the state that piles up between draws, and hands every draw to
 * `plotSampling`. It contains no drawing code and no statistics.
 *
 * Three things set this gadget apart from the other three in the port:
 *
 * - **The button is the only thing that draws.** R wires the button to a
 *   trigger and isolates the selects (`shiny::isolate`), so moving a select
 *   changes what the *next* press will do and nothing more. A gadget that
 *   redrew on every change would resample ten thousand values each time a
 *   reader browsed the menu.
 * - **It keeps drawing down one stream.** R reads one global generator, so
 *   each press carries on where the last stopped. One generator is built here
 *   when the component starts and used for every draw after.
 * - **Done hands back the cache.** R's `stopApp(cache())` returns everything
 *   drawn so far; the t-test and logit gadgets return nothing at all.
 *
 * `reset()` has no counterpart in R, as in the other click-collectors. It
 * empties the pile and redraws with no new samples, so the panels come back
 * blank and the window is set again from the population.
 */

import { seededRng } from "../core/rng.js";
import { plotSampling } from "../plot/sampling.js";
import type {
  PlotSamplingOptions,
  PlotSamplingResult,
  SamplingState,
} from "../plot/sampling.js";
import { buildSelect } from "./controls.js";
import { resolveControlTarget } from "./target.js";
import type { ControlTarget } from "./target.js";

/** Everything the panel of controls holds. */
export interface SamplingValues {
  /** How many values each sample takes. R's `sample_size` select. */
  readonly sampleSize: number;
  /** How many samples the next press draws. R's `reps` select. */
  readonly reps: number;
}

/**
 * What the component accepts.
 *
 * The options of `plotSampling` pass through to it, and the sample size and
 * repetition count double as the starting positions of the two selects. This
 * is the equivalent of R's `...` forwarding.
 */
export interface InteractiveSamplingOptions extends PlotSamplingOptions {
  /** What to run on `done()`. */
  readonly onDone?: (state: SamplingState) => void;
}

/** What the caller holds after the component starts. */
export interface InteractiveSamplingHandle {
  /** Return where the two selects stand now. */
  getValues(): SamplingValues;
  /** Return everything drawn so far — R's gadget cache. */
  getState(): SamplingState;
  /** Empty the pile and redraw with no samples. */
  reset(): void;
  /** Hand the accumulated state to the `onDone` callback. */
  done(): void;
  /** Stop listening and take back the controls that were built. */
  destroy(): void;
}

/** R: `choices = c(10, 100, 500, 1000, 5000, 10000)`. */
const SAMPLE_SIZES: readonly number[] = [10, 100, 500, 1000, 5000, 10000];
/** R: `choices = c(1, 5, 10, 50, 100), selected = 1`. */
const REPETITIONS: readonly number[] = [1, 5, 10, 50, 100];

const SAMPLE_SIZE_NAME = "sampleSize";
const SAMPLE_SIZE_LABEL = "Sample size";
const REPS_NAME = "reps";
const REPS_LABEL = "Repetitions";
const BUTTON_LABEL = "Sample";

/**
 * Start an interactive sampling demonstration on a target.
 *
 * The component builds its controls, draws once, and redraws on every press
 * of its button.
 *
 * @param target A container element, or a surface and a controls host. See
 *   `./target.ts`.
 * @param population The values to sample from.
 * @param options Starting values, a done callback, and the options of
 *   `plotSampling`.
 * @returns The handle to the running component.
 * @throws Error If a canvas is passed as the container, or gives no 2D
 *   context.
 */
export function interactiveSampling(
  target: ControlTarget,
  population: readonly number[],
  options: InteractiveSamplingOptions = {},
): InteractiveSamplingHandle {
  // Everything `plotSampling` may grow later stays in `forwarded` and reaches
  // it untouched, so a new plot option needs no edit here.
  const {
    onDone,
    sampleSize,
    reps,
    rng: given,
    state: initial,
    ...forwarded
  } = options;
  const panel = resolveControlTarget(target);

  let values: SamplingValues = {
    // R's selectInput ignores a `selected` that is not one of its choices,
    // and the browser then shows the first option. Snapping to the first
    // choice keeps what is drawn and what the select shows in step.
    sampleSize: chooseFrom(sampleSize, SAMPLE_SIZES),
    reps: chooseFrom(reps, REPETITIONS),
  };

  // One generator for the whole life of the component, so each press carries
  // on where the last stopped. This is why the default is built here and not
  // left to `plotSampling`, which builds a fresh one per call: two presses
  // would then draw down two separate streams.
  const rng = given ?? seededRng(Math.floor(Math.random() * 0x100000000));
  let state: SamplingState | null = initial ?? null;
  let last: PlotSamplingResult;

  const owner = panel.controls.ownerDocument;
  const built: HTMLElement[] = [];
  let destroyed = false;

  function draw(repetitions: number): void {
    last = plotSampling(panel.surface, population, {
      ...forwarded,
      sampleSize: values.sampleSize,
      reps: repetitions,
      rng,
      state,
    });
    state = last.state;
  }

  function handleChange(event: Event): void {
    const input = event.target as HTMLSelectElement;
    const numeric = Number(input.value);
    values =
      input.name === SAMPLE_SIZE_NAME
        ? { ...values, sampleSize: numeric }
        : { ...values, reps: numeric };
  }

  function handlePress(): void {
    draw(values.reps);
  }

  const sizeSelect = buildSelect(
    owner,
    SAMPLE_SIZE_NAME,
    SAMPLE_SIZE_LABEL,
    SAMPLE_SIZES,
    values.sampleSize,
  );
  const repsSelect = buildSelect(
    owner,
    REPS_NAME,
    REPS_LABEL,
    REPETITIONS,
    values.reps,
  );
  const button = owner.createElement("button");
  button.type = "button";
  button.textContent = BUTTON_LABEL;

  for (const wrapper of [sizeSelect.wrapper, repsSelect.wrapper]) {
    panel.controls.appendChild(wrapper);
    built.push(wrapper);
  }
  panel.controls.appendChild(button);
  built.push(button);

  sizeSelect.input.addEventListener("change", handleChange);
  repsSelect.input.addEventListener("change", handleChange);
  button.addEventListener("click", handlePress);

  // R's renderPlot runs as the gadget opens, at the initial settings.
  draw(values.reps);

  return {
    getValues: () => ({ ...values }),
    getState: () => last.state,
    reset() {
      // Drop the pile, then redraw taking no samples: the panels come back
      // empty and the window is set again from the population.
      state = null;
      draw(0);
    },
    done() {
      onDone?.(last.state);
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      sizeSelect.input.removeEventListener("change", handleChange);
      repsSelect.input.removeEventListener("change", handleChange);
      button.removeEventListener("click", handlePress);
      for (const node of built) {
        node.remove();
      }
      panel.release();
    },
  };
}

/** Take the asked-for value if the select offers it, else its first choice. */
function chooseFrom(asked: number | undefined, choices: readonly number[]): number {
  const first = choices[0] as number;
  return asked !== undefined && choices.includes(asked) ? asked : first;
}
