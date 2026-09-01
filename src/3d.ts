/**
 * The 3D entry point: `@compstats/core/3d`.
 *
 * The two 3D families of the R package draw through Plotly.js, which is four
 * megabytes of browser code. They therefore live behind this entry rather than
 * the main one, so that a page that draws only 2D plots never loads them.
 *
 * Nothing here loads Plotly either. `loadPlotly()` reaches the library through
 * a dynamic import, which runs the first time a plot is drawn; a caller who
 * passes its own engine through the `plotly` option never triggers it at all.
 *
 * The core statistics and the bundled data of the 3D families are re-exported
 * here, so that one import covers a 3D page.
 */

export { loadPlotly } from "./plot/plotly.js";
export type {
  EyeCamera,
  PlotlyAxis,
  PlotlyCamera,
  PlotlyConfig,
  PlotlyHTMLElement,
  PlotlyLayout,
  PlotlyLike,
  PlotlyRelayoutEvent,
  PlotlyRelayoutUpdate,
  PlotlyScene,
  PlotlyTrace,
  Scatter3dMarker,
  Scatter3dTrace,
  SurfaceTrace,
  Vector3,
} from "./plot/plotly.js";

export {
  DEFAULT_SCATTER3D_STYLE,
  plotScatter3d,
  scatter3dSpec,
  validateScatter3dStyle,
} from "./plot/scatter3d.js";
export type {
  PlotScatter3dOptions,
  Scatter3dHandle,
  Scatter3dSpec,
  Scatter3dSpecOptions,
  Scatter3dStyle,
  Scatter3dTitles,
} from "./plot/scatter3d.js";

export { interactiveScatter3d } from "./interactive/scatter3d.js";
export type {
  InteractiveScatter3dHandle,
  InteractiveScatter3dOptions,
  Scatter3dValues,
} from "./interactive/scatter3d.js";

export { interactiveModeration3d } from "./interactive/moderation3d.js";
export type {
  InteractiveModeration3dHandle,
  InteractiveModeration3dOptions,
  Moderation3dValues,
} from "./interactive/moderation3d.js";

export { resolvePlot3dTarget } from "./interactive/target.js";
export type {
  Plot3dPanel,
  Plot3dTarget,
  ResolvedPlot3dPanel,
} from "./interactive/target.js";

export {
  cameraFromRotations,
  moderation3dSpec,
  plotModeration3d,
} from "./plot/moderation3d.js";
export type {
  Moderation3dHandle,
  Moderation3dSpec,
  Moderation3dViewOptions,
  PlotModeration3dOptions,
} from "./plot/moderation3d.js";

export { moderationSurface } from "./core/moderation.js";
export type {
  ModerationOptions,
  ModerationSurface,
  ModerationTerm,
} from "./core/moderation.js";

export {
  frameRows,
  isNumericColumn,
  numericColumns,
  requireNumericColumn,
  requireThreeNumericColumns,
} from "./core/frame.js";
export type { Column, DataFrame } from "./core/frame.js";

export { moderationData } from "./data/moderationData.js";
export type { ModerationData } from "./data/moderationData.js";
