export { machinePrecision } from "./core/precision";
export { quantile, quantiles, sd } from "./core/arith";
export { bwNrd0, kernelDensity } from "./core/kde";
export type {
  KernelDensityEstimate,
  KernelDensityOptions,
} from "./core/kde";
export { histogram, nclassSturges } from "./core/histogram";
export type { Histogram, HistogramOptions } from "./core/histogram";
export { rPretty } from "./core/pretty";
export type { RPrettyOptions } from "./core/pretty";
export {
  drawSamples,
  sampleConfidenceIntervals,
  simulateSampleCi,
} from "./core/sampling";
export type {
  DistributionFn,
  DrawSamplesOptions,
  Interval,
  SampleCiOptions,
  SampleCiSimulation,
  SampleDraw,
  SampleInterval,
} from "./core/sampling";
export {
  frameRows,
  isNumericColumn,
  numericColumns,
  requireNumericColumn,
} from "./core/frame";
export type { Column, DataFrame } from "./core/frame";
export { moderationSurface } from "./core/moderation";
export type {
  ModerationOptions,
  ModerationSurface,
  ModerationTerm,
} from "./core/moderation";
export { linearRegression } from "./core/regression";
export type { Point, RegressionFit } from "./core/regression";
export { determinant, invertMatrix } from "./core/matrix";
export type { Matrix2, MatrixInversion, Singularity } from "./core/matrix";
export { principalComponents } from "./core/pca";
export type { Loadings, PcaResult } from "./core/pca";
export {
  DEFAULT_LOGIT_EPSILON,
  DEFAULT_LOGIT_MAX_ITERATIONS,
  logisticRegression,
  predictLogit,
} from "./core/logit";
export type { LogitFit, LogitOptions } from "./core/logit";
export { DEFAULT_LEAST_SQUARES_TOLERANCE, leastSquares } from "./core/ols";
export type { LeastSquaresFit, LeastSquaresOptions } from "./core/ols";
export {
  rnorm,
  runif,
  sampleWithoutReplacement,
  seededRng,
} from "./core/rng";
export type { Rng, RnormOptions, RunifOptions } from "./core/rng";
export { dt, pt, qt } from "./core/tdist";
export { DEFAULT_T_TEST_OPTIONS, tTestStats } from "./core/ttest";
export type {
  FillRange,
  TTestErrorMatrix,
  TTestOptions,
  TTestStats,
} from "./core/ttest";
export {
  incompleteBeta,
  incompleteBetaSplit,
  inverseIncompleteBeta,
  logBeta,
  logGamma,
  normalCdf,
} from "./core/special";

export { moderationData } from "./data/moderationData";
export type { ModerationData } from "./data/moderationData";
export { pcaDegenerate } from "./data/pcaDegenerate";

export { resolveTarget } from "./plot/target";
export type { Context2D, PlotTarget, RenderTarget } from "./plot/target";
export {
  DEFAULT_MARGINS,
  createScale,
  drawAxes,
  pixelInArea,
  prettyTicks,
} from "./plot/axes";
export type {
  AxesOptions,
  Extent,
  Margins,
  PlotArea,
  Scale,
  ScaleOptions,
} from "./plot/axes";
export { matrixInverseScale, plotMatrixInverse } from "./plot/matrixInverse";
export { logitScale, plotLogit } from "./plot/logit";
export type { LegendLocation, PlotLogitOptions } from "./plot/logit";
export { plotSampleCi, sampleCiScale } from "./plot/sampleCi";
export type { PlotSampleCiOptions } from "./plot/sampleCi";
export { plotSampling, samplingScale } from "./plot/sampling";
export type {
  PlotSamplingOptions,
  PlotSamplingResult,
  SamplingPanel,
  SamplingState,
} from "./plot/sampling";
export { pcaScale, plotPca } from "./plot/pca";
export type { PlotPcaOptions } from "./plot/pca";
export { plotRegression, regressionScale } from "./plot/regression";
export type { PlotRegressionOptions } from "./plot/regression";
export { formatNumber, formatStat } from "./plot/format";
export { plotTTest, tTestScale } from "./plot/tTest";
export type { PlotTTestOptions } from "./plot/tTest";

export {
  eventPixel,
  resolveControlTarget,
  resolveInteractiveTarget,
} from "./interactive/target";
export type {
  ClickSource,
  ControlTarget,
  InteractiveTarget,
  PanelTarget,
  ResolvedPanel,
  SplitTarget,
} from "./interactive/target";
export {
  DEFAULT_MATRIX_INVERSE_VALUES,
  interactiveMatrixInverse,
} from "./interactive/matrixInverse";
export type {
  InteractiveMatrixInverseHandle,
  InteractiveMatrixInverseOptions,
} from "./interactive/matrixInverse";
export { interactiveSampling } from "./interactive/sampling";
export type {
  InteractiveSamplingHandle,
  InteractiveSamplingOptions,
  SamplingValues,
} from "./interactive/sampling";
export { interactiveTTest } from "./interactive/tTest";
export type {
  InteractiveTTestHandle,
  InteractiveTTestOptions,
  TTestValues,
} from "./interactive/tTest";
export { interactiveLogit } from "./interactive/logit";
export type {
  InteractiveLogitHandle,
  InteractiveLogitOptions,
} from "./interactive/logit";
export { interactivePca } from "./interactive/pca";
export type {
  InteractivePcaHandle,
  InteractivePcaOptions,
  InteractivePcaResult,
} from "./interactive/pca";
export { interactiveRegression } from "./interactive/regression";
export type {
  InteractiveRegressionHandle,
  InteractiveRegressionOptions,
} from "./interactive/regression";
