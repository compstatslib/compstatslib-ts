# @compstats/core

[![CI](https://github.com/compstatslib/compstatslib-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/compstatslib/compstatslib-ts/actions/workflows/ci.yml)

Interactive gadgets and plotting functions for data sets and statistical
concepts, in two and three dimensions. This is the browser port of the R
package [`compstatslib`](https://github.com/compstatslib/compstatslib).

Some of it works on **your own data**. Explore any data frame as a rotatable
3D point cloud. Fit a moderated (interaction) regression and rotate its
surface to see how the interaction twists it away from a plane. The rest
**simulates a concept** instead of plotting your data — sampling
distributions, confidence intervals, t-statistics, matrix inversion. That part
is built for class demonstrations, homework, and self-study.

The R original runs in RStudio. This port runs in a browser, with no R
installation and no server. The 2D plots draw on a plain Canvas 2D context.
The 3D plots draw through Plotly, behind a separate entry point, so a page
that shows only 2D never loads it.

## Install

```bash
npm install @compstats/core
# or
bun add @compstats/core
```

Plotly is only needed for the 3D functions. See
[3D and Plotly](#3d-and-plotly) below.

## Quick start

Give an interactive component a canvas. It draws at once, and it redraws on
every click.

```html
<canvas id="plot" width="640" height="480"></canvas>

<script type="module">
  import { interactiveRegression } from "@compstats/core";

  const handle = interactiveRegression(document.querySelector("#plot"), {
    onDone: (points) => console.log(points),
  });

  // Later: read the state, clear it, or stop listening.
  handle.getPoints();
  handle.reset();
  handle.destroy();
</script>
```

The plot functions draw the same picture from data you already hold, and
return what they computed:

```js
import { plotRegression } from "@compstats/core";

const fit = plotRegression(canvas, [
  { x: 1, y: 2 },
  { x: 2, y: 4 },
  { x: 3, y: 5 },
]);

console.log(fit.slope, fit.rSquared);
```

The statistics are separate from the drawing. Import them alone when you want
the numbers and not the picture:

```js
import { linearRegression, principalComponents, tTestStats } from "@compstats/core";
```

Nothing in the `core/` layer touches the DOM, so it also runs under Node or
Bun.

## Use from a CDN

The main bundle is self-contained browser ESM with no imports of its own. A
page can load it directly, with no build step:

```html
<script type="module">
  import { interactiveTTest } from "https://esm.sh/@compstats/core";

  interactiveTTest(document.querySelector("#demo"));
</script>
```

jsDelivr and unpkg serve the same file:

```js
import { interactiveTTest } from "https://cdn.jsdelivr.net/npm/@compstats/core/dist/index.js";
```

## 3D and Plotly

The 3D functions live behind the `@compstats/core/3d` entry point:

```js
import { interactiveScatter3d, moderationData } from "@compstats/core/3d";
```

That entry does not load Plotly either. It reaches the library through a
dynamic import the first time it draws. A caller that passes its own engine in
the `plotly` option never triggers that import:

```html
<script src="https://cdn.jsdelivr.net/npm/plotly.js-dist-min"></script>

<script type="module">
  import { interactiveScatter3d, moderationData } from "https://esm.sh/@compstats/core/3d";

  const handle = interactiveScatter3d(
    document.querySelector("#demo"),
    moderationData,
    { plotly: window.Plotly },
  );
  await handle.rendered();
</script>
```

Pass `plotly` when you load the 3D entry from a raw file CDN such as jsDelivr,
because nothing there resolves the bare `plotly.js-dist-min` specifier. esm.sh
rewrites bare specifiers, so on esm.sh both ways work.

## How the functions are organized

Every family has three parts, and you can use any one of them alone:

- a **core** function that computes the statistics and touches no DOM,
- a **plot** function that draws it on a target you give it,
- an **interactive** component that owns the input and hands each draw to the
  plot function.

The families are grouped below by what they are *for*, because that varies
more than the interaction style does.

### Data sets in 3D

These accept any data frame, with control over axes, color mapping, aspect
ratio, and camera. They come from `@compstats/core/3d`.

| Function | What it does |
| --- | --- |
| `interactiveScatter3d(target, data, opts?)` | Rotatable 3D point cloud, with pickers for x / y / z and color, and sliders for aspect, opacity, and marker size. |
| `plotScatter3d(target, data, opts?)` | The same point cloud from a fixed set of options. |
| `interactiveModeration3d(target, data, opts)` | Fitted moderation surface as a 3D wireframe, with two rotation sliders. |
| `plotModeration3d(target, data, opts)` | The same surface at a stated viewing angle. |
| `moderationSurface(data, opts)` | The fit and the prediction grid behind both, as plain numbers. |

### 2D relationships

These plot x / y points you supply, together with a fitted model. They are
sized for small data — points clicked in by hand, or a modest table — and not
for arbitrary data. `plotRegression` draws in a fixed window of -5 to 50, and
the PCA functions expect points with an `x` and a `y`.

| Function | What it does |
| --- | --- |
| `interactiveRegression(canvas, opts?)` | Click to add points. The line, the mean crosshair, and the statistics update on every click. |
| `plotRegression(target, points, opts?)` | The same picture from points you hold. Returns the fit. |
| `interactiveLogit(canvas, opts?)` | Click to add points. A logistic curve and its statistics update with them. |
| `plotLogit(target, points, opts?)` | The same picture from points you hold. |
| `interactivePca(canvas, opts?)` | Click to add points. The two component arrows appear from the third point and turn with every point after it. |
| `plotPca(target, points, opts?)` | The same picture, with optional mean centering. |
| `linearRegression(points)`, `logisticRegression(points, opts?)`, `principalComponents(points)` | The three fits, without a picture. |

### Simulations and concept demonstrations

These do not plot your data. They simulate a process, or draw a geometric
object, so that a concept can be watched instead of described.

| Function | What it does |
| --- | --- |
| `interactiveTTest(container, opts?)` | Sliders for difference, standard deviation, sample size, and alpha. The null and alternative t distributions, the rejection region, and the power redraw as they move. |
| `plotTTest(target, opts?)` | The same picture from fixed parameters. Returns the statistics. |
| `interactiveSampling(container, population, opts?)` | Draw samples from a population and watch the sampling statistic build up across repetitions. |
| `plotSampling(target, population, opts?)` | One draw of the three-panel picture. |
| `plotSampleCi(target, opts?)` | Repeated samples from a distribution function, each with its confidence interval, so that coverage becomes visible. |
| `interactiveMatrixInverse(container, opts?)` | Four sliders for the entries of a 2x2 matrix. The matrix and its inverse are drawn as parallelograms. |
| `plotMatrixInverse(target, matrix)` | The same picture from one matrix. Returns the determinant and the inverse. |
| `machinePrecision()` | The smallest number the runtime can add to 1. |

### Bundled data

`moderationData` (200 rows of `y`, `x`, `z`, `w`) and `pcaDegenerate` (16 rows
of `x`, `y`) are the same tables as in the R package, exported from R rather
than regenerated. Both are defaults, so a call with no data still gives a
working demonstration.

### Targets

The click-to-add-points components take a `<canvas>`. The components that own
sliders or menus take a container element and build their controls inside it.
Each one also accepts an explicit `{ surface, element }` pair when you want to
place the drawing surface and the controls yourself.

## Reproducing an interactive session

R's gadgets block until you click Done, and then print the `plot_*()` call
that reproduces the screen. Nothing blocks in a browser. Each component
returns a handle at once, and the handle carries the same state:

```js
const handle = interactiveTTest(container);

handle.getValues(); // the state that reproduces the picture
handle.getStats(); // what the last draw computed
handle.done(); // hand the state to the onDone callback
handle.destroy(); // stop listening and remove what was built
```

`getValues()` returns the options that draw the same picture again. Pass them
straight back to the matching plot function, or to the component itself. State
you would not retype has its own accessor: `getFit()` for PCA, `getState()`
for the accumulated sampling draws, `getSpec()` for the traces and layout of a
3D draw.

## Differences from the R package

The two packages compute the same statistics and draw the same pictures. The
R idioms that a browser has no answer for are handled like this:

- **Names.** `snake_case` becomes `camelCase`. `plot_regr()` is
  `plotRegression()`, as it is in R since 0.8.0.
- **Signatures.** R's positional arguments and `...` become a data argument
  and one options object.
- **Formulas.** `y ~ x * z` has no TypeScript counterpart. Name the columns
  instead: `{ outcome: "y", iv: "x", mod: "z" }`.
- **Data frames.** Point sets are arrays of records. Bundled tables are
  objects of columns.
- **Random numbers.** Draws take an injectable seeded generator, so a demo
  repeats exactly. The stream does not match R's Mersenne Twister, and it is
  not meant to.
- **Devices.** Every plot function takes an explicit target. There is no
  current device.

The core statistics are asserted against values computed in R. The fixtures
live in the R package under `conformance-fixtures/`.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
bun run dev      # demo site on http://localhost:3000
```

Bun is the toolchain: runtime, package manager, test runner, and bundler. The
demo site runs one page per function family and is the fastest way to see a
change.

## Contributors

`@compstats/core` and `compstatslib` are maintained by Soumya Ray.

Daniele Melotti is a co-author of the R package. Several of the plotting and
interactive functions grew out of work he did as a student under Soumya Ray's
supervision, and were then folded back into the package.

Issues and pull requests are welcome.

## License

MIT. See [LICENSE](LICENSE).
