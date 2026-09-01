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

export { resolveTarget } from "./plot/target.js";
export type { Context2D, PlotTarget, RenderTarget } from "./plot/target.js";
export {
  DEFAULT_MARGINS,
  createScale,
  drawAxes,
  pixelInArea,
  prettyTicks,
} from "./plot/axes.js";
export type {
  AxesOptions,
  Extent,
  Margins,
  PlotArea,
  Scale,
  ScaleOptions,
} from "./plot/axes.js";
export { matrixInverseScale, plotMatrixInverse } from "./plot/matrixInverse.js";
export { logitScale, plotLogit } from "./plot/logit.js";
export type { LegendLocation, PlotLogitOptions } from "./plot/logit.js";
export { plotSampleCi, sampleCiScale } from "./plot/sampleCi.js";
export type { PlotSampleCiOptions } from "./plot/sampleCi.js";
export { plotSampling, samplingScale } from "./plot/sampling.js";
export type {
  PlotSamplingOptions,
  PlotSamplingResult,
  SamplingMarkOptions,
  SamplingMarks,
  SamplingPanel,
  SamplingState,
} from "./plot/sampling.js";
export { pcaScale, plotPca } from "./plot/pca.js";
export type { PlotPcaOptions } from "./plot/pca.js";
export { plotRegression, regressionScale } from "./plot/regression.js";
export type { PlotRegressionOptions } from "./plot/regression.js";
export { formatNumber, formatStat } from "./plot/format.js";
export { plotTTest, tTestScale } from "./plot/tTest.js";
export type { PlotTTestOptions } from "./plot/tTest.js";

export {
  eventPixel,
  resolveControlTarget,
  resolveInteractiveTarget,
} from "./interactive/target.js";
export type {
  ClickSource,
  ControlTarget,
  InteractiveTarget,
  PanelTarget,
  ResolvedPanel,
  SplitTarget,
} from "./interactive/target.js";
export {
  DEFAULT_MATRIX_INVERSE_VALUES,
  interactiveMatrixInverse,
} from "./interactive/matrixInverse.js";
export type {
  InteractiveMatrixInverseHandle,
  InteractiveMatrixInverseOptions,
} from "./interactive/matrixInverse.js";
export { interactiveSampling } from "./interactive/sampling.js";
export type {
  InteractiveSamplingHandle,
  InteractiveSamplingOptions,
  SamplingValues,
} from "./interactive/sampling.js";
export { interactiveTTest } from "./interactive/tTest.js";
export type {
  InteractiveTTestHandle,
  InteractiveTTestOptions,
  TTestValues,
} from "./interactive/tTest.js";
export { interactiveLogit } from "./interactive/logit.js";
export type {
  InteractiveLogitHandle,
  InteractiveLogitOptions,
} from "./interactive/logit.js";
export { interactivePca } from "./interactive/pca.js";
export type {
  InteractivePcaHandle,
  InteractivePcaOptions,
  InteractivePcaResult,
} from "./interactive/pca.js";
export { interactiveRegression } from "./interactive/regression.js";
export type {
  InteractiveRegressionHandle,
  InteractiveRegressionOptions,
} from "./interactive/regression.js";
