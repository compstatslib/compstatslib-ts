/**
 * The 3D scatterplot: three numeric columns as a cloud of points, with an
 * optional fourth column driving the colour.
 *
 * This is `plot_scatter3d()` of `../compstatslib/R/scatter3d_plot.R`, drawn
 * through Plotly as the R original is. The trace and the layout follow the
 * object R actually builds, dumped in `.claude/plans/moderation-fixtures.md`
 * section 5.
 *
 * Four things are worth knowing before reading the code.
 *
 * **The work is the specification.** `scatter3dSpec` builds the traces and the
 * layout and touches nothing outside itself. `plotScatter3d` resolves the
 * engine and draws that specification. The split keeps every rule of the port
 * testable without a browser, and it gives the interactive layer a cheap way
 * to ask what a set of options would draw.
 *
 * **Nothing is drawn until everything is checked.** R validates the style,
 * then the axis arguments, then the columns, and only then calls Plotly. That
 * order was confirmed by tracing `plot_ly()`: every error fires with the
 * engine untouched. This module keeps the order and the wording, and the tests
 * count the calls to prove it.
 *
 * **The default axes are the first three numeric columns, in frame order.**
 * With the bundled `moderation_data` that is `y, x, z`, so the plot's own x
 * axis is titled "y". The collision is confusing, and it is R's, so the port
 * keeps it. A note names the chosen and the skipped columns, as R's
 * `message()` does; a library cannot write to a console, so the note is
 * returned and the caller decides whether to show it.
 *
 * **Colour is the one place the port must invent.** R hands the colour column
 * to plotly-R, which decides by itself what a numeric or a categorical column
 * means. Plotly.js decides nothing: the caller must build the traces. So a
 * numeric column becomes one trace carrying a value per point with a colour
 * bar beside it, and a categorical column becomes one trace per level, named,
 * listed in the legend, and coloured from Plotly's own sequence. The rule
 * follows what plotly-R does; the exact colours are Plotly's choice, in both
 * languages.
 */

import { frameRows, isNumericColumn, numericColumns } from "../core/frame";
import type { Column, DataFrame } from "../core/frame";
import { loadPlotly } from "./plotly";
import type {
  PlotlyCamera,
  PlotlyHTMLElement,
  PlotlyLayout,
  PlotlyLike,
  Scatter3dMarker,
  Scatter3dTrace,
} from "./plotly";

/** R's `aspect = c(1, 1, 1)`. */
const DEFAULT_ASPECT: readonly number[] = [1, 1, 1];
/** R's `opacity = 0.8`. */
const DEFAULT_OPACITY = 0.8;
/** R's `size = 5`. */
const DEFAULT_SIZE = 5;
/**
 * The name Plotly keeps the view under. R sets the same literal string, in
 * both the layout and the scene.
 */
const UIREVISION = "scatter3d";
/**
 * The scale a numeric colour column is read through. plotly-R colours a
 * numeric column with Viridis by default, so the port names it here.
 */
const NUMERIC_COLORSCALE = "Viridis";
/** Plotly redraws the plot when the element that holds it changes size. */
const CONFIG = { responsive: true } as const;

/** Titles to write on the axes instead of the column names. */
export interface Scatter3dTitles {
  readonly x?: string;
  readonly y?: string;
  readonly z?: string;
}

/** What to draw, and how. Every option is R's, with R's default. */
export interface Scatter3dSpecOptions {
  /** The column on the first horizontal axis. */
  readonly x?: string;
  /** The column on the second horizontal axis. */
  readonly y?: string;
  /** The column on the vertical axis. */
  readonly z?: string;
  /**
   * Any column to map to colour. A numeric column gives a continuous scale
   * with a colour bar; a text or true-or-false column gives one trace per
   * level, with a legend.
   */
  readonly color?: string;
  /**
   * The x, y and z proportions of the box the points sit in: three positive
   * numbers, `[1, 1, 1]` by default.
   */
  readonly aspect?: readonly number[];
  /** How solid each marker is, in (0, 1]. */
  readonly opacity?: number;
  /** How large each marker is, in pixels. */
  readonly size?: number;
  /**
   * Where the camera starts. Absent by default, which leaves Plotly's own
   * view. Pass a camera to reopen a plot at an angle captured earlier.
   */
  readonly camera?: PlotlyCamera;
  /** Axis titles. Each axis falls back to the name of its column. */
  readonly titles?: Scatter3dTitles;
}

/** The options of `plotScatter3d`: the specification, and the engine. */
export interface PlotScatter3dOptions extends Scatter3dSpecOptions {
  /**
   * The Plotly engine. `loadPlotly()` by default, which fetches the library on
   * first use. Pass your own to draw through a copy you already hold, or to
   * record what would be drawn.
   */
  readonly plotly?: PlotlyLike;
}

/** What a set of options draws. */
export interface Scatter3dSpec {
  /** One trace, or one for each level of a categorical colour column. */
  readonly traces: readonly Scatter3dTrace[];
  readonly layout: PlotlyLayout;
  /**
   * What R says in its `message()`: which columns were chosen, and which were
   * skipped. Null when the caller named every axis, or when no numeric column
   * was left over.
   */
  readonly note: string | null;
}

/** A drawn scatterplot: its specification, its element, and its engine. */
export interface Scatter3dHandle extends Scatter3dSpec {
  /**
   * The element Plotly drew into. Plotly returns it with an event emitter
   * attached, which is how the interactive layer hears about rotation.
   */
  readonly element: PlotlyHTMLElement;
  /** The engine that drew, ready for the next redraw and for teardown. */
  readonly plotly: PlotlyLike;
}

/**
 * Build the traces and the layout of a 3D scatterplot.
 *
 * @param data The frame to read.
 * @param options Which columns to draw, and how.
 * @returns The traces, the layout, and the note about the column choice.
 * @throws RangeError If the style is out of range, if the frame is ragged, if
 *   fewer than three numeric columns are available, or if a named column is
 *   absent or, on an axis, not numeric.
 */
export function scatter3dSpec(
  data: DataFrame,
  options: Scatter3dSpecOptions = {},
): Scatter3dSpec {
  const {
    aspect = DEFAULT_ASPECT,
    opacity = DEFAULT_OPACITY,
    size = DEFAULT_SIZE,
    camera,
    titles,
    color,
  } = options;

  // R's order: the style first, and nothing else read until it passes.
  validateStyle(aspect, opacity, size);
  // R cannot hold a ragged data frame. A JavaScript object can, and the rest
  // of this function would read past the end of the shorter column.
  frameRows(data);

  const { axes, note } = chooseAxes(data, options);
  const points = {
    x: requireAxisColumn(data, axes.x, "x"),
    y: requireAxisColumn(data, axes.y, "y"),
    z: requireAxisColumn(data, axes.z, "z"),
  };

  const colorColumn = color === undefined ? undefined : data[color];
  if (color !== undefined && colorColumn === undefined) {
    throw new RangeError(
      `Column "${color}" (passed as \`color\`) is not in the data.`,
    );
  }

  const traces = buildTraces(points, { opacity, size }, colorColumn);
  const shown = { x: axes.x, y: axes.y, z: axes.z, ...titles };
  const layout: PlotlyLayout = {
    uirevision: UIREVISION,
    scene: {
      aspectmode: "manual",
      aspectratio: {
        x: aspect[0] as number,
        y: aspect[1] as number,
        z: aspect[2] as number,
      },
      xaxis: { title: shown.x },
      yaxis: { title: shown.y },
      zaxis: { title: shown.z },
      uirevision: UIREVISION,
      ...(camera === undefined ? {} : { camera }),
    },
  };

  return { traces, layout, note };
}

/**
 * Draw a 3D scatterplot.
 *
 * @param target The element to draw into. Plotly fills it.
 * @param data The frame to read.
 * @param options Which columns to draw, how, and through which engine.
 * @returns The drawn plot: its element, its specification, and its engine.
 * @throws RangeError Everything `scatter3dSpec` throws, as a rejected promise.
 *   No option reaches the engine until every check has passed.
 */
export async function plotScatter3d(
  target: HTMLElement,
  data: DataFrame,
  options: PlotScatter3dOptions = {},
): Promise<Scatter3dHandle> {
  const { plotly, ...specOptions } = options;
  const spec = scatter3dSpec(data, specOptions);
  const engine = plotly ?? (await loadPlotly());
  const element = await engine.react(target, spec.traces, spec.layout, CONFIG);

  return { ...spec, element, plotly: engine };
}

/** R's `scatter3d_validate_style()`, less the checks the compiler makes. */
function validateStyle(
  aspect: readonly number[],
  opacity: number,
  size: number,
): void {
  // R also refuses a camera that is not a list, and an axis name that is not a
  // string. Both are compiler errors here, so neither check is written.
  if (aspect.length !== 3 || !aspect.every((value) => Number.isFinite(value))) {
    throw new RangeError("`aspect` must be a numeric vector of length 3.");
  }
  if (aspect.some((value) => value <= 0)) {
    throw new RangeError("`aspect` values must all be positive.");
  }
  if (!Number.isFinite(opacity) || opacity <= 0 || opacity > 1) {
    throw new RangeError("`opacity` must be a single numeric in (0, 1].");
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError("`size` must be a single positive numeric.");
  }
}

/**
 * Settle which column goes on which axis.
 *
 * R fills every axis it was not given from the first three numeric columns,
 * and reports the choice whenever a numeric column was left over.
 */
function chooseAxes(
  data: DataFrame,
  options: Scatter3dSpecOptions,
): {
  readonly axes: { readonly x: string; readonly y: string; readonly z: string };
  readonly note: string | null;
} {
  const { x, y, z } = options;
  if (x !== undefined && y !== undefined && z !== undefined) {
    return { axes: { x, y, z }, note: null };
  }

  const numeric = numericColumns(data);
  if (numeric.length < 3) {
    throw new RangeError(
      "plotScatter3d() needs at least 3 numeric columns; " +
        `got ${numeric.length}. Supply x/y/z explicitly or add numeric columns.`,
    );
  }

  const chosen = numeric.slice(0, 3) as [string, string, string];
  const skipped = numeric.slice(3);
  const note =
    skipped.length === 0
      ? null
      : `plotScatter3d(): using numeric columns ${chosen.join(", ")}; ` +
        `skipped ${skipped.join(", ")}. Pass x/y/z to choose explicitly.`;

  return {
    axes: { x: x ?? chosen[0], y: y ?? chosen[1], z: z ?? chosen[2] },
    note,
  };
}

/**
 * Read one axis column.
 *
 * The wording is R's, which names the column, the argument it arrived through,
 * what the column holds, and where a categorical column belongs instead.
 */
function requireAxisColumn(
  data: DataFrame,
  name: string,
  axis: string,
): readonly number[] {
  const column = data[name];
  if (column === undefined) {
    throw new RangeError(
      `Column "${name}" (passed as \`${axis}\`) is not in the data.`,
    );
  }
  if (!isNumericColumn(column)) {
    throw new RangeError(
      `Column "${name}" (passed as \`${axis}\`) is ${describe(column)}; ` +
        "plotScatter3d() requires numeric columns on x/y/z. " +
        "Use `color` for categorical separation.",
    );
  }
  return column;
}

/** Say what a column holds, where R names the column's class. */
function describe(column: Column): string {
  const kinds = new Set<string>(column.map((value) => typeof value));
  if (kinds.size === 0) {
    return "empty";
  }
  if (kinds.size > 1) {
    return "mixed";
  }
  if (kinds.has("string")) {
    return "text";
  }
  return kinds.has("boolean") ? "true or false" : "numbers";
}

/** Build the trace, or the traces, that carry the points. */
function buildTraces(
  points: {
    readonly x: readonly number[];
    readonly y: readonly number[];
    readonly z: readonly number[];
  },
  marker: Scatter3dMarker,
  color: Column | undefined,
): readonly Scatter3dTrace[] {
  if (color === undefined) {
    return [{ type: "scatter3d", mode: "markers", ...points, marker }];
  }

  if (isNumericColumn(color)) {
    return [
      {
        type: "scatter3d",
        mode: "markers",
        ...points,
        marker: {
          ...marker,
          color,
          colorscale: NUMERIC_COLORSCALE,
          showscale: true,
        },
      },
    ];
  }

  // One trace for each level, in the order the levels first appear, which is
  // the order Plotly then lists them in the legend.
  const levels = [...new Set(color.map((value) => String(value)))];
  return levels.map((level) => {
    const rows = color.flatMap((value, row) =>
      String(value) === level ? [row] : [],
    );
    return {
      type: "scatter3d",
      mode: "markers",
      x: rows.map((row) => points.x[row] as number),
      y: rows.map((row) => points.y[row] as number),
      z: rows.map((row) => points.z[row] as number),
      marker,
      name: level,
      showlegend: true,
    };
  });
}
