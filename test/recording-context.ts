/**
 * A recording stand-in for a canvas 2D context.
 *
 * happy-dom has no 2D canvas context, so plot tests draw into this object and
 * assert on the calls it records. Each plot function draws through the
 * `Context2D` surface in `src/plot/target.ts`, so this stub substitutes for a
 * real context with no DOM.
 *
 * Each recorded call carries a snapshot of the drawing style, because a call
 * such as `stroke()` only means something together with the color and width
 * in force at that moment. `save()` and `restore()` push and pop that style,
 * as a real context does.
 */

import type { Context2D } from "../src/plot/target";

/** The drawing style in force when a call was recorded. */
export interface DrawStyle {
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly lineWidth: number;
  readonly font: string;
  readonly textAlign: CanvasTextAlign;
  readonly textBaseline: CanvasTextBaseline;
  readonly lineDash: readonly number[];
}

/** One recorded drawing call. */
export interface DrawCall {
  readonly method: string;
  readonly args: readonly unknown[];
  readonly style: DrawStyle;
}

export class RecordingContext implements Context2D {
  readonly calls: DrawCall[] = [];

  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
  lineWidth = 1;
  font = "10px sans-serif";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";

  private lineDash: readonly number[] = [];
  private readonly saved: DrawStyle[] = [];

  /** Return every call to one method, in order. */
  callsTo(method: string): DrawCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  /** Return the text of every `fillText` call, in order. */
  texts(): string[] {
    return this.callsTo("fillText").map((call) => String(call.args[0]));
  }

  save(): void {
    this.saved.push(this.snapshot());
    this.record("save", []);
  }

  restore(): void {
    const style = this.saved.pop();
    if (style !== undefined) {
      this.fillStyle = style.fillStyle;
      this.strokeStyle = style.strokeStyle;
      this.lineWidth = style.lineWidth;
      this.font = style.font;
      this.textAlign = style.textAlign;
      this.textBaseline = style.textBaseline;
      this.lineDash = style.lineDash;
    }
    this.record("restore", []);
  }

  beginPath(): void {
    this.record("beginPath", []);
  }

  moveTo(x: number, y: number): void {
    this.record("moveTo", [x, y]);
  }

  lineTo(x: number, y: number): void {
    this.record("lineTo", [x, y]);
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.record("arc", [x, y, radius, startAngle, endAngle, counterclockwise]);
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.record("rect", [x, y, width, height]);
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.record("fillRect", [x, y, width, height]);
  }

  clip(): void {
    this.record("clip", []);
  }

  fill(): void {
    this.record("fill", []);
  }

  stroke(): void {
    this.record("stroke", []);
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.record("fillText", [text, x, y, maxWidth]);
  }

  setLineDash(segments: number[]): void {
    this.lineDash = [...segments];
    this.record("setLineDash", [[...segments]]);
  }

  translate(x: number, y: number): void {
    this.record("translate", [x, y]);
  }

  rotate(angle: number): void {
    this.record("rotate", [angle]);
  }

  private snapshot(): DrawStyle {
    return {
      fillStyle: String(this.fillStyle),
      strokeStyle: String(this.strokeStyle),
      lineWidth: this.lineWidth,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      lineDash: this.lineDash,
    };
  }

  private record(method: string, args: readonly unknown[]): void {
    this.calls.push({ method, args, style: this.snapshot() });
  }
}
