/**
 * Shared 2D scales, ticks, and axis drawing.
 *
 * Every 2D plot in this library maps a world window onto a pixel rectangle and
 * draws the same style of axis box. That work lives here so no plot repeats
 * it. R gets the equivalent from `plot()` and `pretty()`.
 *
 * The scale is pure geometry: it holds numbers and returns numbers. Only
 * `drawAxes` touches a context, and it receives that context as an argument.
 */

import type { Context2D } from "./target";

/** A closed range of world values. */
export interface Extent {
  readonly min: number;
  readonly max: number;
}

/** Pixels reserved outside the plot area for ticks, labels, and titles. */
export interface Margins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** The pixel rectangle that holds the data. */
export interface PlotArea {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** What `createScale` needs: a surface size and a world window. */
export interface ScaleOptions {
  readonly width: number;
  readonly height: number;
  readonly x: Extent;
  readonly y: Extent;
  readonly margins?: Margins;
}

/** A two-way map between world values and pixels. */
export interface Scale {
  readonly area: PlotArea;
  readonly world: { readonly x: Extent; readonly y: Extent };
  /** Return the pixel column of a world x value. */
  toPixelX(x: number): number;
  /** Return the pixel row of a world y value. Pixel rows grow downward. */
  toPixelY(y: number): number;
  /** Return the world x value of a pixel column. */
  toWorldX(px: number): number;
  /** Return the world y value of a pixel row. */
  toWorldY(py: number): number;
}

/** What to draw around the plot area. */
export interface AxesOptions {
  /** Title under the x axis. Omit for no title. */
  readonly xLabel?: string;
  /** Title beside the y axis, rotated. Omit for no title. */
  readonly yLabel?: string;
  /** Ticks to aim for on each axis. The tick rule may give a few more or less. */
  readonly tickCount?: number;
}

/** Margins wide enough for two-digit tick labels and an axis title. */
export const DEFAULT_MARGINS: Margins = {
  top: 20,
  right: 20,
  bottom: 44,
  left: 52,
};

const DEFAULT_TICK_COUNT = 5;
const TICK_LENGTH = 5;
const LABEL_GAP = 4;
/** Pixels between a tick label and the axis title beyond it. */
const TITLE_GAP = 26;
const AXIS_COLOR = "#000000";
const AXIS_FONT = "12px sans-serif";

/**
 * Build a scale for one surface and one world window.
 *
 * A world range of zero width maps to the middle of the plot area, which keeps
 * a degenerate data set visible instead of dividing by zero.
 */
export function createScale(options: ScaleOptions): Scale {
  const margins = options.margins ?? DEFAULT_MARGINS;
  const left = margins.left;
  const top = margins.top;
  const right = options.width - margins.right;
  const bottom = options.height - margins.bottom;
  const area: PlotArea = {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
  };

  const world = { x: options.x, y: options.y };
  const spanX = options.x.max - options.x.min;
  const spanY = options.y.max - options.y.min;

  return {
    area,
    world,
    toPixelX(x) {
      if (spanX === 0) {
        return left + area.width / 2;
      }
      return left + ((x - options.x.min) / spanX) * area.width;
    },
    toPixelY(y) {
      if (spanY === 0) {
        return top + area.height / 2;
      }
      return bottom - ((y - options.y.min) / spanY) * area.height;
    },
    toWorldX(px) {
      if (area.width === 0) {
        return options.x.min;
      }
      return options.x.min + ((px - left) / area.width) * spanX;
    },
    toWorldY(py) {
      if (area.height === 0) {
        return options.y.min;
      }
      return options.y.min + ((bottom - py) / area.height) * spanY;
    },
  };
}

/**
 * Choose readable tick values inside an extent.
 *
 * The step is 1, 2, or 5 times a power of ten, as in R's `pretty()`. Unlike
 * `pretty()`, this keeps every tick inside the extent instead of widening the
 * range to round numbers, because the plot window is fixed before the ticks
 * are chosen.
 *
 * @param extent The range to cover. A reversed range gives the same ticks.
 * @param count The number of intervals to aim for.
 * @returns The tick values, ascending. A range of zero width gives one tick.
 */
export function prettyTicks(
  extent: Extent,
  count: number = DEFAULT_TICK_COUNT,
): number[] {
  const min = Math.min(extent.min, extent.max);
  const max = Math.max(extent.min, extent.max);
  if (min === max) {
    return [min];
  }

  const step = niceStep((max - min) / Math.max(1, count));
  const decimals = decimalsFor(step);
  // Nudge the bounds by a fraction of a step, so a tick that lands on the
  // bound survives the rounding error of the division.
  const guard = step * 1e-9;
  const first = Math.ceil((min - guard) / step);
  const last = Math.floor((max + guard) / step);

  return Array.from({ length: last - first + 1 }, (_unused, index) =>
    roundTo((first + index) * step, decimals),
  );
}

/**
 * Draw the axis box, the ticks, the tick labels, and the axis titles.
 *
 * @param ctx The context to draw to.
 * @param scale The scale that fixes the plot area and the world window.
 * @param options Titles and tick count. All are optional.
 */
export function drawAxes(
  ctx: Context2D,
  scale: Scale,
  options: AxesOptions = {},
): void {
  const { area } = scale;
  const xTicks = prettyTicks(scale.world.x, options.tickCount);
  const yTicks = prettyTicks(scale.world.y, options.tickCount);

  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = AXIS_COLOR;
  ctx.fillStyle = AXIS_COLOR;
  ctx.lineWidth = 1;
  ctx.font = AXIS_FONT;

  ctx.beginPath();
  ctx.rect(area.left, area.top, area.width, area.height);
  for (const tick of xTicks) {
    const px = scale.toPixelX(tick);
    ctx.moveTo(px, area.bottom);
    ctx.lineTo(px, area.bottom + TICK_LENGTH);
  }
  for (const tick of yTicks) {
    const py = scale.toPixelY(tick);
    ctx.moveTo(area.left, py);
    ctx.lineTo(area.left - TICK_LENGTH, py);
  }
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const tick of xTicks) {
    ctx.fillText(
      String(tick),
      scale.toPixelX(tick),
      area.bottom + TICK_LENGTH + LABEL_GAP,
    );
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tick of yTicks) {
    ctx.fillText(
      String(tick),
      area.left - TICK_LENGTH - LABEL_GAP,
      scale.toPixelY(tick),
    );
  }

  if (options.xLabel !== undefined) {
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      options.xLabel,
      (area.left + area.right) / 2,
      area.bottom + TICK_LENGTH + LABEL_GAP + TITLE_GAP,
    );
  }

  if (options.yLabel !== undefined) {
    ctx.save();
    ctx.translate(
      area.left - TICK_LENGTH - LABEL_GAP - TITLE_GAP,
      (area.top + area.bottom) / 2,
    );
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(options.yLabel, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

/** Round a step up or down to 1, 2, or 5 times a power of ten. */
function niceStep(rawStep: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  if (normalized < 1.5) {
    return magnitude;
  }
  if (normalized < 3) {
    return 2 * magnitude;
  }
  if (normalized < 7) {
    return 5 * magnitude;
  }
  return 10 * magnitude;
}

/** Return the decimal places a step of this size needs. */
function decimalsFor(step: number): number {
  return Math.min(20, Math.max(0, -Math.floor(Math.log10(step))));
}

/** Round away the error of repeated addition, so 0.6 prints as "0.6". */
function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}
