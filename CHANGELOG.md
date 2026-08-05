# Changelog

All notable changes to `@compstats/core`. The R package this ports keeps its
own history in [`NEWS.md`](https://github.com/compstatslib/compstatslib/blob/main/NEWS.md).

## Unreleased

The first npm release. It follows the R package's own 0.8.0 release, which
settled the R public API before that package had users to break. The same
changes land here, for the same reason: nothing is published yet, so these are
renames rather than breaking changes with a deprecation cycle.

### Breaking changes

* `plotRegr()` is renamed `plotRegression()`, matching R's rename of
  `plot_regr()` to `plot_regression()`. Every other plot function already
  carried the name of its interactive counterpart; this was the last one that
  did not. `PlotRegrOptions` and `regrScale()` are renamed with it, to
  `PlotRegressionOptions` and `regressionScale()`. There is no shim.

### Bug fixes

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
