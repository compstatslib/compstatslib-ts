# Changelog

All notable changes to `@compstats/core`. The R package this ports keeps its
own history in [`NEWS.md`](https://github.com/compstatslib/compstatslib/blob/main/NEWS.md).

## Unreleased

### Added

* An `fma` option on the routines of the linear-algebra entry that multiply:
  `matmul`, `crossprod`, `tcrossprod`, `qr`, `lu`, `solve`, `det`,
  `determinant`, `rcond` and `lm`, and on the main entry's `leastSquares`.
  The default, `true`, is what every earlier release did: each product is
  rounded once through a software fused multiply-add, so the result is R's
  double bit for bit, and every pinned value is unchanged. `{ fma: false }`
  selects plain `a * b + c`, which runs 10 to 25 times faster on the shapes
  measured (a 2000 × 24 product, a 24-column `crossprod`, a six-predictor
  OLS by `crossprod` + `solve`, a 2000 × 20 `qr`, a 24 × 24 `solve`) and
  lands a few units in the last place from the default. `qr` and `lu` record
  the setting on the decomposition they return (`QrDecomposition.fma`,
  `LuDecomposition.fma`), so `qrCoef`, `qrFitted`, `qrResid`, `qrQty`,
  `qrQy`, `qrQ`, `qrR` and the solves follow the factorization that built
  them. `crossprod(x, { fma: false })` and `solve(a, { fma: false })` take
  the options in the second position, as `solve(a, { tolerance })` already
  did. A value that is not a boolean is refused with a `TypeError`. The
  option is meant for a hot loop, such as a bootstrap, where a consumer
  composes these routines many thousands of times. The two settings can be
  mixed in one program without a cost to either. The README's linear algebra
  section holds the measured table. The types `FmaOption`, `LuOptions` and
  `CholOptions` are exported from the linalg entry, beside the existing
  `QrOptions` and `SolveOptions`, which now extend `FmaOption`.
* `cov(x, y)` and `cor(x, y)` for two matrices, and `scale()`, in the
  linear-algebra entry. `cov` and `cor` each gain the overloads
  `(Matrix, Matrix)`, `(Vector, Matrix)` and `(Matrix, Vector)`, with `x`'s
  columns carried as the result's row names and `y`'s as its column names.
  Rows must agree, or the call throws `RangeError("incompatible
  dimensions")`, R's own wording. A constant column gives NaN, where R warns
  and gives NA. `cov(x, y)` is a plain sum, as R's `cov.c` is, so its values
  pin bit for bit against R. `cor(x, y)` sums each column's spread through
  the fused multiply-add, because the loop it comes from is contracted in
  the build the fixtures pin against, and it takes the same `fma` option as
  `matmul`. `scale(x, options?)` follows R's `scale.default`: it centers on
  `colMeans`, a plain sum, and divides by `sqrt(Σv² / (n − 1))` of the
  centered column, so `{ center: false }` divides by the root mean square
  instead of the standard deviation. It returns `{ scaled, center, scale }`,
  R's `scaled:center` and `scaled:scale` attributes carried as plain fields.
  A zero-variance column gives NaN, with no warning, as R gives. `scale`
  takes no `na.rm`: a missing value spreads through its column, where R's
  own `colMeans` and column function drop it.
* `chol()` and `chol2inv()` in the linear-algebra entry. `chol` follows
  LAPACK's recursive `dpotrf2` and `chol2inv` follows `dpotri`, both step
  for step, so the factor and its inverse pin bit for bit against R. Both
  read only the upper triangle of their argument. `chol` carries the
  argument's dimnames onto the factor. `chol2inv` returns none, as R does.
  A matrix that is not positive definite throws `RangeError` with R's own
  words, "the leading minor of order k is not positive", the same message
  R gives for a NaN entry. `chol2inv` refuses a non-square matrix outright,
  where R instead reads the leading square block of a taller one, a stated
  narrowing. Both take the `fma` option `matmul` and `qr` already take.
* `predictLm(fit, newdata)` and a new `LmFit.model` field, in the
  linear-algebra entry. `LmFit` now carries the `terms` and `intercept` it
  was fit from, so `predictLm` can rebuild the design over `newdata` with
  `modelMatrix` and multiply it by the fit's coefficients, pinning bit for
  bit against R's `predict.lm`. A row of `newdata` with a missing value
  comes back as NaN, R's own answer for that row. An aliased coefficient's
  column is dropped from the product rather than multiplied by zero,
  because the two round differently, as R's own `beta[piv]` drops it. A
  column a term names but `newdata` lacks throws `RangeError`, R's own
  words, "object 'w' not found". Note that R's `predict.lm` on the training
  frame is not `fitted()`: on the moderation data, 189 of 200 rows differ in
  the last few bits, because `predict.lm` rebuilds `X %*% β` rather than
  reading the residuals the factorization already computed. `predictLm`
  matches `predict`, not `fitted`.
* `pchisq(x, df, ncp?)`, `qchisq(p, df)`, `pnorm(z)` and `qnorm(p)`, on the
  main entry, each taking `lowerTail` so a far upper tail does not have to
  be rebuilt as one minus the lower tail. `pchisq`'s central branch is the
  regularized incomplete gamma. Its noncentral branch follows R's
  `nmath/pnchisq.c`, a Poisson-weighted sum of central terms below a
  noncentrality of 80 and the AS 275 series of Ding (1992) at or above it.
  `qchisq` follows R's `nmath/qgamma.c`: the AS 91 starting value of Best
  and Roberts, then R's closing Newton steps in the log scale. `qnorm`
  follows Wichura's Algorithm AS 241 (PPND16), as R's `qnorm.c` runs it.
  `pchisq(x, 0)` is R's point mass at zero: 1 for `x > 0`, 0 for `x <= 0`.
  A negative or infinite degrees of freedom or noncentrality, or a NaN
  argument, gives NaN. R warns "NaNs produced", which a library cannot do.
  Every fixture point is verified at a relative 1e-12, with one stated
  bound: the upper tail of `pchisq(1500, 200, 1000)` holds at an absolute
  1e-12 rather than a relative one, because R itself reaches that value by
  subtracting from 1. The regularized incomplete gamma the chi-square stands
  on is exported too, as `regularizedGammaP`, `regularizedGammaQ`,
  `logRegularizedGammaP` and `logRegularizedGammaQ` — R's `pgamma(x, a)` in
  its four tail and log forms — beside the `incompleteBeta` that `pt` stands
  on. The types `TailOptions`, `NormalOptions`, `OptimOptions`,
  `OptimControl` and `OptimResult` are exported from the main entry.
* `optim(par, fn, options?)`, on the main entry, R's `optim(method =
  "BFGS")`. It is a port of the `bfgs` routine written for `seminr-ts` by
  this package's own author, so no license question stands in the way of
  bringing it in under this package's MIT terms. It takes `gr`, `method`
  (only `"BFGS"` is accepted, and anything else throws `RangeError`), and
  `control`, and returns R's `par`, `value`, `counts`, `convergence` and
  `message`, plus a `gradNorm` field of its own. Four things stand apart
  from R's own `optim`. The line search backtracks by Armijo's rule, in
  place of Nash's. The stopping rule reads the gradient first, and keeps
  R's `reltol` only as a stall test on the objective. A search direction
  that does not go downhill resets the inverse Hessian to the identity.
  Because of the above, `counts` does not match R's count for the same
  problem. `par` and `value` still land on R's optimum, within 1e-6 and
  1e-10 on the fixtures that give `optim` an analytic gradient. A run with
  no `gr` uses R's own central finite differences, `ndeps = 1e-3`.

* `add`, `sub`, `mul`, and `div` gain overloads for two matrices, and for a
  matrix and a scalar, R's elementwise `+`, `-`, `*`, `/`. The two matrices
  must share extents, or the call throws `RangeError("non-conformable
  arrays")`, R's own words. A vector beside a matrix is refused, where R
  recycles it silently. This is a stated narrowing. The result carries the
  first operand's dimnames when it has any, and the second's otherwise.
  `outer(x, y)` joins them, R's outer product of two vectors, with no
  dimnames. `optim`'s BFGS update is now written on this arithmetic as R's
  own line: `H - r*(outer(s,Hy) + outer(Hy,s)) + (r^2*yHy + r)*outer(s,s)`,
  with plain products in place of index loops.

### Changed

* `cov(x)` and `cor(x)` of one matrix center each column once and take dot
  products of the centered columns, instead of centering a fresh pair of
  columns for every cell of the result. The values are the same bits as
  before. Only the arithmetic path to them is shorter. Measured at 24
  columns and n = 2000: 733 µs, down from 1.82 ms.

## 0.4.1

### Bug fixes

* The key separator in `modelMatrix()` is written as an escape rather than as
  a raw NUL byte. The function joins a sorted interaction's factors on a NUL to
  make the key that collapses `a:b` and `b:a` into one term, and the separator
  had been typed as the byte itself. The source file therefore held a literal
  NUL, which made git read it as binary: `git diff`, `git blame` and a
  three-way merge all declined to open it. **Nothing that ships changed.** The
  bundler already emitted the separator as an escape, so `dist/index.js`,
  `dist/linalg.js` and `dist/3d.js` are byte for byte what 0.4.0 published.
  This release exists so that the tag and the source agree; a consumer already
  on 0.4.0 gains nothing by moving.

## 0.4.0

### Added

* A linear-algebra entry point, `@compstats/core/linalg`, built as
  `dist/linalg.js` with no dependency and no Plotly. Base R hands the R package
  `matrix()`, `%*%`, `solve()`, `qr()`, `model.matrix()`, `lm()`, `eigen()` and
  `prcomp()` for free; a JavaScript application has none of them, so the port
  writes them in R's vocabulary over a plain column-major `Matrix`
  (`{ nrow, ncol, data: Float64Array, dimnames }`) — plain data, not a class,
  so a matrix serializes, clones and crosses a worker boundary as it is. The
  main entry does not re-export it: a page that draws only the 2D demos never
  loads it. The names:
  * matrices — `matrix`, `fromRows`, `fromColumns`, `fromFrame`, `at`, `row`,
    `column`, `toRows`, `toColumns`;
  * elementary operations — `t` (also `transpose`, for an app whose `t` is its
    translation function), `matmul`, `crossprod`, `tcrossprod`, `cbind`,
    `rbind`, `diag`, `identity`;
  * vectors — `add`, `sub`, `mul`, `div`, `square`, `dot`, `norm`, `cosine`:
    R's operators by name, with a scalar recycled and any other length
    mismatch refused; and the `Vector` type they are written over, which is
    `readonly number[]` and nothing more — a name for the concept in a
    signature, erased at compile time, so a plain array is a vector and
    nothing needs wrapping;
  * QR — `qr` with `qrCoef`, `qrFitted`, `qrResid`, `qrQty`, `qrQy`, `qrQ`,
    `qrR`, which is the LINPACK `dqrdc2` factorization `lm.fit()` runs on,
    promoted out of `leastSquares` (now a wrapper over it, with every existing
    value unchanged);
  * LU — `lu`, `solve`, `det`, `determinant`, `rcond`, `matrixNorm`;
  * models — `modelMatrix`, `lm`, and the `NamedVector` that carries R's named
    coefficients in R's order (`namedVector`, `lookup`);
  * multivariate — `cov`, `cor`, `variance`, `eigenSymmetric`, `isSymmetric`,
    `prcomp`.

  Every routine is verified against R 4.5.3 in
  `conformance-fixtures/linalg.R` of the R package. The factorizations, the
  solves, the determinant and the fitted values of `lm` pin bit for bit
  against R's reference-BLAS build (which contracts a multiply and an add into
  one rounding, as the port does with `fusedMultiplyAdd`); the summary
  statistics, eigenvalues and standard deviations are verified at a relative
  `1e-12`. Where R warns and recycles, or silently reads only half of a
  matrix, the port refuses, and each such narrowing is stated at the function.

### Changed

* `moderationSurface()` fits through the new `lm()` instead of building R's
  model matrix itself. Its fitted values and residuals are now R's exactly —
  all 200 of each, for all three pinned models, against 16 of 200 at 8.6e-15
  before. R's `lm.fit` reports the residuals its factorization computes and
  takes the fitted values as the outcome minus them; the old path re-summed
  `X · β`, which lands a few bits away. Coefficients, grid, surface and `zlim`
  are unchanged. A caller who compared residuals against `y - fitted` with
  `===` will now see a difference in the last bit, as R does on 93 of the 200
  rows.

### Bug fixes

* `eigenSymmetric()` refuses what R's `eigen()` refuses, in R's order and R's
  words: a non-square matrix, then a 0 x 0 one, then a missing or infinite
  entry. A NaN used to run the Jacobi sweeps and return a result full of NaN,
  and a 0 x 0 matrix used to return an empty decomposition.
* `prcomp()` carries the row names of its input onto the scores, as R does.
  The rotation already carried the variable names.
* `leastSquares()` no longer overflows the call stack on a long design. The
  column norm was `Math.hypot(...column)`, a spread that dies at about a
  million arguments; it is a fold now, and it follows the BLAS `dnrm2` R runs,
  which also moved the Householder vectors of the factorization onto R's
  doubles exactly. No coefficient, fitted value or residual changed.
* `fusedMultiplyAdd()` keeps the sign of a zero product, as the hardware
  instruction does: `fma(-1, 0, -0)` is `-0`. No pinned value changed.

## 0.3.0

### Added

* `plotSampling()` takes a `mark` option and marks the chosen statistic on all
  three panels, in one color. The library computes two of the three numbers:
  the statistic of the pooled sample, and the average of every statistic drawn
  so far. It takes the third from the caller, because the true value in the
  population is a fact about the shape and not about the values in the array. A
  Cauchy population has no mean, and the arithmetic mean of a finite draw from
  it is still a number. `mark.populationValue: null` says the population has no
  such value, and the panel writes `no true <label>` in place of the line. A
  location statistic draws a line, a spread draws a span around a center, and
  the third panel always draws a line, because its axis holds the value of the
  statistic. A mark outside the frozen window draws a caret at that edge, so a
  clipped mark and an absent mark do not look the same. The new `marks` field
  of the result reports the three numbers, and reports null for each one that
  does not exist. A call that passes no `mark` draws what it drew before, and
  gets `marks: null`. `interactiveSampling()` forwards the option, as it
  forwards every other plot option.

### Changed

* `plotly.js-dist-min` moves from a runtime dependency to an **optional peer
  dependency**. Installing `@compstats/core` brought in 5.9 MB of 3D engine
  even for a page that draws only 2D. It now installs 1.3 MB, and a consumer
  who uses the `/3d` entry adds `plotly.js-dist-min` to its own dependencies —
  which the two known consumers already did, because a bundler needs the
  package named where it is imported. No source and no bundle changed:
  `dist/3d.js` still reaches Plotly through the same lazy `import()`, and
  passing your own engine in the `plotly` option still keeps that import
  unreached. If Plotly is absent, that load now fails with
  `Cannot find package 'plotly.js-dist-min'` instead of succeeding.

## 0.2.0

The first npm release. It follows the R package's own 0.8.0 release, which
settled the R public API before that package had users to break. The same
changes land here, for the same reason: nothing is published yet, so these are
renames rather than breaking changes with a deprecation cycle.

The number is 0.2.0, not 0.1.0, because 0.1.0 is a git tag that was never
published. It stays where it is, and the rename below is what moves the minor.

### Breaking changes

* `plotRegr()` is renamed `plotRegression()`, matching R's rename of
  `plot_regr()` to `plot_regression()`. Every other plot function already
  carried the name of its interactive counterpart; this was the last one that
  did not. `PlotRegrOptions` and `regrScale()` are renamed with it, to
  `PlotRegressionOptions` and `regressionScale()`. There is no shim.

### Added

* `rt()`, `rlnorm()` and `rcauchy()` draw from the Student t, lognormal and
  Cauchy distributions, with R's parameter names — `df`, `meanlog`/`sdlog`,
  `location`/`scale`. One departure: `rt()` takes a positive integer `df`
  only, where R's gamma sampler accepts any positive real. Empirical
  quantiles are checked against R's `qt` and `qlnorm` over 200000 draws.
* `mean()`, `median()` and `meanAbsoluteDeviation()`. `median()` is R's own
  rule, the type-7 quantile at 0.5. `meanAbsoluteDeviation()` is *not* R's
  `mad()`, which is the median absolute deviation from the median and scaled
  by 1.4826; the name is written in full because the abbreviation covers both
  statistics. The sampling demonstration offers the last two as choices of
  statistic.
* `kernelDensity()` takes `from` and `to`, R's own arguments, to fix the
  reported window instead of taking it from the data.
* `plotSampling()` takes `densityWindow`. The default, `"data"`, is
  unchanged. `"frozen"` puts the grid of every curve on the drawn window,
  which a population reaching far outside that window needs: at 512 grid
  points over a range a thousand times the window, one step is wider than the
  panel and the curve draws as a straight line.
* `plotRegression()` takes `xlim` and `ylim`, R's own arguments. Both still
  default to R's `c(-5, 50)`, and the mean crosshair clamps into a window
  that does not contain 0.
* The two options above reach `interactiveRegression()` and
  `interactiveSampling()` with no work, because each interactive options type
  extends the plot options type it forwards.

### Bug fixes

* The sampling histogram is bounded by the window it draws in. A statistic
  outside the shared window is clipped from the picture, so it must not set
  the width of the histogram's cells either: one sample mean out at 800 made
  every cell 100 units wide and left a single flat bar in a 124-wide panel.
  The count in the panel label still reports the whole pile.

* `moderationSurface()` drops rows with missing values before fitting, as
  R's `lm()` does with `na.action = na.omit`; it fit straight through NaN,
  so one missing cell made every coefficient and all 225 surface heights
  NaN. Fitted values and residuals keep input order with NaN marking the
  dropped rows, a control is held at its finite mean (R's `hold_value()`
  with `na.rm = TRUE`), and a model with no complete rows throws a
  `RangeError`. One stated departure: R computes zlim with no `na.rm` and
  fails on a missing outcome; the port draws what it fits.
* `moderation3dSpec()` refuses a surface with a non-finite height. A NaN
  height field crashes WebGL inside plotly.js, and the crash poisons every
  later 3D surface on the page; the spec now throws a `RangeError` before
  the engine can see it.
* `plotMatrixInverse()` titles its axes `x` and `y`. R's `plot(NA, ...)`
  deparsed its first argument into the titles, so the axes read "Index" and
  "NA"; the port reproduced that by drawing no titles at all. R fixed it in
  0.8.0 and this follows.
* `linearRegression()`, `logisticRegression()`, and `principalComponents()`
  drop points with a non-finite coordinate before fitting, as R's `na.omit`
  does and as `moderationSurface()` already did. The first fit straight
  through NaN, the second refused it with a `RangeError`, and the third
  answered all-NaN components. Fitted values, linear predictors, and scores
  keep input order with NaN marking the dropped points; an input with no
  complete point returns null, the existing "nothing to fit" answer.
  `logisticRegression()` no longer throws on a non-finite predictor, and its
  0-or-1 outcome rule now applies to the complete points alone. `logitScale()`
  ignores a non-finite predictor too, so one missing value no longer poisons
  the whole window.
* `scatter3dSpec()` and `moderation3dSpec()` emit scene axis titles in
  Plotly's object form, `title: { text }`. Plotly v2 silently drops a
  bare-string title, so no 3D plot ever showed its column names.
  `PlotlyAxis.title` is typed to the object form for the same reason.

### Other

* Spelling is en-US throughout, as the R package now declares. No exported
  name and no string a user reads changed — every correction was prose or an
  internal identifier.
* The package ships a LICENSE, a README and this changelog.
* `prepublishOnly` runs the test suite, the type check and the build, so a
  publish from a fresh clone cannot ship a stale or missing `dist/`.
* GitHub Actions runs the tests, the type check and the build on every push
  and pull request.

## 0.1.0

Tagged in git, never published to npm.

The complete TypeScript port of the R package: all nine function families
across the three layers (`core/` statistics with no DOM, `plot/` renderers,
`interactive/` components), both bundled datasets exported from R, and a demo
page per family. The core statistics are asserted against conformance fixtures
computed in R.
