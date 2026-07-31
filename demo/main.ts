/**
 * The demo site.
 *
 * One page holds every demo. A button loads the fragment of one function
 * family into `#demo` and starts it. The only job of this site is to show that
 * each family works in a real browser.
 */

import {
  interactiveLogit,
  interactivePca,
  interactiveRegression,
  interactiveSampling,
  interactiveTTest,
  machinePrecision,
  pcaDegenerate,
  plotSampleCi,
  rnorm,
  seededRng,
} from "../src/index";
import type {
  InteractiveLogitHandle,
  InteractivePcaHandle,
  InteractiveRegressionHandle,
  InteractiveSamplingHandle,
  InteractiveTTestHandle,
  Point,
} from "../src/index";

const precision = document.querySelector("#precision");
if (precision) {
  precision.textContent = String(machinePrecision());
}

const demo = document.querySelector("#demo");

/** The demo that is running now. The page stops it before it starts another. */
let running:
  | InteractiveLogitHandle
  | InteractivePcaHandle
  | InteractiveRegressionHandle
  | InteractiveSamplingHandle
  | InteractiveTTestHandle
  | null = null;

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

/** Start the interactive logit in the loaded fragment. */
async function startLogit(): Promise<void> {
  const container = await loadFragment("logit");
  const canvas = container.querySelector("canvas");
  const output = container.querySelector("#logit-points");
  if (!(canvas instanceof HTMLCanvasElement) || output === null) {
    throw new Error("demo: the logit fragment is incomplete.");
  }

  // The crisp-canvas recipe from src/plot/target.ts, as in the regression
  // demo: hold the layout size, grow the pixel store by the screen's density,
  // scale the context once, and hand over a surface in layout pixels.
  const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const width = canvas.width;
  const height = canvas.height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("demo: the logit canvas gave no 2D context.");
  }
  ctx.scale(ratio, ratio);

  const handle = interactiveLogit(
    { surface: { ctx, width, height }, element: canvas },
    {
      onDone: (points) => {
        output.textContent =
          points.length === 0
            ? "No points yet."
            : points
                .map((point) => `x = ${point.x.toFixed(2)}, y = ${point.y}`)
                .join("\n");
      },
    },
  );
  running = handle;

  container.querySelector("#logit-done")?.addEventListener("click", () => {
    handle.done();
  });
  container.querySelector("#logit-reset")?.addEventListener("click", () => {
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

/** Start the interactive sampling demonstration in the loaded fragment. */
async function startSampling(): Promise<void> {
  const container = await loadFragment("sampling");
  const host = container.querySelector("#sampling-container");
  const output = container.querySelector("#sampling-state");
  if (!(host instanceof HTMLElement) || output === null) {
    throw new Error("demo: the sampling fragment is incomplete.");
  }

  // The population is seeded, so the page shows the same bimodal shape on
  // every load — R's own example, c(rnorm(1e5, 4), rnorm(1e5, -4)), at half
  // the size. The draw stream is left unseeded: pressing Sample after a
  // reload gives new samples, which is the point of the demonstration.
  const populationRng = seededRng(42);
  const population = [
    ...rnorm(populationRng, 50000, { mean: 4, sd: 1 }),
    ...rnorm(populationRng, 50000, { mean: -4, sd: 1 }),
  ];

  const handle = interactiveSampling(host, population, {
    onDone: (state) => {
      const count = state.sampleTheta.length;
      const shown = state.sampleTheta
        .slice(-5)
        .map((theta) => theta.toFixed(4))
        .join(", ");
      output.textContent = [
        `statistics collected = ${count}`,
        `window = ${state.xMin.toFixed(3)} .. ${state.xMax.toFixed(3)}`,
        count === 0 ? "no values" : `last values: ${shown}`,
      ].join("\n");
    },
  });
  running = handle;

  container.querySelector("#sampling-done")?.addEventListener("click", () => {
    handle.done();
  });
  container.querySelector("#sampling-reset")?.addEventListener("click", () => {
    handle.reset();
    output.textContent = "No draws yet.";
  });
}

/** Start the interactive PCA in the loaded fragment. */
async function startPca(): Promise<void> {
  const container = await loadFragment("pca");
  const canvas = container.querySelector("canvas");
  const output = container.querySelector("#pca-fit");
  const meancenter = container.querySelector("#pca-meancenter");
  if (
    !(canvas instanceof HTMLCanvasElement) ||
    output === null ||
    !(meancenter instanceof HTMLInputElement)
  ) {
    throw new Error("demo: the PCA fragment is incomplete.");
  }

  // The crisp-canvas recipe from src/plot/target.ts, as in the regression
  // demo. It matters more here: the asp = 1 window widens with the surface,
  // so a wrong size shifts every click to a plausible but wrong coordinate
  // instead of breaking the picture visibly.
  const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const width = canvas.width;
  const height = canvas.height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("demo: the PCA canvas gave no 2D context.");
  }
  ctx.scale(ratio, ratio);

  // The component takes points only at construction, so loading the bundled
  // dataset or flipping mean-centering restarts it — which also exercises
  // destroy() in a real browser, something no other demo does.
  const begin = (initialPoints: readonly Point[]): InteractivePcaHandle =>
    interactivePca(
      { surface: { ctx, width, height }, element: canvas },
      {
        initialPoints,
        meancenter: meancenter.checked,
        onDone: ({ points, fit }) => {
          if (fit === null) {
            output.textContent = `points = ${points.length}\nAdd a third point to see the components.`;
            return;
          }
          const loading = (pc: readonly [number, number]): string =>
            `(${pc[0].toFixed(4)}, ${pc[1].toFixed(4)})`;
          output.textContent = [
            `points = ${points.length}`,
            `sdev   = ${fit.sdev[0].toFixed(4)}, ${fit.sdev[1].toFixed(4)}`,
            `PC1    = ${loading(fit.rotation[0])}`,
            `PC2    = ${loading(fit.rotation[1])}`,
            `center = ${loading([fit.center.x, fit.center.y])}`,
          ].join("\n");
        },
      },
    );

  let handle = begin([]);
  running = handle;

  const restart = (points: readonly Point[]): void => {
    handle.destroy();
    handle = begin(points);
    running = handle;
  };

  container.querySelector("#pca-done")?.addEventListener("click", () => {
    handle.done();
  });
  container.querySelector("#pca-reset")?.addEventListener("click", () => {
    handle.reset();
    output.textContent = "No points yet.";
  });
  container.querySelector("#pca-load")?.addEventListener("click", () => {
    restart(pcaDegenerate);
  });
  meancenter.addEventListener("change", () => {
    restart(handle.getPoints());
  });
}

/** Start the sample-CI demonstration in the loaded fragment. */
async function startSampleCi(): Promise<void> {
  const container = await loadFragment("sampleci");
  const canvas = container.querySelector("canvas");
  const output = container.querySelector("#sampleci-summary");
  if (!(canvas instanceof HTMLCanvasElement) || output === null) {
    throw new Error("demo: the sample-CI fragment is incomplete.");
  }

  // The crisp-canvas recipe from src/plot/target.ts, as in the regression
  // and logit demos: hold the layout size, grow the pixel store by the
  // screen's density, scale the context once, and hand over a surface in
  // layout pixels.
  const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const width = canvas.width;
  const height = canvas.height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("demo: the sample-CI canvas gave no 2D context.");
  }
  ctx.scale(ratio, ratio);

  // One seeded generator for the page: every press draws the next picture of
  // one reproducible sequence, so a reload replays what the reader saw.
  const rng = seededRng(7);
  const draw = (): void => {
    const simulation = plotSampleCi({ ctx, width, height }, { rng });
    const missing = simulation.intervals.filter(
      (interval) => interval.excludesPopulationMean,
    ).length;
    output.textContent = [
      `population mean = ${simulation.populationMean.toFixed(4)}`,
      `samples missing it = ${missing} of ${simulation.intervals.length}`,
    ].join("\n");
  };
  draw();

  container.querySelector("#sampleci-again")?.addEventListener("click", draw);
}

for (const button of document.querySelectorAll("[data-demo]")) {
  button.addEventListener("click", () => {
    const name = button.getAttribute("data-demo");
    if (name === "regression") {
      void startRegression();
    } else if (name === "logit") {
      void startLogit();
    } else if (name === "ttest") {
      void startTTest();
    } else if (name === "sampling") {
      void startSampling();
    } else if (name === "sampleci") {
      void startSampleCi();
    } else if (name === "pca") {
      void startPca();
    }
  });
}
