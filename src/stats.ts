/**
 * The DOM-free entry point: `@compstats/core/stats`.
 *
 * Everything the package computes, and nothing it draws — the distributions,
 * the fits, the summaries, the simulation helpers and the two bundled data
 * sets. It carries no reference to a canvas, a document or a window, and
 * `stats.test.ts` walks the module graph to prove it rather than trusting the
 * architecture rule that makes it so.
 *
 * It exists because the root entry is the only door to `pchisq` otherwise,
 * and the root entry pulls in the drawing layers. A consumer computing on a
 * server, in a worker, or in a page that draws its own charts imports here
 * instead. `src/index.ts` re-exports every name below, so nothing about the
 * root entry changes.
 *
 * The linear algebra stays behind `@compstats/core/linalg`, disjoint from
 * this entry by design: `matrix`, `qr`, `solve` and `lm` are a general
 * library with their own pace, not statistics this package's plots need.
 */

export { machinePrecision } from "./core/precision.js";
export {
  mean,
  meanAbsoluteDeviation,
  median,
  quantile,
  quantiles,
  sd,
} from "./core/arith.js";
export { bwNrd0, kernelDensity } from "./core/kde.js";
export type {
  KernelDensityEstimate,
  KernelDensityOptions,
} from "./core/kde.js";
export { histogram, nclassSturges } from "./core/histogram.js";
export type { Histogram, HistogramOptions } from "./core/histogram.js";
export { rPretty } from "./core/pretty.js";
export type { RPrettyOptions } from "./core/pretty.js";
export {
  drawSamples,
  sampleConfidenceIntervals,
  simulateSampleCi,
} from "./core/sampling.js";
export type {
  DistributionFn,
  DrawSamplesOptions,
  Interval,
  SampleCiOptions,
  SampleCiSimulation,
  SampleDraw,
  SampleInterval,
} from "./core/sampling.js";
export {
  frameRows,
  isNumericColumn,
  numericColumns,
  requireNumericColumn,
} from "./core/frame.js";
export type { Column, DataFrame } from "./core/frame.js";
export { moderationSurface } from "./core/moderation.js";
export type {
  ModerationOptions,
  ModerationSurface,
  ModerationTerm,
} from "./core/moderation.js";
export { linearRegression } from "./core/regression.js";
export type { Point, RegressionFit } from "./core/regression.js";
export { determinant, invertMatrix } from "./core/matrix.js";
export type { Matrix2, MatrixInversion, Singularity } from "./core/matrix.js";
export { principalComponents } from "./core/pca.js";
export type { Loadings, PcaResult } from "./core/pca.js";
export {
  DEFAULT_LOGIT_EPSILON,
  DEFAULT_LOGIT_MAX_ITERATIONS,
  logisticRegression,
  predictLogit,
} from "./core/logit.js";
export type { LogitFit, LogitOptions } from "./core/logit.js";
export { DEFAULT_LEAST_SQUARES_TOLERANCE, leastSquares } from "./core/ols.js";
export type { LeastSquaresFit, LeastSquaresOptions } from "./core/ols.js";
export {
  rcauchy,
  rlnorm,
  rnorm,
  rt,
  runif,
  sampleWithoutReplacement,
  seededRng,
} from "./core/rng.js";
export type {
  Rng,
  RcauchyOptions,
  RlnormOptions,
  RnormOptions,
  RunifOptions,
} from "./core/rng.js";
export { dt, pt, qt } from "./core/tdist.js";
export { pchisq, qchisq } from "./core/chisq.js";
export type { TailOptions } from "./core/chisq.js";
export { pnorm, qnorm } from "./core/norm.js";
export type { NormalOptions } from "./core/norm.js";
export { optim } from "./core/optim.js";
export type { OptimControl, OptimOptions, OptimResult } from "./core/optim.js";
export { DEFAULT_T_TEST_OPTIONS, tTestStats } from "./core/ttest.js";
export type {
  FillRange,
  TTestErrorMatrix,
  TTestOptions,
  TTestStats,
} from "./core/ttest.js";
export {
  incompleteBeta,
  incompleteBetaSplit,
  inverseIncompleteBeta,
  logBeta,
  logGamma,
  logRegularizedGammaP,
  logRegularizedGammaQ,
  normalCdf,
  regularizedGammaP,
  regularizedGammaQ,
} from "./core/special.js";

export { moderationData } from "./data/moderationData.js";
export type { ModerationData } from "./data/moderationData.js";
export { pcaDegenerate } from "./data/pcaDegenerate.js";
