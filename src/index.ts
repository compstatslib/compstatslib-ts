export { machinePrecision } from "./core/precision";
export { linearRegression } from "./core/regression";
export type { Point, RegressionFit } from "./core/regression";
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

export { resolveTarget } from "./plot/target";
export type { Context2D, PlotTarget, RenderTarget } from "./plot/target";
export { DEFAULT_MARGINS, createScale, drawAxes, prettyTicks } from "./plot/axes";
export type {
  AxesOptions,
  Extent,
  Margins,
  PlotArea,
  Scale,
  ScaleOptions,
} from "./plot/axes";
export { plotRegr, regrScale } from "./plot/regr";
export type { PlotRegrOptions } from "./plot/regr";
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
export { interactiveTTest } from "./interactive/tTest";
export type {
  InteractiveTTestHandle,
  InteractiveTTestOptions,
  TTestValues,
} from "./interactive/tTest";
export { interactiveRegression } from "./interactive/regression";
export type {
  InteractiveRegressionHandle,
  InteractiveRegressionOptions,
} from "./interactive/regression";
