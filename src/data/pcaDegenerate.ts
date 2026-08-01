/**
 * The `pca_degenerate` dataset of the R package.
 *
 * A small two-column dataset that shows a degenerate PCA case: the two
 * components carry almost the same variance (sdev 17.86 and 17.41), so the
 * principal axes are barely distinguishable and the arrows of `plot_pca()`
 * come out nearly the same length in nearly perpendicular directions.
 *
 * The 16 rows below are the exact doubles of the R data file
 * (`../compstatslib/data/pca_degenerate.rda`), printed at 17 significant
 * digits, which round-trips an IEEE-754 double. **Exported from R, never
 * regenerated** — a JavaScript regeneration would silently change the demo.
 * Source of the printed values: `.claude/plans/pca-fixtures.md`, section F1.
 */

import type { Point } from "../core/regression";

/** The 16 rows of the R `pca_degenerate` data frame, in file order. */
export const pcaDegenerate: readonly Point[] = [
  { x: 0.054881767057370599, y: 34.740158547326999 },
  { x: 0.054881767057370599, y: 24.678501253472401 },
  { x: 0.054881767057370599, y: 10.0433633715021 },
  { x: -0.49393590351651601, y: -0.56711159292636404 },
  { x: -0.128057456467252, y: -10.0799512162071 },
  { x: 1.8842740023036699, y: -16.665763263093702 },
  { x: -40.7405650789349, y: -17.763398604241502 },
  { x: -22.812521173521201, y: -17.214580933667602 },
  { x: -7.4456263974523997, y: -16.848702486618301 },
  { x: 7.7383291550917903, y: -16.482824039569099 },
  { x: 22.373467037062099, y: -15.934006368995201 },
  { x: 38.472118707229498, y: -15.7510671454706 },
  { x: 14.872958872552299, y: -16.2998848160445 },
  { x: 0.237820990582013, y: 18.641506877159699 },
  { x: -1.0427535740903999, y: -18.312216274815398 },
  { x: -12.019106985568101, y: -16.848702486618301 },
];
