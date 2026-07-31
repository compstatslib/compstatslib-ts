/**
 * Tests for the shared drawing primitives.
 *
 * These are structural checks against a recording context, in the style of the
 * plot tests that used to hold a copy of each of these functions. The R
 * behavior each one reproduces is documented and pinned in the plot modules
 * that call them; this file covers the shared contract alone — what reaches
 * the context, in what order, under which style.
 */

import { describe, expect, test } from "bun:test";

import { RecordingContext } from "../../test/recording-context";
import { createScale } from "./axes";
import type { Scale } from "./axes";
import { DOTTED, clearSurface, clipToArea, drawArrow, drawDots } from "./draw";

/** A plain scale over a 200 x 100 surface, world 0 to 10 on both axes. */
function testScale(): Scale {
  return createScale({
    width: 200,
    height: 100,
    x: { min: 0, max: 10 },
    y: { min: 0, max: 10 },
  });
}

describe("DOTTED", () => {
  test("is R's dotted line type", () => {
    expect(DOTTED).toEqual([1, 3]);
  });
});

describe("clearSurface", () => {
  test("paints the whole surface white with no dash in force", () => {
    const ctx = new RecordingContext();

    clearSurface(ctx, 200, 100);

    const painted = ctx.callsTo("fillRect");
    expect(painted).toHaveLength(1);
    expect(painted[0]?.args).toEqual([0, 0, 200, 100]);
    expect(painted[0]?.style.fillStyle).toBe("#ffffff");
    expect(painted[0]?.style.lineDash).toEqual([]);
  });
});

describe("clipToArea", () => {
  test("clips to the plot area's rectangle", () => {
    const ctx = new RecordingContext();
    const { area } = testScale();

    clipToArea(ctx, area);

    expect(ctx.calls.map((call) => call.method)).toEqual([
      "beginPath",
      "rect",
      "clip",
    ]);
    expect(ctx.callsTo("rect")[0]?.args).toEqual([
      area.left,
      area.top,
      area.width,
      area.height,
    ]);
  });

  test("does not save the state, leaving that to the caller", () => {
    const ctx = new RecordingContext();

    clipToArea(ctx, testScale().area);

    expect(ctx.callsTo("save")).toHaveLength(0);
    expect(ctx.callsTo("restore")).toHaveLength(0);
  });
});

describe("drawDots", () => {
  test("draws one filled dot per point, at R's gray and size", () => {
    const ctx = new RecordingContext();
    const scale = testScale();

    drawDots(ctx, scale, [
      { x: 2, y: 4 },
      { x: 8, y: 6 },
    ]);

    const dots = ctx.callsTo("arc");
    expect(dots).toHaveLength(2);
    expect(ctx.callsTo("fill")).toHaveLength(2);
    expect(dots[0]?.args.slice(0, 3)).toEqual([
      scale.toPixelX(2),
      scale.toPixelY(4),
      6,
    ]);
    // R's `col = "gray"` is #BEBEBE, not the darker CSS colour of that name.
    expect(dots[0]?.style.fillStyle).toBe("#bebebe");
    expect(dots[0]?.style.lineDash).toEqual([]);
  });

  test("restores the style it found", () => {
    const ctx = new RecordingContext();
    ctx.fillStyle = "red";

    drawDots(ctx, testScale(), [{ x: 1, y: 1 }]);

    expect(ctx.fillStyle).toBe("red");
  });

  test("draws nothing for no points", () => {
    const ctx = new RecordingContext();

    drawDots(ctx, testScale(), []);

    expect(ctx.callsTo("arc")).toHaveLength(0);
  });
});

describe("drawArrow", () => {
  test("draws a shaft and one head at the tip", () => {
    const ctx = new RecordingContext();

    drawArrow(ctx, [10, 50], [90, 50], { headLength: 10 });

    // Shaft: move to the tail, line to the tip. Head: move to one edge, back
    // through the tip, out to the other — R's `code = 2`, a head at the tip.
    expect(ctx.callsTo("moveTo")).toHaveLength(2);
    expect(ctx.callsTo("lineTo")).toHaveLength(3);
    expect(ctx.callsTo("moveTo")[0]?.args).toEqual([10, 50]);
    expect(ctx.callsTo("lineTo")[0]?.args).toEqual([90, 50]);
    expect(ctx.callsTo("stroke")).toHaveLength(1);
  });

  test("puts the head edges at R's 30 degrees from the shaft", () => {
    const ctx = new RecordingContext();

    drawArrow(ctx, [10, 50], [90, 50], { headLength: 10 });

    // Pointing right, so each edge runs back and away by 30 degrees.
    const [firstX, firstY] = ctx.callsTo("moveTo")[1]?.args as [number, number];
    expect(firstX).toBeCloseTo(90 - 10 * Math.cos(Math.PI / 6), 12);
    expect(Math.abs(firstY - 50)).toBeCloseTo(10 * Math.sin(Math.PI / 6), 12);
  });

  test("scales the head to the length asked for", () => {
    const ctx = new RecordingContext();

    drawArrow(ctx, [10, 50], [90, 50], { headLength: 24 });

    const [firstX] = ctx.callsTo("moveTo")[1]?.args as [number, number];
    expect(firstX).toBeCloseTo(90 - 24 * Math.cos(Math.PI / 6), 12);
  });

  test("defaults to R's black solid arrow at line width one", () => {
    const ctx = new RecordingContext();

    drawArrow(ctx, [10, 50], [90, 50], { headLength: 10 });

    const stroked = ctx.callsTo("stroke")[0];
    expect(stroked?.style.strokeStyle).toBe("#000000");
    expect(stroked?.style.lineWidth).toBe(1);
    expect(stroked?.style.lineDash).toEqual([]);
  });

  test("dashes the whole arrow, head included, as R's lty does", () => {
    const ctx = new RecordingContext();

    drawArrow(ctx, [10, 50], [90, 50], { headLength: 10, dash: DOTTED });

    expect(ctx.callsTo("stroke")[0]?.style.lineDash).toEqual(DOTTED);
  });

  test("takes a colour and a line width", () => {
    const ctx = new RecordingContext();

    drawArrow(ctx, [10, 50], [90, 50], {
      headLength: 10,
      color: "cornflowerblue",
      lineWidth: 3,
    });

    expect(ctx.callsTo("stroke")[0]?.style.strokeStyle).toBe("cornflowerblue");
    expect(ctx.callsTo("stroke")[0]?.style.lineWidth).toBe(3);
  });

  test("skips an arrow too short to have a direction", () => {
    const ctx = new RecordingContext();

    // R: arrowheads are omitted below 1/1000 inch, which is 96/1000 pixels.
    drawArrow(ctx, [50, 50], [50, 50], { headLength: 10 });
    drawArrow(ctx, [50, 50], [50.05, 50], { headLength: 10 });

    expect(ctx.calls).toHaveLength(0);
  });

  test("draws an arrow just above the shortest length", () => {
    const ctx = new RecordingContext();

    drawArrow(ctx, [50, 50], [50.2, 50], { headLength: 10 });

    expect(ctx.callsTo("stroke")).toHaveLength(1);
  });

  test("skips an arrow with a non-finite end, drawing no NaN", () => {
    const ctx = new RecordingContext();

    drawArrow(ctx, [50, 50], [Number.NaN, 50], { headLength: 10 });

    expect(ctx.calls).toHaveLength(0);
  });

  test("restores the style it found", () => {
    const ctx = new RecordingContext();
    ctx.strokeStyle = "red";
    ctx.lineWidth = 7;

    drawArrow(ctx, [10, 50], [90, 50], { headLength: 10 });

    expect(ctx.strokeStyle).toBe("red");
    expect(ctx.lineWidth).toBe(7);
  });
});
