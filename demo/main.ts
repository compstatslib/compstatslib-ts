/**
 * The demo site.
 *
 * One page holds every demo. A button loads the fragment of one function
 * family into `#demo` and starts it. The only job of this site is to show that
 * each family works in a real browser.
 */

import {
  interactiveRegression,
  interactiveTTest,
  machinePrecision,
} from "../src/index";
import type {
  InteractiveRegressionHandle,
  InteractiveTTestHandle,
} from "../src/index";

const precision = document.querySelector("#precision");
if (precision) {
  precision.textContent = String(machinePrecision());
}

const demo = document.querySelector("#demo");

/** The demo that is running now. The page stops it before it starts another. */
let running: InteractiveRegressionHandle | InteractiveTTestHandle | null = null;

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

  // The crisp-canvas recipe from src/plot/target.ts: hold the layout size,
  // grow the pixel store by the screen's density, scale the context once, and
  // hand over a surface that reports layout pixels.
  const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const width = canvas.width;
  const height = canvas.height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("demo: the regression canvas gave no 2D context.");
  }
  ctx.scale(ratio, ratio);

  const handle = interactiveRegression(
    { surface: { ctx, width, height }, element: canvas },
    {
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
    },
  );
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

/** Start the interactive t test in the loaded fragment. */
async function startTTest(): Promise<void> {
  const container = await loadFragment("ttest");
  const host = container.querySelector("#ttest-container");
  const output = container.querySelector("#ttest-values");
  if (!(host instanceof HTMLElement) || output === null) {
    throw new Error("demo: the t-test fragment is incomplete.");
  }

  const handle = interactiveTTest(host, {
    onDone: (values) => {
      output.textContent = [
        `diff = ${values.diff}`,
        `sd = ${values.sd}`,
        `n = ${values.n}`,
        `alpha = ${values.alpha}`,
        `error matrix = ${values.errorMatrix ? "shown" : "hidden"}`,
      ].join("\n");
    },
  });
  running = handle;

  container.querySelector("#ttest-done")?.addEventListener("click", () => {
    handle.done();
  });
}

for (const button of document.querySelectorAll("[data-demo]")) {
  button.addEventListener("click", () => {
    const name = button.getAttribute("data-demo");
    if (name === "regression") {
      void startRegression();
    } else if (name === "ttest") {
      void startTTest();
    }
  });
}
