/**
 * The seam between this library and Plotly.js.
 *
 * The two 3D plots of the R package are drawn by Plotly (`plot_scatter3d()`)
 * and by lattice (`plot_moderation_3d()`). In a browser there is one sensible
 * engine for both, and the R package already chose it for the scatterplot, so
 * both 3D plots of this port draw through Plotly.
 *
 * Plotly is four megabytes of code. Three rules keep that weight off everyone
 * who does not draw in three dimensions.
 *
 * 1. **The 2D entry never names it.** The 3D plots live behind their own entry
 *    point, `src/3d.ts`, which the package exports as `compstatslib/3d`.
 * 2. **The 3D entry does not carry it either.** `loadPlotly()` reaches the
 *    library through a dynamic `import`, which a bundler keeps in a chunk of
 *    its own and a browser fetches only when a plot is drawn.
 * 3. **The engine is an argument.** Both plot functions take a `plotly`
 *    option. The tests pass a recorder (`test/recording-plotly.ts`) and never
 *    load Plotly at all: happy-dom has no WebGL, and the work this port does
 *    is the trace and the layout it builds, not the picture Plotly makes.
 *
 * `PlotlyLike` lists the exact calls the port makes, in the manner of
 * `Context2D` in `./target.ts`. The real library satisfies it, and so does
 * any object with those two methods.
 *
 * The trace and layout types below are equally narrow. They describe the
 * fields this port sets, not the several hundred Plotly accepts.
 */

/** A point in three dimensions, as Plotly writes one. */
export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where the camera stands, where it looks, and which way is up. Plotly's
 * `scene.camera`. Every part is optional: Plotly supplies its own.
 */
export interface PlotlyCamera {
  readonly eye?: Vector3;
  readonly center?: Vector3;
  readonly up?: Vector3;
}

/**
 * A camera whose position is known. `cameraFromRotations` returns one, so a
 * caller can read the eye without asking whether it is there.
 */
export interface EyeCamera extends PlotlyCamera {
  readonly eye: Vector3;
}

/** How the markers of a 3D scatterplot are drawn. */
export interface Scatter3dMarker {
  /** R's `opacity`, in (0, 1]. */
  readonly opacity: number;
  /** R's `size`, in pixels. */
  readonly size: number;
  /** One value per point, when a numeric column drives the color. */
  readonly color?: readonly number[];
  /** The scale those values are read through. */
  readonly colorscale?: string;
  /** Whether the scale is drawn beside the plot as a color bar. */
  readonly showscale?: boolean;
}

/** A cloud of points. */
export interface Scatter3dTrace {
  readonly type: "scatter3d";
  readonly mode: "markers";
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly z: readonly number[];
  readonly marker: Scatter3dMarker;
  /** The level this trace holds, when a categorical column splits the data. */
  readonly name?: string;
  /** Whether the level is listed in the legend. */
  readonly showlegend?: boolean;
}

/**
 * A height field.
 *
 * `z[j][i]` is the height above `x[i]` and `y[j]` — the row index runs along
 * `y`, which is why the moderation plot writes the moderator into the rows.
 */
export interface SurfaceTrace {
  readonly type: "surface";
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly z: readonly (readonly number[])[];
  /** Whether the height scale is drawn beside the plot. */
  readonly showscale: boolean;
}

/** Anything this port draws. */
export type PlotlyTrace = Scatter3dTrace | SurfaceTrace;

/** One axis of a 3D scene. */
export interface PlotlyAxis {
  readonly title: string;
  /**
   * The values the axis spans, as `[low, high]`. Plotly fits the data when
   * the range is absent.
   */
  readonly range?: readonly [number, number];
}

/** The 3D scene: three axes, the shape of the box, and the camera. */
export interface PlotlyScene {
  /** `"manual"` reads the ratio below. The others are Plotly's own rules. */
  readonly aspectmode?: "auto" | "cube" | "data" | "manual";
  readonly aspectratio?: Vector3;
  readonly xaxis: PlotlyAxis;
  readonly yaxis: PlotlyAxis;
  readonly zaxis: PlotlyAxis;
  /**
   * A name for the view. Plotly keeps the rotation and the zoom across a
   * redraw while this string does not change, which is how a slider can
   * rebuild the plot without throwing away the angle the user chose.
   */
  readonly uirevision?: string;
  readonly camera?: PlotlyCamera;
}

/** The layout of a 3D plot. */
export interface PlotlyLayout {
  readonly uirevision: string;
  readonly scene: PlotlyScene;
}

/** The behavior of the plot, as opposed to its content. */
export interface PlotlyConfig {
  /** Whether the plot follows the size of the element that holds it. */
  readonly responsive?: boolean;
}

/**
 * What Plotly reports after the user moves the plot.
 *
 * The camera arrives under the key `scene.camera`, which is a path, not a
 * nested object. The other keys depend on what moved.
 */
export interface PlotlyRelayoutEvent {
  readonly "scene.camera"?: PlotlyCamera;
  readonly [key: string]: unknown;
}

/**
 * A change pushed at a plot that is already drawn.
 *
 * Plotly's `relayout` takes the layout attribute by its path, so the camera
 * arrives under the same `scene.camera` key it is reported under.
 */
export interface PlotlyRelayoutUpdate {
  readonly "scene.camera"?: PlotlyCamera;
}

/**
 * The element Plotly hands back after it has drawn.
 *
 * Plotly adds an event emitter to that element, which is the only way to learn
 * that the user rotated the plot.
 */
export interface PlotlyHTMLElement extends HTMLElement {
  on(
    event: "plotly_relayout",
    handler: (event: PlotlyRelayoutEvent) => void,
  ): void;
  removeAllListeners(event: string): void;
}

/**
 * The part of Plotly this library calls.
 *
 * `react` both draws and updates: on an empty element it builds the plot, and
 * on one that already holds a plot it changes only what differs.
 *
 * `relayout` exists for one case that `react` cannot serve. The layouts of
 * this port carry a constant `uirevision`, which is what keeps a user's own
 * rotation across a redraw; Plotly honours that literally, so once the user
 * has dragged the plot, a `react` carrying a different `scene.camera` is
 * ignored. The rotation sliders of the moderation surface would then move
 * nothing. `relayout` is an instruction rather than a preference, so it moves
 * the camera whatever the user did before, and it is called only when a
 * slider asks for a view the plot is not already at.
 */
export interface PlotlyLike {
  react(
    element: HTMLElement,
    data: readonly PlotlyTrace[],
    layout: PlotlyLayout,
    config?: PlotlyConfig,
  ): Promise<PlotlyHTMLElement>;
  /** Change one part of the layout of a plot that is already drawn. */
  relayout(
    element: HTMLElement,
    update: PlotlyRelayoutUpdate,
  ): Promise<PlotlyHTMLElement>;
  /** Remove the plot, and everything it attached to the element. */
  purge(element: HTMLElement): void;
}

/**
 * Whether two cameras stand at the same view.
 *
 * The interactive components write a camera the user dragged to back into the
 * live layout, and the `relayout` that does so fires `plotly_relayout` again
 * with the same camera as a fresh object. Comparing by value is what lets the
 * capture handlers recognize that echo and stop, so this must never be
 * replaced with a reference comparison.
 *
 * @param a One camera, or nothing.
 * @param b The other, or nothing.
 * @returns True when both are absent, or both present with equal parts.
 */
export function sameCamera(
  a: PlotlyCamera | undefined,
  b: PlotlyCamera | undefined,
): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return (
    sameVector(a.eye, b.eye) &&
    sameVector(a.center, b.center) &&
    sameVector(a.up, b.up)
  );
}

/** Whether two optional vectors carry the same coordinates. */
function sameVector(a: Vector3 | undefined, b: Vector3 | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** The one load, shared by every caller. */
let loading: Promise<PlotlyLike> | undefined;

/**
 * Load Plotly.js.
 *
 * The library is fetched once. Every later call gets the same promise, so two
 * plots on one page load one copy.
 *
 * @returns The library, narrowed to the calls this port makes.
 */
export function loadPlotly(): Promise<PlotlyLike> {
  loading ??= import("plotly.js-dist-min").then((module) => {
    const loaded = (module as { readonly default?: unknown }).default ?? module;
    return loaded as PlotlyLike;
  });
  return loading;
}
