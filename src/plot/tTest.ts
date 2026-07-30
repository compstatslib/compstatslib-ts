/**
 * The t-test plot: two distributions, the regions they decide between, and an
 * optional matrix of the four outcomes.
 *
 * This is the drawing half of `plot_t_test()` in
 * `../compstatslib/R/t_statistic_plot.R`, whose work is spread across
 * `t_null_plot()`, `t_alt_lines()`, `plott()`, `plotdist()`, and
 * `plot_error_matrix()`. Every number comes from `tTestStats` in
 * `src/core/ttest.ts` and every curve height from `dt` in
 * `src/core/tdist.ts`; this module computes no statistics of its own.
 */

import { dt } from "../core/tdist";
import { tTestStats } from "../core/ttest";
import type { TTestOptions, TTestStats } from "../core/ttest";
import { createScale, drawAxes } from "./axes";
import type { Extent, Scale } from "./axes";
import { formatNumber, formatStat } from "./format";
import { resolveTarget } from "./target";
import type { Context2D, PlotTarget } from "./target";

/**
 * What to draw. The four test parameters pass straight through to
 * `tTestStats`, which is the pass-through R does with its own arguments.
 */
export interface PlotTTestOptions extends TTestOptions {
  /** Show the matrix of the four outcomes. False by default, as in R. */
  readonly errorMatrix?: boolean;
}

/** R: `xlim = c(-6, 6)` in both `t_null_plot()` and `t_alt_lines()`. */
const WORLD_X: Extent = { min: -6, max: 6 };

const BACKGROUND = "#ffffff";
/** R: `rgb(0.75, 0.1, 0.1)`. */
const NULL_COLOR = "#bf1a1a";
/** R: `rgb(1, 0.5, 0.5)`. */
const NULL_FILL = "#ff8080";
/** R: `rgb(0.1, 0.1, 0.75)`. */
const ALT_COLOR = "#1a1abf";
/** R: `rgb(0.4, 0.4, 1, 0.3)`, used for the fill and the median segment. */
const ALT_FILL = "rgba(102, 102, 255, 0.3)";
/** R: `rgb(0.30, 0.50, 0.75, 0.5)`, the two "Correct!" cells. */
const CORRECT_FILL = "rgba(77, 128, 191, 0.5)";
const TEXT_COLOR = "#000000";

/** R: `lwd = 2`, the default in `plott()`. */
const LINE_WIDTH = 2;
/** R: `lty = "dashed"`, which is 4 on and 4 off. */
const DASHED = [4, 4];
/** R: `lwd = 4` on the ring around the likely row. */
const HIGHLIGHT_WIDTH = 4;

/** R: `xseq = seq(ncp - 6, ncp + 6, length = 1000)`. */
const CURVE_SAMPLES = 1000;
const CURVE_HALF_WIDTH = 6;
/**
 * R samples a fill at `by = 0.001`, which over the widest region would be tens
 * of thousands of points for a shape a few hundred pixels wide. Sampling once
 * per pixel draws the same picture for a fraction of the work, which matters
 * because the interactive layer redraws on every slider tick.
 */
const MAX_FILL_SAMPLES = 2000;

/** The error-matrix geometry, read off the `recttext()` calls in R. */
const MATRIX = {
  left: -5.5,
  middle: -4,
  right: -2.5,
  bottom: 0.125,
  centre: 0.25,
  top: 0.375,
} as const;

/** Room above the matrix for the column captions R puts at `yt + 0.02`. */
const MATRIX_HEADROOM = 0.045;

/** R's `cex` values, turned into pixel sizes against a 13px base. */
const CAPTION_FONT_SIZE = 6;
const TITLE_FONT = "7px sans-serif";
const VALUE_FONT = "10px sans-serif";
/** The room one caption line takes in the stack, when there is room for it. */
const CAPTION_LINE_HEIGHT = 9;
/** However narrow the gap, a caption never shrinks past this. */
const MIN_CAPTION_FONT_SIZE = 4;

/**
 * Build the scale that `plotTTest` draws through.
 *
 * The x window is R's fixed `c(-6, 6)`. The y window follows R's default,
 * which is the range of the plotted density widened by four percent at each
 * end, except that showing the error matrix raises the top enough to hold it.
 * R leaves the window alone there and lets the matrix fall outside the plot
 * region, where base graphics clip it away: at one degree of freedom the null
 * curve only reaches 0.32 and the top row of cells is cut off. Growing the
 * window instead keeps the panel whole.
 *
 * @param width The pixel width of the surface.
 * @param height The pixel height of the surface.
 * @param options The same options `plotTTest` takes.
 * @returns The map between world values and pixels.
 */
export function tTestScale(
  width: number,
  height: number,
  options: PlotTTestOptions = {},
): Scale {
  const { errorMatrix = false, ...statOptions } = options;
  return buildScale(width, height, tTestStats(statOptions), errorMatrix);
}

/** The scale, once the statistics are already in hand. */
function buildScale(
  width: number,
  height: number,
  stats: TTestStats,
  showErrorMatrix: boolean,
): Scale {
  const peak = Math.max(dt(0, stats.df), stats.altMedianDensity);
  const tallest = Number.isFinite(peak) && peak > 0 ? peak : 1;
  const top = showErrorMatrix
    ? Math.max(1.04 * tallest, MATRIX.top + MATRIX_HEADROOM)
    : 1.04 * tallest;

  return createScale({
    width,
    height,
    x: WORLD_X,
    y: { min: -0.04 * tallest, max: top },
  });
}

/**
 * Draw the null and alternative distributions of a t test.
 *
 * @param target A canvas, or a context and a size. See `./target.ts`.
 * @param options The test parameters, and whether to show the error matrix.
 * @returns The statistics behind the picture. R returns these invisibly from
 * `t_alt_lines()`; a browser caller wants them, so they come back here.
 */
export function plotTTest(
  target: PlotTarget,
  options: PlotTTestOptions = {},
): TTestStats {
  const { ctx, width, height } = resolveTarget(target);
  const { errorMatrix: showErrorMatrix = false, ...statOptions } = options;

  const stats = tTestStats(statOptions);
  const scale = buildScale(width, height, stats, showErrorMatrix);

  ctx.setLineDash([]);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  drawAxes(ctx, scale, { frame: false });

  // R draws the null first, then the alternative over it. Within each, the
  // shaded region goes down before the curve, so the outline stays visible.
  drawFill(ctx, scale, stats.nullFill, stats.df, 0, NULL_FILL);
  drawCurve(ctx, scale, stats.df, 0, NULL_COLOR, []);

  drawFill(ctx, scale, stats.altFill, stats.df, stats.t, ALT_FILL);
  drawMedianSegment(ctx, scale, stats);
  drawCurve(ctx, scale, stats.df, stats.t, ALT_COLOR, DASHED);

  if (showErrorMatrix) {
    drawErrorMatrix(ctx, scale, stats);
  }

  return stats;
}

/**
 * Draw one density curve.
 *
 * R samples over `ncp ± 6` whatever the window is, and lets the plot clip what
 * falls outside. This does the same, under a clip to the plot area.
 */
function drawCurve(
  ctx: Context2D,
  scale: Scale,
  df: number,
  ncp: number,
  color: string,
  dash: readonly number[],
): void {
  ctx.save();
  clipToArea(ctx, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = LINE_WIDTH;
  ctx.setLineDash([...dash]);
  ctx.beginPath();

  const from = ncp - CURVE_HALF_WIDTH;
  const step = (2 * CURVE_HALF_WIDTH) / (CURVE_SAMPLES - 1);
  for (let index = 0; index < CURVE_SAMPLES; index += 1) {
    const x = from + index * step;
    const px = scale.toPixelX(x);
    const py = scale.toPixelY(dt(x, df, ncp));
    if (index === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }

  ctx.stroke();
  ctx.restore();
}

/** A span of the x axis to shade. */
interface Span {
  readonly from: number;
  readonly to: number;
}

/**
 * Shade the region under a curve between two quantiles.
 *
 * The range is clamped to the visible window first. `tTestStats` reports the
 * power region as starting at −Infinity once beta underflows, which R feeds
 * straight to `seq()` and dies on; clamping turns that into the honest
 * picture, a region running off the left edge.
 */
function drawFill(
  ctx: Context2D,
  scale: Scale,
  range: Span,
  df: number,
  ncp: number,
  color: string,
): void {
  const from = Math.max(range.from, WORLD_X.min);
  const to = Math.min(range.to, WORLD_X.max);
  if (!(to > from)) {
    return;
  }

  const fromPixel = scale.toPixelX(from);
  const toPixel = scale.toPixelX(to);
  const samples = Math.max(
    2,
    Math.min(MAX_FILL_SAMPLES, Math.ceil(toPixel - fromPixel)),
  );
  const step = (to - from) / (samples - 1);
  const baseline = scale.toPixelY(0);

  ctx.save();
  clipToArea(ctx, scale);
  ctx.fillStyle = color;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(fromPixel, baseline);
  for (let index = 0; index < samples; index += 1) {
    const x = from + index * step;
    ctx.lineTo(scale.toPixelX(x), scale.toPixelY(dt(x, df, ncp)));
  }
  ctx.lineTo(toPixel, baseline);
  ctx.fill();
  ctx.restore();
}

/**
 * Mark the alternative's midpoint.
 *
 * R passes `quants = c(0.5)` to `plott()`, which draws a segment from the axis
 * up to the curve, in the same translucent colour as the fill.
 */
function drawMedianSegment(
  ctx: Context2D,
  scale: Scale,
  stats: TTestStats,
): void {
  if (!Number.isFinite(stats.altMedian)) {
    return;
  }

  ctx.save();
  clipToArea(ctx, scale);
  ctx.strokeStyle = ALT_FILL;
  ctx.lineWidth = LINE_WIDTH;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(scale.toPixelX(stats.altMedian), scale.toPixelY(0));
  ctx.lineTo(
    scale.toPixelX(stats.altMedian),
    scale.toPixelY(stats.altMedianDensity),
  );
  ctx.stroke();
  ctx.restore();
}

/** Keep drawing inside the plot area, as base graphics does by default. */
function clipToArea(ctx: Context2D, scale: Scale): void {
  const { area } = scale;
  ctx.beginPath();
  ctx.rect(area.left, area.top, area.width, area.height);
  ctx.clip();
}

/**
 * Draw the four outcomes of the test, and ring the likely row.
 *
 * R builds this from four `recttext()` calls plus a fifth for the ring. Two of
 * the four values are printed through `round(x, 2)` and two are not, which is
 * R's own inconsistency and is kept.
 */
function drawErrorMatrix(
  ctx: Context2D,
  scale: Scale,
  stats: TTestStats,
): void {
  const { errorMatrix: cells, alpha } = stats;

  ctx.save();
  ctx.setLineDash([]);

  drawCell(ctx, scale, {
    left: MATRIX.left,
    bottom: MATRIX.centre,
    right: MATRIX.middle,
    top: MATRIX.top,
    fill: NULL_FILL,
    title: "Type I error",
    value: formatNumber(alpha),
    rowCaption: ["If evidence says", "REJECT", "null hypothesis"],
    columnCaption: ["If null is", "really TRUE"],
  });

  drawCell(ctx, scale, {
    left: MATRIX.middle,
    bottom: MATRIX.centre,
    right: MATRIX.right,
    top: MATRIX.top,
    fill: CORRECT_FILL,
    title: "Correct!",
    value: formatStat(cells.correctReject),
    columnCaption: ["If null is", "really FALSE"],
  });

  drawCell(ctx, scale, {
    left: MATRIX.left,
    bottom: MATRIX.bottom,
    right: MATRIX.middle,
    top: MATRIX.centre,
    fill: CORRECT_FILL,
    title: "Correct!",
    value: formatNumber(cells.correctFailToReject),
    rowCaption: ["If evidence says", "CANNOT REJECT", "null hypothesis"],
  });

  drawCell(ctx, scale, {
    left: MATRIX.middle,
    bottom: MATRIX.bottom,
    right: MATRIX.right,
    top: MATRIX.centre,
    fill: NULL_FILL,
    title: "Type II error",
    value: formatStat(cells.typeTwo),
  });

  const ringBottom = cells.highlightTopRow ? MATRIX.centre : MATRIX.bottom;
  const ringTop = cells.highlightTopRow ? MATRIX.top : MATRIX.centre;
  ctx.strokeStyle = ALT_COLOR;
  ctx.lineWidth = HIGHLIGHT_WIDTH;
  ctx.beginPath();
  ctx.rect(...worldRect(scale, MATRIX.left, ringBottom, MATRIX.right, ringTop));
  ctx.stroke();

  ctx.restore();
}

/** Everything one cell of the matrix needs. */
interface Cell {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
  readonly fill: string;
  readonly title: string;
  readonly value: string;
  /** Rotated text to the left of the row. */
  readonly rowCaption?: readonly string[];
  /** Text above the column. */
  readonly columnCaption?: readonly string[];
}

/** R's `recttext()`: a filled box, its captions, its title, and its value. */
function drawCell(ctx: Context2D, scale: Scale, cell: Cell): void {
  const centreX = (cell.left + cell.right) / 2;
  const centreY = (cell.bottom + cell.top) / 2;

  ctx.fillStyle = cell.fill;
  ctx.beginPath();
  ctx.rect(...worldRect(scale, cell.left, cell.bottom, cell.right, cell.top));
  ctx.fill();

  ctx.fillStyle = TEXT_COLOR;
  ctx.textAlign = "center";

  ctx.font = TITLE_FONT;
  ctx.textBaseline = "top";
  // R: the title sits just inside the top edge, at `yt - 0.015`.
  ctx.fillText(
    cell.title,
    scale.toPixelX(centreX),
    scale.toPixelY(cell.top - 0.015),
  );

  ctx.font = VALUE_FONT;
  ctx.textBaseline = "middle";
  ctx.fillText(cell.value, scale.toPixelX(centreX), scale.toPixelY(centreY));

  ctx.font = `${CAPTION_FONT_SIZE}px sans-serif`;
  if (cell.columnCaption !== undefined) {
    // R: the column caption sits above the top edge, at `yt + 0.02`. The block
    // stacks upward, so its last line lands on that anchor. On a short surface
    // that anchor would carry the stack off the top of the plot, so it gives
    // way, for the same reason the row captions do: canvas clips no text.
    ctx.textBaseline = "bottom";
    const blockHeight =
      (cell.columnCaption.length - 1) * CAPTION_LINE_HEIGHT;
    const anchor = Math.max(
      scale.toPixelY(cell.top + 0.02),
      scale.area.top + blockHeight + CAPTION_FONT_SIZE,
    );
    drawLines(
      ctx,
      cell.columnCaption,
      scale.toPixelX(centreX),
      anchor - blockHeight,
      CAPTION_LINE_HEIGHT,
    );
  }

  if (cell.rowCaption !== undefined) {
    const gapLeft = scale.toPixelX(WORLD_X.min);
    const layout = fitCaption(
      scale.toPixelX(cell.left) - gapLeft,
      cell.rowCaption.length,
    );

    ctx.save();
    ctx.font = `${layout.fontSize}px sans-serif`;
    // Turned a quarter turn, the stack runs left to right across the gap, so
    // the offset between lines becomes a horizontal step on the surface.
    ctx.translate(gapLeft + layout.start, scale.toPixelY(centreY));
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawLines(ctx, cell.rowCaption, 0, 0, layout.advance);
    ctx.restore();
  }
}

/** How a stack of caption lines is laid out across the gap it has to fit. */
interface CaptionLayout {
  /** The step from one line to the next. */
  readonly advance: number;
  /** The type size that step leaves room for. */
  readonly fontSize: number;
  /** Where the first line sits, measured from the start of the gap. */
  readonly start: number;
}

/**
 * Fit a stack of caption lines into the space beside the cells.
 *
 * R anchors the turned row captions at `xl - 0.45` and leaves the rest to base
 * graphics, which clips whatever crosses the edge of the plot region. Canvas
 * clips no text, so the same anchor puts two of each block's three lines out
 * over the axis numbers. This is the deliberate deviation: the block is
 * centred in the gap between the edge of the plot and the edge of the cells,
 * which is where R's clipped version ends up looking like it sits anyway.
 *
 * A narrow surface leaves a narrow gap. The lines then close up and the type
 * shrinks to match, so the block still reads and still stays inside the
 * picture, rather than spilling over the axis.
 */
function fitCaption(gap: number, lineCount: number): CaptionLayout {
  const advance = Math.min(CAPTION_LINE_HEIGHT, gap / lineCount);
  const fontSize = Math.max(
    MIN_CAPTION_FONT_SIZE,
    Math.min(CAPTION_FONT_SIZE, advance - 1),
  );
  return { advance, fontSize, start: (gap - (lineCount - 1) * advance) / 2 };
}

/** Draw a caption that R writes with newlines in it. */
function drawLines(
  ctx: Context2D,
  lines: readonly string[],
  x: number,
  y: number,
  advance: number,
): void {
  for (const [index, line] of lines.entries()) {
    ctx.fillText(line, x, y + index * advance);
  }
}

/** Turn a world box into the arguments `rect` wants, top-left and size. */
function worldRect(
  scale: Scale,
  left: number,
  bottom: number,
  right: number,
  top: number,
): [number, number, number, number] {
  const x = scale.toPixelX(left);
  const y = scale.toPixelY(top);
  return [x, y, scale.toPixelX(right) - x, scale.toPixelY(bottom) - y];
}
