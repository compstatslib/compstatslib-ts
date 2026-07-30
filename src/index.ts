export { machinePrecision } from "./core/precision";
export { linearRegression } from "./core/regression";
export type { Point, RegressionFit } from "./core/regression";

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

export {
  eventPixel,
  resolveInteractiveTarget,
} from "./interactive/target";
export type {
  ClickSource,
  InteractiveTarget,
  SplitTarget,
} from "./interactive/target";
export { interactiveRegression } from "./interactive/regression";
export type {
  InteractiveRegressionHandle,
  InteractiveRegressionOptions,
} from "./interactive/regression";
