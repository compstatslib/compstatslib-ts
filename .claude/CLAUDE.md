# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Package Overview

`compstatslib-ts` is a TypeScript port of the
[`compstatslib`](https://github.com/soumyaray/compstatslib) R package — a
teaching library of interactive visualizations and plotting functions for
computational statistics concepts.

The R original runs inside RStudio (shiny/miniUI gadgets, base-R graphics,
plotly). **The reason this port exists is to run the same demonstrations
client-side in a browser**, so that the interactive teaching tools work from a
web page with no R installation. Every design decision should be weighed
against that goal.

The R source lives at `../compstatslib/` — read it directly when porting a
function rather than guessing at behavior.

## Downstream Consumers

This package is a library. Its primary consumer is the browser app at
`../compstats-webapp/` (`compstats`), which builds a client-side statistics
workbench on top of it. It consumes the **published package from npm**, not a
link to this checkout — verified 2026-09-01, when it held a real installed
`@compstats/core@0.5.0`. (An earlier version of this file said it was a Bun
link; that was stale, and the difference matters: nothing downstream sees a
change here until it is released.) A second consumer, `seminr-ts` at
`../../sem-in-r/seminr-ts/`, likewise installs from npm and delegates four
modules under `src/math/` to this package. Apps of that shape — static,
client-side, Bun + bundler — are the expected audience, so weigh API decisions
from a consuming app's point of view, not only the demo site's.

What this means when working here:

- **Changes can arrive from the webapp side.** A Claude Code session running
  in `../compstats-webapp/` may commit or propose changes in this repo to add
  functionality that app needs. Treat such commits as normal contributions:
  they still have to obey this file's architecture, TDD, and conformance
  rules. If a commit lands here with no matching test or with drawing code in
  `interactive/`, fix it rather than following the precedent.
- **Read the app before guessing at a requirement.** When a request mentions
  what the webapp needs, read `../compstats-webapp/src/` directly, the same
  way we read `../compstatslib/` for R behavior.
- **The library must stay app-agnostic.** No app-specific state, storage, or
  UI belongs here. If the webapp needs something the library cannot express,
  the fix is a general option or a returned value the app composes — never a
  special case named after the app.
- **Nothing downstream breaks until you publish, which cuts both ways.** The
  consumers install from npm, so a rename or signature change here is invisible
  to them until a release — and then arrives all at once. Check both consumers
  for callers before renaming an exported symbol, note the change in
  `CHANGELOG.md`, and prefer validating a risky release against a real tarball
  (`npm pack`, then `bun add ./the-tarball.tgz` in the consumer) over
  publishing and finding out. npm versions are immutable.

- **Verify a claim about a consumer before acting on it.** This file has
  carried a wrong one. Read the consumer's `package.json` and
  `node_modules/@compstats/core/package.json` rather than trusting a
  description of the setup, including this one.

## Status

The port is complete. All 9 function families from the R package are
implemented across the three layers, with both bundled datasets exported from
R and a demo page per family. The full test suite asserts core math against
R-computed conformance fixtures. Published to npm as `@compstats/core`, at
**0.6.0**. The `/linalg` entry adds the general linear algebra base R provides
for free. 0.5.0 added the base-R primitives a consuming library needs of its
own — two-matrix `cov`/`cor`, `scale`, `chol`/`chol2inv`, `predictLm`,
`pchisq`, `qchisq`, `pnorm`, `qnorm`, `optim(method = "BFGS")`, elementwise
matrix arithmetic and `outer` — and an `fma` option that trades the pinned
last bits for 10 to 25 times the speed where a caller wants throughput.
`NOTICE` records the provenance of every algorithm the package reimplements.

**0.6.0 acted on `seminr-ts`'s adoption report** (plan 005). Two parts of it
change what a caller sees, and a consumer upgrading from 0.5.0 should read
both:

- Every relative specifier the package publishes now carries a `.js`
  extension. Without it, a `node16`/`nodenext` consumer got **TS2834** with
  `skipLibCheck: false` and, under the far commoner `skipLibCheck: true`,
  silently got `any` for every export — which then propagated into that
  consumer's own published declarations. Two checks keep it fixed:
  `test/specifiers.test.ts` at the source, and `test/consumer/check.ts`, a
  real `nodenext` consumer type-checked against the built `dist/` in
  `prepublishOnly` under **both** `skipLibCheck` settings, because either
  alone misses half the defect.
- `optim` is now R's own `vmmin` (`src/main/optim.c`) rather than a routine
  that reached R's optimum by its own path. **This moves every `optim`
  result**, `counts` is now a value to compare with R's, and `OptimControl`
  loses `gradTol` and `stallGradTol` and gains R's `abstol`.

It also adds `withDim` (R's `dim<-`, adopting a `Float64Array` without
copying) and `matrixIndex` on the linalg entry, and a DOM-free `./stats`
entry carrying `core/` and `data/` at 120 KB against the root's 176 KB.

## Architecture

Three layers. The split exists so the statistics are testable without a DOM,
and so browser demos can consume computed results directly.

```text
src/
  core/         Pure functions: no DOM, no side effects, no rendering.
                Take data + options, return plain objects.
  core/linalg/  The general linear algebra behind `@compstats/core/linalg`:
                a column-major Matrix type and R's matrix, qr, solve, lm,
                eigen and prcomp as free functions. Own entry point, never
                re-exported from the main one.
  plot/         Rendering: takes a target element + data + options, draws.
                Calls into core/ for any math.
  interactive/  Stateful components: own user input and mutable state,
                delegate all drawing to the matching plot/ function.
  data/         Ported bundled datasets.
```

### The plot/interactive coupling is deliberate

In the R package these are *not* independent — `interactive_regression()` holds
the clicked points and calls `plot_regression()` on every update, forwarding
its `...` arguments untouched. Preserve that relationship:

- Each `interactive*` function wraps exactly one `plot*` function.
- The interactive layer owns **state and input handling only**. It must not
  contain drawing code, and must not duplicate the plot function's math.
- Options accepted by the plot function are forwarded through by the
  interactive function (the TS equivalent of R's `...` pass-through) — type
  this as an explicit options interface, not `any`.
- A change to a plot function's visual output must be visible in its
  interactive counterpart with no edit to the latter. If it isn't, the layers
  have drifted.

## API Mapping

Keep the R names recognizable; convert `snake_case` to `camelCase` per TS
convention. Replace R's positional-plus-`...` signatures with a data argument
and a single options object.

| R | TypeScript |
| --- | --- |
| `plot_regression(points, regression, stats)` | `plotRegression(target, points, opts?)` |
| `interactive_regression(points, ...)` | `interactiveRegression(target, opts?)` |
| `plot_logit(points, formula, ...)` | `plotLogit(target, points, opts?)` |
| `interactive_logit(...)` | `interactiveLogit(target, opts?)` |
| `plot_t_test(diff, sd, n, alpha, error_matrix)` | `plotTTest(target, opts?)` |
| `interactive_t_test()` | `interactiveTTest(target, opts?)` |
| `plot_sampling(population, sample_size, theta, reps, vars, replot_population)` | `plotSampling(target, population, opts?)` |
| `interactive_sampling(population, sample_size, theta)` | `interactiveSampling(target, population, opts?)` |
| `plot_sample_ci(num_samples, sample_size, pop_size, distr_func, ...)` | `plotSampleCi(target, opts?)` |
| `plot_pca(points, meancenter, xlim, ylim)` | `plotPca(target, points, opts?)` |
| `interactive_pca(meancenter)` | `interactivePca(target, opts?)` |
| `plot_matrix_inverse(x1, y1, x2, y2)` | `plotMatrixInverse(target, matrix, opts?)` |
| `interactive_matrix_inverse(x1_init, ...)` | `interactiveMatrixInverse(target, opts?)` |
| `plot_moderation_3d(formula, data, iv, mod, z_rot, x_rot, zlim, ...)` | `plotModeration3d(target, data, opts?)` |
| `interactive_moderation_3d(...)` | `interactiveModeration3d(target, data, opts?)` |
| `plot_scatter3d(data, x, y, z, color, ...)` | `plotScatter3d(target, data, opts?)` |
| `interactive_scatter3d(...)` | `interactiveScatter3d(target, data, opts?)` |
| `machine_precision()` | `machinePrecision()` → `Number.EPSILON` |

### R idioms with no TS equivalent

- **Formulas.** R's `y ~ x` and `y ~ x * z` have no TS counterpart. Canonical
  form is explicit column names in the options object (e.g.
  `{outcome: 'y', iv: 'x', mod: 'z'}`). A formula-string parser is acceptable
  as sugar on top, never as the only interface.
- **Data frames.** R data frames become either an array of row records or a
  column-keyed object of arrays. Pick one per module and be consistent; row
  records read better for click-collected point sets, columns for bundled
  datasets.
- **Return-and-plot.** Several R functions both draw and return values
  (`plot_regression` returns points; `plot_sampling` returns a `vars` cache
  used to accumulate across draws). In TS, prefer returning the computed
  result from the `core/` function and letting the caller hold accumulated
  state explicitly — do not hide accumulation in a mutable module-level
  variable.
- **Gadget return values.** R's `runGadget()` blocks and returns the collected
  points on "Done". In a browser nothing blocks: expose collected state via a
  callback or a returned handle with an accessor, and document it.

## Statistics to Implement

JavaScript has no statistics standard library, so the `core/` layer carries
real numerical work. These are the R primitives the port depends on:

| R primitive | Needed by |
| --- | --- |
| `lm()` | regression, moderation surface |
| `glm(family = binomial)` | logit — needs IRLS |
| `prcomp()` | PCA — needs SVD or eigendecomposition of the covariance matrix |
| `solve()` | matrix inverse |
| `dt()`, `pt()`, `qt()` | t-test curves, power, critical values (`qt` needs an inverse incomplete beta) |
| `density()` | sampling distribution panels — Gaussian KDE |
| `hist()` | sampling statistic panel — needs a binning rule (R defaults to Sturges) |
| `sample()`, `rnorm()`, `runif()` | sampling, sample CI |
| `sd()`, `cor()`, `mean()` | throughout |
| `matrix()`, `%*%`, `crossprod()`, `cbind()`, `diag()` | the linalg entry — column-major, R's dimnames rules |
| `qr()` and its readers | the linalg entry — LINPACK `dqrdc2`, promoted out of `leastSquares` |
| `solve()`, `det()`, `rcond()` | the linalg entry — LAPACK `dgetrf`/`dgetrs` for n×n |
| `model.matrix()`, `lm()`, `summary.lm()` | the linalg entry — a term list, not a formula |
| `cov()`, `cor()`, `eigen(symmetric = TRUE)`, `prcomp()` | the linalg entry — Jacobi rotations for the eigenproblem |
| `cov(x, y)`, `cor(x, y)`, `scale()` | the linalg entry — two-matrix forms; `scale.default`'s centering and divisor |
| `chol()`, `chol2inv()` | the linalg entry — LAPACK's recursive `dpotrf2` and `dpotri` |
| `predict.lm()` | the linalg entry — `predictLm`, the design rebuilt over new data |
| `+`, `-`, `*`, `/` on matrices, `outer()` | the linalg entry — `add`/`sub`/`mul`/`div` overloads, `outer` |
| `pchisq()`, `qchisq()`, `pnorm()`, `qnorm()`, `pgamma()` | the main entry — R's `pnchisq.c`, `qgamma`, AS 241; the regularized gamma exported |
| `optim(method = "BFGS")` | the main entry — R's optimum with this port's path, stated at the function |

This layer is **public API**, not an implementation detail. The R package
never exports these — base R already provides them — but a consuming app has
no statistics standard library either, so `src/index.ts` exports them and they
stay exported. Treat a rename here the same as a rename of a plot function.

Two rules for this layer:

- **Verify against R.** For each ported statistic, compute the expected value
  in the R package and assert against it in a test with a stated tolerance.
  Do not treat a plausible-looking curve as correct. The R scripts that
  generate the pinned values live canonically in the R package at
  `../compstatslib/conformance-fixtures/` — run them from that package's
  root with `Rscript`; they print at `%.17g` so tests can pin exact doubles.
- **Seedable RNG.** Random draws must be reproducible for tests and for
  shareable demos. Use an injectable seeded generator, not bare `Math.random()`.
  Note that a seeded JS generator will *not* reproduce R's Mersenne Twister
  stream — matching R exactly is not a goal, but reproducibility across runs is.

## Bundled Data

The R package ships `moderation_data` (200 rows: `y`, `x`, `z`, `w`) and
`pca_degenerate` (16 rows: `x`, `y`), both used as defaults so that calling a
function with no arguments yields a working classroom demo. Preserve that
no-argument-works property.

**Export these from R rather than regenerating them.** `moderation_data` was
generated with `set.seed(42)` under R's RNG; a JS regeneration would produce
different numbers and silently change every default demo.

## Rendering

Current decision — revisit before writing renderer code if it doesn't hold up:

- **2D: hand-rolled Canvas 2D.** Closest to the base-R graphics look, no heavy
  dependency, and fast enough to redraw on every mouse move or slider tick.
- **3D: Plotly.js**, matching the R package's own choice for `plot_scatter3d`
  and giving the moderation surface an interactive camera. This is a large
  dependency — load it only for the 3D entry points so 2D consumers don't pay
  for it.
- Keep an axis/scale/legend helper module shared by all 2D plots rather than
  recomputing tick logic per plot.
- `target` is a `HTMLCanvasElement` or container element, never a global
  implicit device. R's base graphics rely on a current device; nothing here
  should.

## Commands

**Bun is the toolchain** — runtime, package manager, test runner, and bundler.
Do not introduce Node-specific tooling (npm/yarn scripts, Vitest, Jest, tsup)
without a stated reason.

```bash
bun install
bun test                          # bun:test, preloads test/setup.ts
bun test src/core/precision.test.ts   # single test file
bun test --watch
bun run build                     # bun build -> dist/, then tsc -> dist/*.d.ts
bun run typecheck                 # bunx tsc --noEmit (src, demo, test)
bun run dev                       # demo site at http://localhost:3000
```

Set `PORT` to move the demo server off port 3000.

The demo server's route table is fixed at startup, but Bun rebundles the
page script on every request. A fragment added after the server started
therefore 404s while the page looks current. After adding a demo fragment,
restart the dev server and curl the new route before manual testing.

There are two TypeScript configs. `tsconfig.json` type-checks everything and
emits nothing. `tsconfig.build.json` extends it, drops `*.test.ts`, and emits
declarations only. `bun run build` uses both.

Bun specifics that matter here:

- Import test helpers from `bun:test` (`describe`, `test`, `expect`), not from
  Vitest or Jest. The APIs are close enough that copied examples will look
  correct while importing from the wrong package.
- Bun bundles but does not fully emit declarations; generate types with
  `tsc --emitDeclarationOnly` alongside `bun build` until Bun's `--dts` support
  is dependable.
- For tests that touch the DOM, preload `happy-dom` via `bunfig.toml` rather
  than reaching for jsdom. Tests of `core/` need neither.
- Bun runs TypeScript directly, so the demo site and scratch scripts need no
  separate build step during development. `demo/server.ts` imports
  `index.html`; Bun bundles the page and its TypeScript on request.
- Do not put `"sideEffects": false` in `package.json`. Bun 1.3.14 then drops
  the body of each re-exported module from the bundle but keeps the export
  name. The result is a `dist/index.js` that fails at import time. Verify a
  build by importing `dist/index.js` and calling into it, not by reading the
  bundler summary.

## Conventions

- **Strict TypeScript.** `strict: true`; no `any` in public signatures.
- **`core/` stays pure** — no DOM access, no I/O, no randomness that isn't
  passed in. This is what keeps the statistics testable and reusable.
- **Map/`sum()`-style iteration in `core/`** — prefer `map` with the shared
  `sum`/`zipWith` helpers in `src/core/arith.ts` over index-based `for` loops.
  Index loops force `as number` casts under strict index checking and read
  further from the math (`sum(devX.map((d) => d * d))` is visibly Σ(x−x̄)²).
  Use an index loop only with a stated reason.
- **Test the math, snapshot the rest.** Numerical results get exact assertions
  against R-verified values. Rendering gets light structural checks; do not
  chase pixel-perfect parity with base R.
- **Prefer Bun and Web APIs over dependencies.** `Bun.file`, `fetch`, and the
  standard library cover most needs. Every added dependency has to survive
  bundling for the browser, which is the whole point of this port.
- **en-US spelling everywhere** — identifiers, comments, docs and any string a
  user reads. The R package declares `Language: en-US`; the port follows, so
  `color` not `colour`, `center` not `centre`, `behavior` not `behaviour`.
  Names that quote R or a Web API keep their own spelling (`col = "gray"`,
  plotly's `color`), which en-US makes easy.
- **Markdown linting** — after editing or creating any `.md` file, run
  `/ray-md-lint` to ensure it is lint-free.
- **TDD** — use the `ray-tdd` skill for new functionality; the porting workflow
  suits it well, since R provides the expected values up front.

## Plans

Planning and working docs live in `.claude/plans/` (gitignored; synced across
machines via Sideways when configured). Plans never merge into the repo.

**One folder per work stream**, named `NNN-PURPOSE-slug`:

- `NNN` — a zero-padded sequence number starting at `001`. It strictly
  increments and is never reused. Before creating a new plan, list
  `.claude/plans/` and take the next unused number.
- `PURPOSE` — an uppercase tag for the kind of document that started the
  stream: `PLAN`, `BUGFIX`, `REFACTOR`, `HOTFIX`. It does not change when a
  second kind of document joins the folder.
- `slug` — a short kebab-case name, normally the branch name with `/` replaced
  by `-` and an owner prefix such as `ray/` dropped.

Inside the folder, the main document takes the name of its kind (`PLAN.md`,
`BUGFIX.md`). When a folder holds two or more of these, prefix each with a
letter giving the reading order (`a-PLAN.md`, `b-BUGFIX.md`). Supporting files
keep a kind tag and take no letter (`SKETCHES.html`, `regression-fixtures.md`).
A reference inside one folder uses the bare filename; a reference to another
folder uses the full path from the repository root.

```text
001-PLAN-port/              the port (closed); also holds the fixture docs
002-PLAN-initial-release/   the first npm publish (closed)
003-PLAN-linalg/            the linear algebra entry point (closed)
004-PLAN-seminr-utilities/  the base-R primitives and the fma option (closed)
005-PLAN-seminr-feedback/   acting on seminr-ts's adoption report (0.6.0)
```

Source comments cite fixture documents by full path, e.g.
`.claude/plans/001-PLAN-port/regression-fixtures.md`. The canonical
generators are the R scripts in `../compstatslib/conformance-fixtures/`; the
documents are the captured output.

## Git Workflow

Mirrors the R package:

- **main**: release branch
- **develop**: active development branch
- Feature branches branch from and merge back to `develop`
