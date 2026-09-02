# @compstats/core

[![npm](https://img.shields.io/npm/v/@compstats/core)](https://www.npmjs.com/package/@compstats/core)
[![CI](https://github.com/compstatslib/compstatslib-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/compstatslib/compstatslib-ts/actions/workflows/ci.yml)

**Statistical routines for TypeScript, checked against R.**

The package brings statistical primitives and visualization tools to the TypeScript/JavaScript ecosystem. In both sets of features, this package seeks to attain reasonable parity with equivalent functions from the [R platform](https://www.r-project.org) where statistical routines are well vetted. The routines are largely ported from R implementations and the test suite compares each routine against equivalent procedures run in R on the same input and pins the answer to R's output, given a tolerance. The long-term vision of this package is to bring more of R's statistical judgment and rigor into TypeScript/JavaScript.

**Vision.** This package aims to bring more of R's core algorithms and computational approach to TypeScript/JavaScript. We hope this allows porting of R packages to TS/JS with near exact precision as R. We also hope that exposing R's core routines allows for building higher level statistical routines. As of now, there is no general framework for generalized linear models beyond logistic regression, and no singular value decomposition. But such features will likely be added in the future based on demand.

## Features

**For statistical tasks**, this package: (1) provides types for vector, dataframe, and matrix representations; and (2) fits linear models, factors matrices, finds principal components, minimizes functions, and evaluates distributions. The statistical routines can run browser-side or server-side, and can be used in both TypeScript and JavaScript. They have an entry point of their own that reaches no drawing code at all, and a test walks its module graph on every run to keep that true.

- **Matrices and linear algebra.** A plain matrix type with multiplication, transpose, inverse, determinant, condition number, and the two workhorse factorizations (QR and LU) that every solver and model fit is built on, plus the Cholesky factor and its inverse for symmetric positive-definite work, covariance and correlation matrices, symmetric eigendecomposition and principal components.
- **Models.** Fit a linear model from a table of columns and a list of terms, interactions included, and read back coefficients, standard errors, t and p values, R², the F statistic, fitted values and residuals. Fit logistic regression using data with a binary column.
- **Optimization.** A general-purpose minimizer, R's BFGS, ported from R's own routine, so the line search, the stopping rule and the tallies of function and gradient calls follow R's implementation. Users may supply a gradient, or let it take central finite differences at R's own step.
- **Distributions and special functions.** The normal, chi-square and Student t distributions — densities, cumulative probabilities and quantiles — each following R's own source, with the noncentral cases and the upper tail available as a real argument rather than one minus the lower, which is what keeps a probability of a billionth of a billionth from rounding away. The gamma and beta functions underneath them are exported in their own right, log-scaled and regularized where the tails need it.
- **Random draws.** Reproducible draws from the uniform, normal, t, log-normal and Cauchy distributions, and sampling without replacement, all from a seeded generator you pass in, so a demonstration or a test repeats exactly.
- **Summaries and shaping.** Means, medians, standard deviations and quantiles that follow the same definitions R uses; kernel density estimation with its bandwidth rule; histogram binning with its bin-count rule; and the algorithm that picks readable axis tick marks.
- **Parity with R, and a choice about it.** Each routine is checked against values R itself produces, within a tolerance. Every routine that multiplies rounds each product once, through a software fused multiply-add, so a result is R's double bit for bit rather than Javascript's approximation. Where throughput matters more than exact precision, some routines take an option for plain arithmetic instead, yielding over an order of magnitude speedup in exchange for very small changes in the last few decimal places of precision.

**For visualization tasks**, this package ports functions from its R sibling [`compstatslib`](https://github.com/compstatslib/compstatslib).

- **3D point clouds.** Explore any table as a rotatable 3D point cloud.
- **Moderation surfaces.** Fit a moderated (interaction) regression and turn its surface to watch the interaction twist it away from a plane.
- **Click-to-fit canvases.** Click points onto a canvas and see a regression line, a logistic curve or a principal-component axis follow your mouse.
- **Concept simulations.** Other components simulate a concept rather than your data — sampling distributions, confidence intervals, t-tests, matrix inversion — for class demonstrations, homework and self-study.

Those demonstrations are also what the statistics were built for, and they are the standing proof that the statistics work.

The 2D plots draw on a plain Canvas 2D context. The 3D plots draw through Plotly.

## Install

```bash
npm install @compstats/core
# or
bun add @compstats/core
```

The core install is small, because it has no large dependencies. Plotly is an **optional peer dependency**: the package declares it, but no package manager installs it for you. A page that only computes statistics, or only plots in 2D, never downloads it.

Add Plotly yourself when you use the 3D functions:

```bash
npm install plotly.js-dist-min
# or
bun add plotly.js-dist-min
```

See [3D and Plotly](#3d-and-plotly) below.

### Entry points

Four, so that a page pays only for what it asks for. Sizes are the built bundles, minified by the bundler and not gzipped:

| Import from | Carries | Size |
| --- | --- | --- |
| `@compstats/core` | everything below except the 3D plots: the statistics, the data, and the 2D plotting and interactive layers | 176 KB |
| `@compstats/core/stats` | the statistics, the simulation helpers and the bundled data. **No DOM** — no canvas, no document, no window | 120 KB |
| `@compstats/core/linalg` | the general linear algebra: `matrix`, `qr`, `solve`, `lm`, `eigen`, `prcomp` | 75 KB |
| `@compstats/core/3d` | the 3D plots, which need Plotly as a peer dependency | 93 KB |

`@compstats/core/stats` is for a consumer that computes and draws its own charts, or computes on a server or in a worker. Its module graph reaches no `plot/` or `interactive/` module, and a test walks the graph on every run rather than trusting the convention. The root entry re-exports every one of its names, so moving between the two is a change of specifier and nothing else.

`@compstats/core/linalg` is deliberately disjoint from the others: it is a general library on its own pace, not statistics the plots need.

## Quick start

Fit a model. Your data is a table of columns; the model is the outcome and a list of terms, where an array of names is an interaction:

```js
import { lm } from "@compstats/core/linalg";
import { moderationData } from "@compstats/core";

const fit = lm(moderationData, { outcome: "y", terms: ["x", "z", ["x", "z"]] });

fit.coefficients.names;         // ["(Intercept)", "x", "z", "x:z"]
fit.coefficients.values;        // [-0.0452945…, 0.4720139…, 0.3136202…, 0.8481828…]
fit.standardErrors.values[3];   // 0.019869806719131564
fit.pValues.values[3];          // 3.4056449407081656e-101
fit.rSquared;                   // 0.9203966770597701
fit.sigma;                      // 1.0301490130678368
```

Summaries, correlations and reproducible random draws come the same way. The generator is passed in, never taken from `Math.random`, so the same seed gives the same numbers on every run and in every browser:

```js
import { cor } from "@compstats/core/linalg";
import { sd, quantile, seededRng, rnorm } from "@compstats/core";

cor(moderationData.x, moderationData.z);   // -0.08036538677894722
sd(moderationData.y);                      //  3.6235641115369814

const draws = rnorm(seededRng(42), 1000, { mean: 100, sd: 15 });
quantile(draws, 0.975);                    // 129.24422658630283
```

Every number above is produced by the package and matched against the value R returns for the same input.

None of that touches the DOM, so it runs under Node and Bun as readily as in a browser. When you do want a picture, hand a component a canvas — it draws at once and redraws on every click:

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

The plot functions draw the same picture from data you already hold, and return what they computed:

```js
import { plotRegression } from "@compstats/core";

const fit = plotRegression(canvas, [
  { x: 1, y: 2 },
  { x: 2, y: 4 },
  { x: 3, y: 5 },
]);

console.log(fit.slope, fit.rSquared);
```

## Use from a CDN

The main bundle is self-contained browser ESM with no imports of its own. A page can load it directly, with no build step:

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

That entry does not load Plotly either. It reaches the library through a dynamic import the first time it draws. A caller that passes its own engine in the `plotly` option never triggers that import:

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

Pass `plotly` when you load the 3D entry from a raw file CDN such as jsDelivr, because nothing there resolves the bare `plotly.js-dist-min` specifier. esm.sh rewrites bare specifiers, so on esm.sh both ways work.

Under a bundler, the dynamic import needs Plotly in your own dependencies. If it is absent, the load fails with `Cannot find package 'plotly.js-dist-min'`. The two cures are the same two paths: install the optional peer, or pass your own engine in the `plotly` option and let the dynamic import stay unreached.

## How the functions are organized

Every family has three parts, and you can use any one of them alone:

- a **core** function that computes the statistics and touches no DOM,
- a **plot** function that draws it on a target you give it,
- an **interactive** component that owns the input and hands each draw to the plot function.

The families are grouped below by what they are *for*, because that varies more than the interaction style does.

### Data sets in 3D

These accept any data frame, with control over axes, color mapping, aspect ratio, and camera. They come from `@compstats/core/3d`.

| Function | What it does |
| --- | --- |
| `interactiveScatter3d(target, data, opts?)` | Rotatable 3D point cloud, with pickers for x / y / z and color, and sliders for aspect, opacity, and marker size. |
| `plotScatter3d(target, data, opts?)` | The same point cloud from a fixed set of options. |
| `interactiveModeration3d(target, data, opts)` | Fitted moderation surface as a 3D wireframe, with two rotation sliders. |
| `plotModeration3d(target, data, opts)` | The same surface at a stated viewing angle. |
| `moderationSurface(data, opts)` | The fit and the prediction grid behind both, as plain numbers. |

### 2D relationships

These plot x / y points you supply, together with a fitted model. They are sized for small data — points clicked in by hand, or a modest table — and not for arbitrary data. `plotRegression` draws in a window of -5 to 50 unless you give it `xlim` and `ylim`, and the PCA functions expect points with an `x` and a `y`.

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

These do not plot your data. They simulate a process, or draw a geometric object, so that a concept can be watched instead of described.

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

### Statistics without a picture

The routines the plots are built on are exported in their own right, because an application built on this package needs them for the same reason the plots did. Each follows the definition R uses — there is more than one reasonable definition of a quantile, of a histogram's bin count, of a kernel bandwidth, and picking a different one silently changes results — and the test suite pins each to the value R returns.

| Group | Functions |
| --- | --- |
| Descriptives | `mean`, `median`, `sd`, `quantile`, `quantiles`, `meanAbsoluteDeviation` |
| Student t distribution | `dt`, `pt`, `qt`, central and noncentral, with `lowerTail` for a far tail, and the `normalCdf`, `incompleteBeta` and `inverseIncompleteBeta` they stand on |
| Chi-square distribution | `pchisq`, `qchisq`, central and noncentral, with `lowerTail` for a far tail, and the `regularizedGammaP`, `regularizedGammaQ` and their log forms they stand on (R's `pgamma`) |
| Normal distribution | `pnorm`, `qnorm`, with `mean`, `sd` and `lowerTail` |
| Seeded random draws | `seededRng`, `runif`, `rnorm`, `rt`, `rlnorm`, `rcauchy`, `sampleWithoutReplacement` |
| Binning and density | `histogram`, `nclassSturges`, `kernelDensity`, `bwNrd0` |
| Axis ticks | `rPretty`, `prettyTicks` |
| Fitting and 2x2 matrices | `leastSquares`, `determinant`, `invertMatrix` |
| General optimization | `optim` |

The names say which rule was followed, for anyone checking: `quantile` is type 7, `nclassSturges` is Sturges' rule, `bwNrd0` is the `nrd0` bandwidth, `rPretty` is R's `pretty()`, and the samplers take R's own parameters. The general matrix routines — solving, factorizing, model fitting, principal components — live under [Linear algebra](#linear-algebra) below.

`pchisq`'s noncentral branch follows R's `pnchisq.c`, `qchisq` follows R's `qgamma`, and `qnorm` follows Wichura's Algorithm AS 241. Each is verified against R at a relative tolerance of 1e-12.

`lowerTail: false` is worth reaching for rather than subtracting. On `pt` at 249 degrees of freedom, `1 - pt(t, df)` is already wrong in the eighth digit by `t = 6` and **returns exactly zero from `t = 9` onward**, where R returns 2.98e-17 and keeps going down; a one-sided bootstrap t statistic reaches that range, so the subtraction prints a p-value of 0 where R prints a number. `qt(p, df, ncp, { lowerTail: false })` likewise reaches critical values `qt(1 - p, df)` cannot — at `p = 1e-20` the complement rounds to 1 and the lower-tail call returns infinity. The noncentral branches complement internally, because R's own `pnt.c` and `qnt.c` do; the option still spares the caller the subtraction, it just cannot buy back precision there.

`optim(par, fn, { gr, method: "BFGS", control })` **is** R's optimizer, not merely a routine that lands where R lands. It is `vmmin` from R's `src/main/optim.c`, R Core's arrangement of Nash's algorithm 21: the step-reduction line search, `reltol` on the objective as the sole stopping rule, the inverse-Hessian resets, and R's own accounting. So `counts` is a number to compare with R's — on the fixture cases the port reproduces `fncount` and `grcount` exactly, and reaches R's `par` and `value` bit for bit on the analytic-gradient runs.

> **This changed in 0.6.0, and it moves every `optim` result.** Through 0.5.0 the routine reached R's optimum by its own path — Armijo backtracking, a gradient-norm stopping rule, and counts of its own. A caller that pinned 0.5.0's output re-pins. The controls `gradTol` and `stallGradTol` are gone with the rules they belonged to, and `abstol`, which is R's, takes their place.

**Set the controls; do not inherit them.** R's defaults are R's, and they are not a hand-rolled optimizer's. `reltol` defaults to `sqrt(.Machine$double.eps)`, 1.49e-8, where a hand-written BFGS commonly uses 1e-14 — a consumer that inherited it had its fit stop 21 iterations early, at a gradient norm of 1.6e-5 instead of 1.5e-8, moving parameters by 2.5e-4 and still reporting `convergence: 0`, because stopping on `reltol` *is* convergence in R. `maxit` is the same trap: R's BFGS default is 100. Read `gradNorm` to see where a run actually stopped.

The draws take a generator you pass in, so a demonstration repeats exactly:

```js
import { seededRng, rnorm, quantile } from "@compstats/core";

const rng = seededRng(42);
const draws = rnorm(rng, 1000, { mean: 100, sd: 15 });
quantile(draws, 0.975);
```

### Linear algebra

Matrix arithmetic, the factorizations that solvers and model fits are built on, and the multivariate routines that sit on top of them. They have their own entry point, so a page that only draws never loads them, and they keep R's names — an application that needs a QR decomposition is usually being written by someone who can already read one:

```js
import { matrix, matmul, solve, lm, prcomp } from "@compstats/core/linalg";
```

A matrix is plain data, laid out as R lays it out — **column-major**, with `nrow`, `ncol`, a `Float64Array` of the entries column by column, and optional `dimnames`. `matrix(values, { nrow })` fills column by column as R's `matrix()` does, and `byrow: true` fills by rows. Operations are functions that take matrices and return new ones; nothing modifies its input. Indices are zero-based. A vector is a plain array of numbers: the exported `Vector` type is a name for `readonly number[]` and nothing more, so a JavaScript caller passes an array as it always did.

| Group | Functions |
| --- | --- |
| Building | `matrix`, `withDim`, `fromRows`, `fromColumns`, `fromFrame`, `at`, `row`, `column`, `toRows`, `toColumns`, `matrixIndex` |
| Elementary operations | `t` (or `transpose`), `matmul`, `crossprod`, `tcrossprod`, `outer`, `cbind`, `rbind`, `diag`, `identity` |
| Vectors and elementwise | `add`, `sub`, `mul`, `div` (also take two matrices, or a matrix and a scalar), `square`, `dot`, `norm`, `cosine` |
| QR | `qr`, `qrCoef`, `qrFitted`, `qrResid`, `qrQty`, `qrQy`, `qrQ`, `qrR` |
| LU | `lu`, `solve`, `det`, `determinant`, `rcond`, `matrixNorm` |
| Models | `modelMatrix`, `lm`, `predictLm`, `namedVector`, `lookup` |
| Multivariate | `cov`, `cor`, `variance`, `scale`, `chol`, `chol2inv`, `eigenSymmetric`, `isSymmetric`, `prcomp` |

`cov(x, y)` and `cor(x, y)` take two matrices. `x`'s columns become the result's rows, and `y`'s columns become its columns.

**`cov(x)` and `cov(x, x)` are different functions in R, not two spellings of one.** R's `cov.c` takes a different path for one matrix than for two — the one-matrix form reads each column's spread off the diagonal of the covariance it has just built, the two-matrix form walks the columns again — so they land on different last bits, and `cor` inherits the split. Porting `stats::cor(scores)` as `cor(scores, scores)` therefore does not reproduce R. A consumer that measured this on real data found the one-matrix form exact against R on every cell (16 of 16, and 25 of 25) where passing the matrix to itself managed 13 of 16 and 16 of 25; on two synthetic shapes the two-argument form was exact on 2 of 16 and 7 of 16 cells against 64 of 64. **Match the R call you are porting**: one argument in R means one argument here.

What makes this worth stating rather than filing under rounding is that **a passing test suite will not tell you**. The consumer who found it had R goldens and a green suite before and after the correction, because the residual sat far below the bootstrap re-estimation error its fixtures were toleranced against. It became visible only on comparing `cor(x)` against R directly, on the actual matrix the code correlates. A consumer with feature-level fixtures has no reason to suspect the call form and no test they are likely to have written would raise it — so check the form against the R line, not against your suite. `scale` returns `{ scaled, center, scale }`, with R's `scaled:center` and `scaled:scale` as plain fields. `chol` returns R's upper triangular factor, and `chol2inv` returns its inverse. `predictLm(fit, newdata)` rebuilds the design over a new frame and multiplies it by the fit's coefficients. A row with a missing value comes back as NaN.

`add`, `sub`, `mul`, and `div` are R's elementwise `+`, `-`, `*`, `/` on matrices. Extents must agree, and dimnames follow the first operand. `outer(x, y)` is R's outer product of two vectors.

```js
predictLm(fit, { x: [0, 1], z: [0.5, -1], w: [2, 1] });
```

A model is a term list rather than a formula — R's `y ~ x * z + w` is `{ outcome: "y", terms: ["x", "z", "w", ["x", "z"]] }` — and `lm` returns the coefficients as a named vector in R's order, with `null` where R prints `NA`:

```js
import { lm, solve, matrix } from "@compstats/core/linalg";
import { moderationData } from "@compstats/core";

const fit = lm(moderationData, { outcome: "y", terms: ["x", "z", "w", ["x", "z"]] });
fit.coefficients.names;   // ["(Intercept)", "x", "z", "w", "x:z"]
fit.rSquared;             // 0.9204001958847745

const a = matrix([2, 1, -1, 1, 3, 2, 1, -1, 4], { nrow: 3 });
solve(a, [1, 2, 3]);      // [-0.06666666666666665, 0.8, 0.3333333333333333]
```

Each routine follows R down to the arithmetic of its LAPACK and LINPACK calls, so the factorizations, the solves and the fitted values match R's doubles exactly, and the rest is verified at a stated tolerance. Where R warns and recycles a mismatched length, or silently reads only the lower triangle of a matrix, this entry refuses and says so at the function.

#### Holding your own data in this layout

`Matrix.data` is a public, column-major `Float64Array`, so reading is already free — `toRows` is a convenience, not the only door out. Writing was not: every constructor copied. `withDim(data, { nrow })` is R's `dim(v) <- c(nrow, ncol)` and **adopts** the buffer instead, which is what lets a caller hold its data in this layout across a loop and stop converting at all.

```js
import { matrixIndex, withDim } from "@compstats/core/linalg";

const buffer = new Float64Array(p * p);
const paths = withDim(buffer, { nrow: p, dimnames: [names, names] });
const index = matrixIndex(paths);

for (const outcome of outcomes) {
  const j = index.col(outcome);                  // hoisted out of the fill
  antecedents.forEach((name, k) => {
    buffer[j * p + index.row(name)] = betas[k];  // no setter, no per-cell call
  });
}
```

The buffer **aliases**: R copies on modify, JavaScript does not, and `withDim` does not pretend otherwise — a later write through your handle is visible in the matrix. That is the point, and it is why a caller who wants a snapshot writes `matrix(buffer, options)` and pays the copy knowingly. `byrow` is refused, because filling row by row is the reordering copy this constructor exists to avoid.

`matrixIndex(m)` resolves dimnames to positions — `row(name)`, `col(name)`, and `offset(rowName, colName)` into `data` — built once per call. It is the matrix counterpart of `lookup` on a named vector, and it is an index rather than a getter and setter on purpose: a matrix here is written by whole-array operations, as R's is. Measured on a 24 x 24 result filled by name:

| | time |
| --- | --- |
| fill a `number[][]` by name, then `fromRows` | 47.9 µs |
| fill an adopted buffer through `matrixIndex` | **4.1 µs** |

And at the boundary itself, on a 2000 x 24 frame: `fromRows` costs 540 to 810 µs — it varies with how polymorphic the call site has become — where `withDim` over data already in this layout costs **under a tenth of a microsecond**. It copies nothing, so it is not a faster conversion; it is no conversion.

#### If your data is row-major, adopt it transposed

The paragraph above assumes you can hold your data column-major. **You do not have to.** A row-major buffer is already a column-major matrix — its transpose — so a row-major caller can cross the boundary in both directions for free:

An `n x k` row-major buffer holds element `(i, j)` at `i * k + j`. Read column-major with `nrow = k`, that same index is element `(j, i)`. So `withDim(buf, { nrow: k, ncol: n })` **is** Aᵀ, with nothing reordered. Since `A · B = (Bᵀ · Aᵀ)ᵀ`, multiply in reverse:

```js
// A is n x k and B is k x m, both row-major in flat Float64Arrays
const At = withDim(aBuf, { nrow: k, ncol: n });   // A-transpose, free
const Bt = withDim(bBuf, { nrow: m, ncol: k });   // B-transpose, free
const product = matmul(Bt, At);                   // (A · B)-transpose
// product.data is A · B in ROW-major, n x m, directly usable
```

The result is `(A · B)ᵀ` in column-major, and the buffer of `(A · B)ᵀ` column-major *is* `A · B` row-major — element `(c, r)` sits at `c * m + r` either way. So there is no conversion at either end.

**The accumulation order survives the reversal**, which is the part worth checking rather than assuming: both routes sum over the same inner index in the same order, and each product's operands merely swap, which IEEE multiplication is exact under. Verified bit-identical against the ordinary `fromRows` route with `Object.is` on seven shapes from `1 x 5 · 5 x 1` to `2000 x 24 · 24 x 8`, at **both `fma` settings**. Re-viewing with `withDim` on every call costs nothing measurable, so the identity is usable inside a loop and not merely true on paper. `matmul` never writes to its inputs, and passing the same buffer as both operands is safe.

#### Throughput

Every routine that multiplies rounds each product once, through a software fused multiply-add, so that a result is R's double bit for bit. That costs 10 to 25 times the time of plain arithmetic. Pass `{ fma: false }` to `matmul`, `crossprod`, `tcrossprod`, `qr`, `lu`, `solve`, `det`, `determinant`, `rcond`, `lm` and `leastSquares` to use plain `a * b + c` instead, for a result a few units in the last place away. `qr` and `lu` record the setting on the decomposition, so their readers follow it. A program may mix the two settings without a penalty.

```js
const xtx = crossprod(x, { fma: false });
solve(xtx, crossprod(x, y, { fma: false }), { fma: false });
```

The option's type is `FmaOption`; `QrOptions`, `LuOptions`, `SolveOptions`, `CholOptions` and `LmOptions` extend it, and all are exported from the linalg entry.

**Which routines take the option, and what they default to.** Every routine that accepts `fma` defaults to `true` — that part is uniform, with no exceptions. What varies is whether the option exists at all, and that is where a caller gets caught:

| routine | `fma` option | arithmetic |
| --- | --- | --- |
| `matmul`, `crossprod`, `tcrossprod` | yes | FMA by default |
| `qr`, `lu`, `solve`, `det`, `determinant`, `rcond` | yes | FMA by default |
| `chol`, `chol2inv` | yes | FMA by default |
| `lm`, `leastSquares` | yes | FMA by default |
| `cor(x, y)` — two arguments | yes | FMA by default |
| `cor(x)` — one matrix | **no option** | always plain |
| `cov` — every form | **no option** | always plain |

`cov` is a plain sum in every form because R's `src/library/stats/src/cov.c` is a plain sum, so following R here means not offering the choice — its values pin against R bit for bit either way. `cor(x)` reads its spreads off the diagonal of the covariance matrix it has just built, so it inherits that plain sum; `cor(x, y)` walks each column again, and the build the fixtures come from contracts *that* loop, so it takes the option and defaults to FMA. Two forms of one function, and only one of them accepts the argument.

**The consequence for a caller composing them**: `cov(x, y, { fma: false })` is a compile error (TS2554), not a silent no-op, so a blanket "pass `{ fma: false }` everywhere" rule will not typecheck. Pass it to the routines above that take it, and leave `cov` alone — it is already plain.

**Which setting you want is decided by your acceptance bar, not by your patience.** The default is named after the guarantee it provides, and the guarantee is narrow: *R's double*, not *R's answer*. If you pin fixtures against R at 15 or 17 digits — porting a routine, reproducing published output — you need it, and the 10 to 25 times is the price of the last two or three digits. If your bar is R's answer to five decimal places, you are paying that price for a property you never assert on, and `{ fma: false }` is the right default for you.

So `{ fma: false }` is **not "the fast one"**. It is a different answer. On a well-conditioned problem the difference is invisible; near a conditioning threshold it need not be, because the units in the last place a decomposition drops are amplified by the condition number on the way out. Switch deliberately, and re-pin whatever the switch moves.

**Time it end to end, not per operation.** These ratios are measured through the matrix type. If your data lives in `number[][]`, `fromRows` and `toRows` sit at each end and cost more than the operation between them. Measured on a 2000 x 24 frame, median per call:

| computation | a hand-written loop over `number[][]` | through `Matrix`, `{ fma: false }` | over an adopted buffer, `{ fma: false }` | over an adopted buffer, default |
| --- | --- | --- | --- | --- |
| OLS, 6 predictors | 142 µs | 461 µs | **148 µs** | 1.91 ms |
| `matmul` n x 24 · 24 x 8 | 624 µs | 1.31 ms | **322 µs** | 8.14 ms |
| `cor` 24 x 24 | 863 µs | 2.34 ms | **730 µs** | 3.67 ms |

Converting at each end costs 811 µs in and 397 µs out in this benchmark's run, which is more than any operation in the table — so through `Matrix` the plain path *loses* on all three. Hold your data as a column-major `Float64Array` and open it with `withDim` (above) and it wins or ties on all three, because there is nothing to convert. The last column is what R's double costs at that boundary: 6 to 25 times the loop.

One caveat on that first column, since it is easy to over-read: those loops hold `number[][]`, so the gap between them and the adopted column is the representation *and* the arithmetic together. Hold the representation fixed and the arithmetic is a tie — see the table below.

**What adopting buys, measured against the right control.** Almost all of it is the *representation*, not this package's arithmetic. Three baselines, one run, 5000 warm-up iterations, median per call — A is a hand-written loop over `number[][]` with hoisted row pointers and a zero skip; B is the same arithmetic over flat row-major buffers with a caller-held output; C is `matmul` over buffers adopted transposed:

| computation | A: `number[][]` loop | B: flat loop | C: adopted transposed | B/C |
| --- | --- | --- | --- | --- |
| `matmul` 250 x 6 · 6 x 6 | 15.2 µs | 9.9 µs | 9.7 µs | 1.02x |
| `matmul` 250 x 24 · 24 x 6 (sparse rhs) | 68.4 µs | 36.6 µs | 36.4 µs | 1.01x |
| `matmul` 250 x 24 · 24 x 6 | 71.7 µs | 36.4 µs | 36.2 µs | 1.01x |
| `matmul` 250 x 24 · 24 x 24 | 233.4 µs | 128.2 µs | 128.5 µs | 1.00x |
| `matmul` 1000 x 24 · 24 x 8 | 360.6 µs | 186.5 µs | 185.7 µs | 1.00x |
| `matmul` 2000 x 24 · 24 x 8 | 724.6 µs | 376.6 µs | 368.7 µs | 1.02x |

B allocates its output, as C does, so the two are comparable. Letting B write into a buffer the caller already holds — which C cannot do — takes another 2 to 3% off it.

**Read the B/C column: this package's `matmul` is within 3% of a loop tuned for the caller's own layout, at every shape.** That is a tie, and it is the honest claim. The roughly 2x between A and B is what leaving arrays-of-arrays is worth — allocating `n` small arrays per call and chasing their pointers — and it is available to a caller who never touches this package.

So the reason to adopt is not that these routines are faster. It is that once your data is a flat buffer, `qr`, `lm`, `solve`, `chol`, `cor` and the rest are available over it with no boundary in either direction, at R's numbers. Speed is not the argument; reach is.

#### Reusing one centering across many pairings

`cov(a, b)` and `cor(a, b)` center both operands on every call, so pairing the blocks of one matrix against each other re-centers the same columns once per pairing. Center once with `scale` and take crossproducts of the slices instead:

```js
const centered = scale(x, { scale: false }).scaled;
// crossprod(slice_a, slice_b, { fma: false }) / (n - 1)  is  cov(slice_a, slice_b)
```

Measured on a 250 x 24 matrix in blocks of four columns: **1.5x over `cov` per pairing at 15 pairings, 1.7x at 45**, and 1.5x at n = 500. The saving grows with the number of pairings, which is the case it is for — a single pairing should just call `cov`.

**Pass `{ fma: false }` to `crossprod`, and read this before you don't.** `cov(x, y)` is a plain sum, as R's `cov.c` is, and takes no `fma` option at all; `crossprod` takes one and defaults to the software fused multiply-add. Take the default and you pay **8.7x on the crossproduct** — 84.2 µs against `cov`'s 9.7 µs on the same 250 x 4 operands — which turns the whole recipe from a 1.5x win into a 7x loss, and lands on different last bits than `cov` besides. This is the `FmaOption` warning in its most concrete form: the two routines default differently because they follow different R sources, and matching them is the caller's job here.

The accuracy caveat is small and worth stating. `cov` refines each column mean (`m + mean(x - m)`) where `scale` takes the plain `colMeans`, so the two agree to about 7e-15 relative on ordinary data and lose roughly three digits — 2.3e-11 at a column offset of 1e9 — on columns dominated by a large constant. The whole of that gap is the mean, not the crossproduct. Passing `cov`'s refined means as `scale`'s `center` closes it:

```js
const refined = columns.map((col) => {
  const m = col.reduce((a, b) => a + b, 0) / n;
  return m + col.reduce((a, b) => a + (b - m), 0) / n;  // what cov() uses
});
scale(x, { scale: false, center: refined });
```

`scale.test.ts` pins both the agreement and the gap.

### Bundled data

`moderationData` (200 rows of `y`, `x`, `z`, `w`) and `pcaDegenerate` (16 rows of `x`, `y`) are the same tables as in the R package, exported from R rather than regenerated. Both are defaults, so a call with no data still gives a working demonstration.

### Targets

The click-to-add-points components take a `<canvas>`. The components that own sliders or menus take a container element and build their controls inside it. Each one also accepts an explicit `{ surface, element }` pair when you want to place the drawing surface and the controls yourself.

## Reproducing an interactive session

R's gadgets block until you click Done, and then print the `plot_*()` call that reproduces the screen. Nothing blocks in a browser. Each component returns a handle at once, and the handle carries the same state:

```js
const handle = interactiveTTest(container);

handle.getValues(); // the state that reproduces the picture
handle.getStats(); // what the last draw computed
handle.done(); // hand the state to the onDone callback
handle.destroy(); // stop listening and remove what was built
```

`getValues()` returns the options that draw the same picture again. Pass them straight back to the matching plot function, or to the component itself. State you would not retype has its own accessor: `getFit()` for PCA, `getState()` for the accumulated sampling draws, `getSpec()` for the traces and layout of a 3D draw.

## Differences from the R package

The two packages compute the same statistics and draw the same pictures. The R idioms that a browser has no answer for are handled like this:

- **Names.** `snake_case` becomes `camelCase`. `plot_regr()` is `plotRegression()`, as it is in R since 0.8.0.
- **Signatures.** R's positional arguments and `...` become a data argument and one options object.
- **Formulas.** `y ~ x * z` has no TypeScript counterpart. Name the columns instead: `{ outcome: "y", iv: "x", mod: "z" }`.
- **Data frames.** Point sets are arrays of records. Bundled tables are objects of columns.
- **Random numbers.** Draws take an injectable seeded generator, so a demo repeats exactly. The stream does not match R's Mersenne Twister, and it is not meant to.
- **Devices.** Every plot function takes an explicit target. There is no current device.

Two things the port adds. It exports the statistical primitives that base R hands the R package for free — descriptives, the t distribution, seeded samplers, binning, density, axis ticks and small linear algebra, listed under [Statistics without a picture](#statistics-without-a-picture). And it carries a general [linear-algebra entry](#linear-algebra) — a column-major matrix, `solve`, `qr`, `lm`, `prcomp` and the rest — for the same reason. Both are additions, not divergences: each routine follows its R counterpart's rule and is tested against R's output.

The core statistics are asserted against values computed in R. The fixtures live in the R package under `conformance-fixtures/`.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
bun run dev      # demo site on http://localhost:3000
```

Bun is the toolchain: runtime, package manager, test runner, and bundler. The demo site runs one page per function family and is the fastest way to see a change.

## Contributors

`@compstats/core` and `compstatslib` are maintained by Soumya Ray.

Daniele Melotti is a co-author of the R package. Several of the plotting and interactive functions grew out of work he did as a student under Soumya Ray's supervision, and were then folded back into the package.

Issues and pull requests are welcome.

## License

MIT. See [LICENSE](LICENSE).

### Attribution

The package has no runtime dependencies and copies no third-party source
file. It does reimplement numerical algorithms that other people wrote, which
is unavoidable given the goal: returning the double R returns means following
the algorithm R follows, and in several places the arrangement R gives it —
the order of a loop, where a series is cut off, which branch a value takes.

[NOTICE](NOTICE) records where that work came from. In summary:

- **R** (GPL-2 or later, The R Core Team). The chi-square, normal and
  non-central t routines follow R's `nmath` sources, and the covariance and
  QR routines follow R's own C and Fortran. Two pieces are R Core's own
  contributions rather than transcriptions of published algorithms, and are
  called out individually in NOTICE: the far-tail expansion in `qnorm` due to
  Martin Maechler, and the regime split and tolerances in the non-central
  chi-square. R is not bundled, linked, or called at runtime; it is a
  separate program used to generate the reference values the tests pin.
- **Applied Statistics algorithms** AS 91, AS 109, AS 241, AS 243 and AS 275,
  copyright the Royal Statistical Society, implemented from their published
  descriptions.
- **LAPACK** (three-clause BSD) and **LINPACK**, whose reference loop orders
  the Cholesky, LU and QR factorizations follow.
- Standard published results — Lanczos, Abramowitz and Stegun, Dekker,
  Sturges, Silverman, Nash — listed individually in NOTICE.

If you need any of that upstream code itself rather than an independent
reimplementation of the method, take it from its own project under its own
terms.
