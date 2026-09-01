/**
 * The package's root entry point: `@compstats/core`.
 *
 * Everything `@compstats/core/stats` carries, re-exported unchanged, plus the
 * drawing and interactive layers. A consumer that never draws imports the
 * stats entry instead and leaves the canvas code behind; nothing here is
 * duplicated to make that possible.
 *
 * The linear algebra has its own entry, `@compstats/core/linalg`, and the 3D
 * plots theirs, `@compstats/core/3d`, so that a page pays for Plotly only
 * when it asks for it.
 */

export * from "./stats.js";
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
