/**
 * A recording stand-in for Plotly.js.
 *
 * The 3D plots draw through the `PlotlyLike` surface in `src/plot/plotly.ts`,
 * so a test can hand them this object instead of the real library. Nothing in
 * the test suite loads Plotly itself: it is four megabytes of browser code
 * that draws with WebGL, which happy-dom does not have, and the port's own
 * work is the trace and layout it builds, not the picture Plotly makes of it.
 *
 * This is the 3D counterpart of `recording-context.ts`.
 */

import type {
  PlotlyConfig,
  PlotlyHTMLElement,
  PlotlyLayout,
  PlotlyLike,
  PlotlyRelayoutEvent,
  PlotlyRelayoutUpdate,
  PlotlyTrace,
} from "../src/plot/plotly";

/** One recorded call to `react`. */
export interface ReactCall {
  readonly element: HTMLElement;
  readonly data: readonly PlotlyTrace[];
  readonly layout: PlotlyLayout;
  readonly config: PlotlyConfig | undefined;
}

/** One recorded call to `relayout`. */
export interface RelayoutCall {
  readonly element: HTMLElement;
  readonly update: PlotlyRelayoutUpdate;
}

/** A Plotly engine that records what it was asked to draw. */
export class RecordingPlotly implements PlotlyLike {
  readonly calls: ReactCall[] = [];
  readonly relayouts: RelayoutCall[] = [];
  readonly purged: HTMLElement[] = [];
  /** Every call, in the order it arrived, so a test can pin the order. */
  readonly log: ("react" | "relayout" | "purge")[] = [];

  react(
    element: HTMLElement,
    data: readonly PlotlyTrace[],
    layout: PlotlyLayout,
    config?: PlotlyConfig,
  ): Promise<PlotlyHTMLElement> {
    this.calls.push({ element, data, layout, config });
    this.log.push("react");
    return Promise.resolve(asPlotlyElement(element));
  }

  relayout(
    element: HTMLElement,
    update: PlotlyRelayoutUpdate,
  ): Promise<PlotlyHTMLElement> {
    this.relayouts.push({ element, update });
    this.log.push("relayout");
    return Promise.resolve(asPlotlyElement(element));
  }

  purge(element: HTMLElement): void {
    this.purged.push(element);
    this.log.push("purge");
  }

  /** The most recent call, or a failure if nothing was drawn. */
  last(): ReactCall {
    const call = this.calls[this.calls.length - 1];
    if (call === undefined) {
      throw new Error("nothing was drawn");
    }
    return call;
  }
}

/** The handlers a test element was given, by event name. */
export interface RecordedListeners {
  readonly handlers: Map<string, ((event: PlotlyRelayoutEvent) => void)[]>;
}

/**
 * Build the element Plotly would hand back: a div that also takes event
 * listeners. The camera capture of the interactive layer needs those.
 */
export function asPlotlyElement(
  element: HTMLElement,
): PlotlyHTMLElement & RecordedListeners {
  const candidate = element as HTMLElement & Partial<RecordedListeners>;
  if (candidate.handlers === undefined) {
    const handlers = new Map<
      string,
      ((event: PlotlyRelayoutEvent) => void)[]
    >();
    Object.assign(candidate, {
      handlers,
      on(event: string, handler: (event: PlotlyRelayoutEvent) => void): void {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      removeAllListeners(event: string): void {
        handlers.delete(event);
      },
    });
  }
  return candidate as PlotlyHTMLElement & RecordedListeners;
}

/**
 * A fresh element for a plot to draw into.
 *
 * The element is prepared as Plotly leaves one, so that a test can compare it
 * with the element a handle reports.
 */
export function plotlyTarget(): PlotlyHTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return asPlotlyElement(element);
}
