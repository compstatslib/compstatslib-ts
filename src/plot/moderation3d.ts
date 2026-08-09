/**
 * The moderation surface: a fitted regression drawn as a height field over
 * the IV and the moderator.
 *
 * This is the drawing half of `plot_moderation_3d()` of
 * `../compstatslib/R/moderation_3d_plot.R`. Every number comes from
 * `moderationSurface` in `src/core/moderation.ts`; this module computes no
 * statistics of its own. The grid values are pinned in
 * `.claude/plans/moderation-fixtures.md` section 3.
 *
 * Three decisions are worth stating.
 *
 * **The engine is Plotly, not lattice.** R draws this surface with
 * `lattice::wireframe(drape = TRUE, colorkey = FALSE)`, which colors the mesh
 * by height and hides the key. A Plotly surface is colored by height already,
 * so the port sets `showscale: false` and keeps the rest. The colors
 * themselves are Plotly's, not lattice's: a browser has no lattice palette,
 * and the teaching point of the picture is the twist of the surface, not its
 * hue.
 *
 * **The rotation arguments become a camera, approximately.** Lattice takes
 * `screen = list(z = z_rot, x = x_rot)`, two rotations of the data. Plotly
 * takes a camera position. `cameraFromRotations` maps one onto the other, and
 * says how.
 *
 * **The vertical axis carries the outcome.** With the bundled data the
 * moderator is named `z` and it is drawn on a horizontal axis, while the
 * outcome `y` stands up. R's help makes the same point, twice.
 */

import { moderationSurface } from "../core/moderation";
import type { ModerationOptions, ModerationSurface } from "../core/moderation";
import type { DataFrame } from "../core/frame";
import { loadPlotly } from "./plotly";
import type {
  EyeCamera,
  PlotlyHTMLElement,
  PlotlyLayout,
  PlotlyLike,
  SurfaceTrace,
  Vector3,
} from "./plotly";

/** R's `z_rot = 40`: the turn about the vertical axis, in degrees. */
const DEFAULT_Z_ROT = 40;
/** R's `x_rot = -70`: the tilt, in degrees. */
const DEFAULT_X_ROT = -70;
/**
 * How far the camera stands from the middle of the scene. This is the length
 * of Plotly's own default eye, `(1.25, 1.25, 1.25)`, so a plot that sets a
 * camera opens at the same distance as one that does not.
 */
const EYE_DISTANCE = 1.25 * Math.sqrt(3);
/** The name Plotly keeps the view under, across every redraw. */
const UIREVISION = "moderation3d";
/** Plotly redraws the plot when the element that holds it changes size. */
const CONFIG = { responsive: true } as const;

/** How to look at the surface. */
export interface Moderation3dViewOptions {
  /**
   * The turn about the vertical axis, in degrees. R's `z_rot`, 40 by default.
   * 0 lays the IV across the screen; 270 lays the moderator across it.
   */
  readonly zRot?: number;
  /**
   * The tilt, in degrees. R's `x_rot`, −70 by default. −90 looks along the
   * floor of the plot, and the view rises towards 0.
   */
  readonly xRot?: number;
  /**
   * The values the vertical axis spans, as `[low, high]`. The range of the
   * data together with the range of the surface by default, which is R's own
   * rule and what `moderationSurface` reports as `zlim`.
   */
  readonly zlim?: readonly [number, number];
}

/** The options of `plotModeration3d`: the model, the view, and the engine. */
export interface PlotModeration3dOptions
  extends ModerationOptions,
    Moderation3dViewOptions {
  /**
   * The Plotly engine. `loadPlotly()` by default, which fetches the library on
   * first use.
   */
  readonly plotly?: PlotlyLike;
}

/** What a surface and a set of view options draw. */
export interface Moderation3dSpec {
  /** The one height field. */
  readonly traces: readonly SurfaceTrace[];
  readonly layout: PlotlyLayout;
  /**
   * What R says in its `message()` when predictors are held off the axes.
   * Null when every predictor of the model is drawn.
   */
  readonly note: string | null;
}

/** A drawn surface: its specification, its fit, its element, and its engine. */
export interface Moderation3dHandle extends Moderation3dSpec {
  /** The element Plotly drew into, with its event emitter attached. */
  readonly element: PlotlyHTMLElement;
  /** The engine that drew, ready for the next redraw and for teardown. */
  readonly plotly: PlotlyLike;
  /** The fit and the grid behind the picture. */
  readonly surface: ModerationSurface;
}

/**
 * Place the camera for a pair of lattice rotations.
 *
 * This is a visual approximation, not an equivalence: lattice rotates the data
 * and Plotly moves the camera, and the two pictures agree in direction, not
 * pixel for pixel. The mapping is
 *
 * ```text
 * azimuth   = -90 - zRot degrees
 * elevation =  90 + xRot degrees
 * eye       = distance * (cos elevation * cos azimuth,
 *                         cos elevation * sin azimuth,
 *                         sin elevation)
 * ```
 *
 * Both anchors of R's own help hold under it. At `zRot = 0` the camera stands
 * on the moderator axis, so the IV runs across the screen and the IV slope
 * plane faces the viewer; at `zRot = 270` the camera stands on the IV axis and
 * the moderator plane faces it. The tilt reads the same way as lattice's: at
 * `xRot = -90` the camera is level with the floor of the plot, and R's default
 * −70 lifts it 20 degrees above it.
 *
 * @param zRot The turn about the vertical axis, in degrees.
 * @param xRot The tilt, in degrees.
 * @returns The camera, as Plotly's `scene.camera`.
 * @throws RangeError If either angle is not a finite number, which would
 *   place the camera nowhere.
 */
export function cameraFromRotations(zRot: number, xRot: number): EyeCamera {
  if (!Number.isFinite(zRot) || !Number.isFinite(xRot)) {
    throw new RangeError("`zRot` and `xRot` must be finite numbers.");
  }

  const azimuth = ((-90 - zRot) * Math.PI) / 180;
  const elevation = ((90 + xRot) * Math.PI) / 180;
  const eye: Vector3 = {
    x: EYE_DISTANCE * Math.cos(elevation) * Math.cos(azimuth),
    y: EYE_DISTANCE * Math.cos(elevation) * Math.sin(azimuth),
    z: EYE_DISTANCE * Math.sin(elevation),
  };

  return { eye };
}

/**
 * Build the trace and the layout of a moderation surface.
 *
 * @param surface The fit and the grid, from `moderationSurface`.
 * @param model The columns the surface was fitted over. Their names title the
 *   axes, and the controls decide whether there is a note.
 * @param view How to look at the surface.
 * @returns The trace, the layout, and the note about held predictors.
 * @throws RangeError If a rotation is not finite, if a given vertical range is
 *   not two finite numbers, or if any height of the surface is not finite —
 *   a non-finite height would crash the WebGL engine for the whole page.
 */
export function moderation3dSpec(
  surface: ModerationSurface,
  model: ModerationOptions,
  view: Moderation3dViewOptions = {},
): Moderation3dSpec {
  const { zRot = DEFAULT_Z_ROT, xRot = DEFAULT_X_ROT, zlim } = view;
  const camera = cameraFromRotations(zRot, xRot);

  if (zlim !== undefined) {
    if (zlim.length !== 2 || !zlim.every((value) => Number.isFinite(value))) {
      throw new RangeError("`zlim` must be two finite numbers.");
    }
  }
  const range: readonly [number, number] = zlim ?? [
    surface.zlim[0],
    surface.zlim[1],
  ];

  // Plotly reads a height field row by row along y, so each row of z holds one
  // moderator value and runs across the IV. That is R's own grid order, the IV
  // varying fastest: index j * 15 + i.
  const steps = surface.ivValues.length;
  const heights = surface.modValues.map((_, j) =>
    surface.ivValues.map((__, i) => surface.predictions[j * steps + i] as number),
  );

  // A NaN in the height field does not fail politely: it crashes WebGL inside
  // plotly.js, and every surface drawn on the page afterwards fails too.
  // Refuse here so that no caller can poison the engine.
  if (!surface.predictions.every(Number.isFinite)) {
    throw new RangeError(
      "the surface must have finite heights everywhere; " +
        "a prediction is NaN or infinite",
    );
  }

  const trace: SurfaceTrace = {
    type: "surface",
    x: surface.ivValues,
    y: surface.modValues,
    z: heights,
    // R's `colorkey = FALSE`.
    showscale: false,
  };

  const layout: PlotlyLayout = {
    uirevision: UIREVISION,
    scene: {
      xaxis: { title: { text: model.iv } },
      yaxis: { title: { text: model.mod } },
      zaxis: { title: { text: model.outcome }, range },
      uirevision: UIREVISION,
      camera,
    },
  };

  return { traces: [trace], layout, note: describeHolds(model) };
}

/**
 * Fit the model and draw its surface.
 *
 * @param target The element to draw into. Plotly fills it.
 * @param data The frame holding every column the model names.
 * @param options The model, the view, and the engine.
 * @returns The drawn plot: its element, its specification, its engine, and the
 *   surface behind it.
 * @throws RangeError Everything `moderationSurface` and `moderation3dSpec`
 *   throw, as a rejected promise. Nothing reaches the engine until the model
 *   is fitted and the view is settled.
 */
export async function plotModeration3d(
  target: HTMLElement,
  data: DataFrame,
  options: PlotModeration3dOptions,
): Promise<Moderation3dHandle> {
  const { plotly, zRot, xRot, zlim, ...model } = options;
  const surface = moderationSurface(data, model);
  const spec = moderation3dSpec(surface, model, { zRot, xRot, zlim });
  const engine = plotly ?? (await loadPlotly());
  const element = await engine.react(target, spec.traces, spec.layout, CONFIG);

  return { ...spec, element, plotly: engine, surface };
}

/** R's `describe_holds()`: one sentence, and only when a predictor is held. */
function describeHolds(model: ModerationOptions): string | null {
  if ((model.controls ?? []).length === 0) {
    return null;
  }
  return (
    `Surface shows predicted ${model.outcome} over ${model.iv} and ` +
    `${model.mod}. Other predictors are held at their typical values.`
  );
}
