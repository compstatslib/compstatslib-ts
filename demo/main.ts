/**
 * The demo site.
 *
 * One page holds every demo. A button loads the fragment of one function
 * family into `#demo` and starts it. The only job of this site is to show that
 * each family works in a real browser.
 */

import { interactiveRegression, machinePrecision } from "../src/index";
import type { InteractiveRegressionHandle } from "../src/index";

const precision = document.querySelector("#precision");
if (precision) {
  precision.textContent = String(machinePrecision());
}

const demo = document.querySelector("#demo");

/** The demo that is running now. The page stops it before it starts another. */
let running: InteractiveRegressionHandle | null = null;

/** Load a fragment into `#demo`. */
async function loadFragment(name: string): Promise<Element> {
  running?.destroy();
  running = null;
  const response = await fetch(`/${name}.html`);
  if (demo === null) {
    throw new Error("demo: the page has no #demo element.");
  }
  demo.innerHTML = await response.text();
  return demo;
}

/** Start the interactive regression in the loaded fragment. */
async function startRegression(): Promise<void> {
  const container = await loadFragment("regression");
  const canvas = container.querySelector("canvas");
  const output = container.querySelector("#regression-points");
  if (!(canvas instanceof HTMLCanvasElement) || output === null) {
    throw new Error("demo: the regression fragment is incomplete.");
  }

  const handle = interactiveRegression(canvas, {
    onDone: (points) => {
      output.textContent =
        points.length === 0
          ? "No points yet."
          : points
              .map(
                (point) =>
                  `x = ${point.x.toFixed(2)}, y = ${point.y.toFixed(2)}`,
              )
              .join("\n");
    },
  });
  running = handle;

  container.querySelector("#regression-done")?.addEventListener("click", () => {
    handle.done();
  });
  container
    .querySelector("#regression-reset")
    ?.addEventListener("click", () => {
      handle.reset();
      output.textContent = "No points yet.";
    });
}

for (const button of document.querySelectorAll("[data-demo]")) {
  button.addEventListener("click", () => {
    if (button.getAttribute("data-demo") === "regression") {
      void startRegression();
    }
  });
}
