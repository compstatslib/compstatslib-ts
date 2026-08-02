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

* `plotMatrixInverse()` titles its axes `x` and `y`. R's `plot(NA, ...)`
  deparsed its first argument into the titles, so the axes read "Index" and
  "NA"; the port reproduced that by drawing no titles at all. R fixed it in
  0.8.0 and this follows.

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
