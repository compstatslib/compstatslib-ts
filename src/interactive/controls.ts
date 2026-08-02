/**
 * The controls the 3D components build, and the rule for where a slider may
 * stand.
 *
 * Both 3D gadgets of the R package are panels of shiny inputs above a plot,
 * and both need the same three things: a labeled slider that shows its own
 * value, a labeled picker, and a line of text for what R would have written
 * to the console. They are here so that the two components differ in what
 * they control, not in how a control is made.
 *
 * The 2D components came first and built their controls inline. The reuse
 * audit at the end of the port found the same builders written out again in
 * each of them, so they share this module too: `interactiveTTest` and
 * `interactiveMatrixInverse` for the slider and the standing rule,
 * `interactiveSampling` for the picker.
 */

/** Where a slider may stand: R's `min`, `max` and `step`. */
export interface SliderRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** A control, its label, and the element the component listens to. */
export interface BuiltSlider {
  /** The label element that holds the caption, the value, and the input. */
  readonly wrapper: HTMLElement;
  readonly input: HTMLInputElement;
  /** The element that shows the current value beside the caption. */
  readonly readout: HTMLElement;
}

/** A picker, its label, and the element the component listens to. */
export interface BuiltSelect {
  readonly wrapper: HTMLElement;
  readonly input: HTMLSelectElement;
}

/** A line of text for what R writes to the console. */
export interface BuiltNote {
  readonly element: HTMLElement;
  /** Show a note, or take the line away when there is none. */
  show(text: string | null): void;
}

/**
 * Correct a starting value to something the slider can stand at.
 *
 * Three rules, in order, taken from the `validate()` of the
 * `ion.rangeSlider.js` that ships inside shiny. A value that is not a number
 * becomes the minimum; a value outside the range moves to the nearer bound; a
 * value that misses the step moves to the nearest step, counted from the
 * minimum.
 *
 * The third rule is not R's — R leaves the handle wherever it was asked to
 * stand — but an HTML range input rounds a step-mismatched value by itself,
 * so a component that kept the asked-for number would draw one picture and
 * show a slider standing at another.
 *
 * @param given The value the caller asked for, or nothing.
 * @param fallback The value R's own argument defaults to.
 * @param range Where the slider may stand.
 * @returns A value on the slider's own grid.
 */
export function startingSliderValue(
  given: number | undefined,
  fallback: number,
  range: SliderRange,
): number {
  if (given === undefined) {
    return fallback;
  }
  if (!Number.isFinite(given)) {
    return range.min;
  }

  const clamped = Math.min(range.max, Math.max(range.min, given));
  // Scaling both sides by the step's own precision keeps a value that sits
  // exactly halfway from rounding the wrong way: 1.25 is 32.5 steps above a
  // minimum of −2, and 3.25 / 0.1 alone lands a hair below that.
  const decimals = decimalsOf(range.step);
  const factor = 10 ** decimals;
  const steps = Math.round(
    ((clamped - range.min) * factor) / (range.step * factor),
  );
  const snapped = Number((range.min + steps * range.step).toFixed(decimals));
  // Every range in this port has its maximum on the step grid, so this only
  // guards a range that does not.
  return Math.min(range.max, snapped);
}

/** Return how many decimals a step carries. */
function decimalsOf(step: number): number {
  return String(step).split(".")[1]?.length ?? 0;
}

/**
 * Build one labeled slider that shows its own value.
 *
 * @param owner The document to build in.
 * @param name The name the component reads the event by.
 * @param label R's own caption.
 * @param range Where the slider may stand.
 * @param value Where it starts. Pass a value `startingSliderValue` returned.
 * @returns The wrapper to append, the input to listen to, and the readout.
 */
export function buildSlider(
  owner: Document,
  name: string,
  label: string,
  range: SliderRange,
  value: number,
): BuiltSlider {
  const wrapper = owner.createElement("label");
  wrapper.style.display = "block";

  const caption = owner.createElement("span");
  caption.textContent = `${label} `;

  const readout = owner.createElement("output");
  readout.textContent = String(value);

  const input = owner.createElement("input");
  input.type = "range";
  input.name = name;
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(value);
  input.style.width = "100%";

  wrapper.appendChild(caption);
  wrapper.appendChild(readout);
  wrapper.appendChild(input);
  return { wrapper, input, readout };
}

/**
 * Build one labeled picker.
 *
 * @param owner The document to build in.
 * @param name The name the component reads the event by.
 * @param label R's own caption.
 * @param choices The options, in the order R lists them. A numeric choice
 *   reaches the DOM as its own text, which is how R's own numeric choices
 *   arrive there.
 * @param selected The option to start on.
 * @returns The wrapper to append, and the input to listen to.
 */
export function buildSelect(
  owner: Document,
  name: string,
  label: string,
  choices: readonly (string | number)[],
  selected: string | number,
): BuiltSelect {
  const wrapper = owner.createElement("label");
  wrapper.style.display = "block";

  const caption = owner.createElement("span");
  caption.textContent = `${label} `;

  const input = owner.createElement("select");
  input.name = name;
  input.style.width = "100%";
  for (const choice of choices) {
    const option = owner.createElement("option");
    option.value = String(choice);
    option.textContent = String(choice);
    input.appendChild(option);
  }
  input.value = String(selected);

  wrapper.appendChild(caption);
  wrapper.appendChild(input);
  return { wrapper, input };
}

/**
 * Build the line that carries what R writes to the console.
 *
 * A library cannot write to a console, and the plot layer therefore returns
 * its message instead of printing it. One element, whose text is replaced,
 * so that a hundred redraws leave one sentence rather than a hundred.
 *
 * @param owner The document to build in.
 * @returns The element to append, and the way to set its text.
 */
export function buildNote(owner: Document): BuiltNote {
  const element = owner.createElement("p");
  element.style.margin = "4px 0 0";
  element.style.fontSize = "12px";
  element.textContent = "";
  element.hidden = true;

  return {
    element,
    show(text: string | null): void {
      element.textContent = text ?? "";
      element.hidden = text === null;
    },
  };
}
