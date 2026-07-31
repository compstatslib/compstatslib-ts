/**
 * Tests for the moderation surface plot.
 *
 * The numbers come from `.claude/plans/moderation-fixtures.md` section 3,
 * computed in R 4.5.3 over the bundled `moderation_data` with
 * `iv = "x"`, `mod = "z"`. Grid rows are R's `expand.grid(seq_x, seq_z)`
 * order, the IV varying fastest, printed with `%.17g`:
 *
 * ```text
 * M1  y ~ x * z
 *   1: x=-5.9861801663058696 z=-5.3998596171274054 y=22.852752254764869
 *   2: x=-5.1726114400919077 z=-5.3998596171274054 y=19.510567913877459
 *  15: x=5.4037820006895947  z=-5.3998596171274054 y=-23.937828517658883
 *  16: x=-5.9861801663058696 z=-4.6627848517796746 y=19.341508766003333
 * 113: x=-0.29119908280813789 z=-0.24033625969328742 y=-0.19875819665649219
 * 225: x=5.4037820006895947  z=4.9191870977408296  y=26.594700064164726
 *   zlim M1 = -26.304656587896684 26.594700064164726
 *
 * M2  y ~ x + z        zlim = -14.110628278307653 18.102464141094789
 * M3  y ~ x + z + w + x:z
 *   zlim = -26.302625246073081 26.592960891288858
 *   message: Surface shows predicted y over x and z. Other predictors are
 *            held at their typical values.
 *
 * seq_x[1] = -5.9861801663058696  seq_x[15] = 5.4037820006895947
 * seq_z[1] = -5.3998596171274054  seq_z[15] = 4.9191870977408296
 * ```
 *
 * The camera values are not R's — lattice's `screen = list(z, x)` has no
 * Plotly equivalent. They pin this port's own mapping, computed once from
 * the formula in `cameraFromRotations` and written here so that a change to
 * the trigonometry is visible as a failing test rather than a moved picture.
 */

import { describe, expect, test } from "bun:test";
import {
  cameraFromRotations,
  moderation3dSpec,
  plotModeration3d,
} from "./moderation3d";
import { moderationSurface } from "../core/moderation";
import { moderationData } from "../data/moderationData";
import { RecordingPlotly, plotlyTarget } from "../../test/recording-plotly";
import type { SurfaceTrace } from "./plotly";

const MODEL = { outcome: "y", iv: "x", mod: "z" } as const;

/**
 * The tolerance of `core/moderation.test.ts`, for the same reason: R sums the
 * prediction in a different order. This module reshapes those numbers and
 * changes none of them, so an exact assertion here would test the fit again,
 * and would fail on a last-digit difference that the core already accepts.
 */
const RELATIVE_TOLERANCE = 1e-12;

function expectCloseToR(actual: number | undefined, expected: number): void {
  expect(typeof actual).toBe("number");
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(
    RELATIVE_TOLERANCE * Math.max(1, Math.abs(expected)),
  );
}

const ZLIM_M1 = [-26.304656587896684, 26.594700064164726] as const;
const ZLIM_M2 = [-14.110628278307653, 18.102464141094789] as const;
const ZLIM_M3 = [-26.302625246073081, 26.592960891288858] as const;

/** The one surface trace of a moderation spec. */
function surfaceTrace(spec: { readonly traces: readonly unknown[] }): SurfaceTrace {
  return spec.traces[0] as SurfaceTrace;
}

const SURFACE = moderationSurface(moderationData, MODEL);

describe("moderation3dSpec grid", () => {
  test("builds one surface trace with no colour bar", () => {
    const spec = moderation3dSpec(SURFACE, MODEL);

    expect(spec.traces.length).toBe(1);
    expect(surfaceTrace(spec).type).toBe("surface");
    expect(surfaceTrace(spec).showscale).toBe(false);
  });

  test("puts the IV on x and the moderator on y, 15 steps each", () => {
    const trace = surfaceTrace(moderation3dSpec(SURFACE, MODEL));

    expect(trace.x.length).toBe(15);
    expect(trace.y.length).toBe(15);
    expect(trace.x[0]).toBe(-5.9861801663058696);
    expect(trace.x[14]).toBe(5.4037820006895947);
    expect(trace.y[0]).toBe(-5.3998596171274054);
    expect(trace.y[14]).toBe(4.9191870977408296);
  });

  test("reshapes the predictions as z[mod][iv], R's own grid order", () => {
    const trace = surfaceTrace(moderation3dSpec(SURFACE, MODEL));

    expect(trace.z.length).toBe(15);
    expect(trace.z.every((row) => row.length === 15)).toBe(true);
    expectCloseToR(trace.z[0]?.[0], 22.852752254764869);
    expectCloseToR(trace.z[0]?.[1], 19.510567913877459);
    expectCloseToR(trace.z[0]?.[14], -23.937828517658883);
    expectCloseToR(trace.z[1]?.[0], 19.341508766003333);
    expectCloseToR(trace.z[7]?.[7], -0.19875819665649219);
    expectCloseToR(trace.z[14]?.[14], 26.594700064164726);
  });

  test("holds every prediction, each in its own place", () => {
    const trace = surfaceTrace(moderation3dSpec(SURFACE, MODEL));
    const flattened = trace.z.flatMap((row) => [...row]);

    expect(flattened).toEqual([...SURFACE.predictions]);
  });
});

describe("moderation3dSpec layout", () => {
  test("titles the axes with the column names, the outcome standing up", () => {
    const { layout } = moderation3dSpec(SURFACE, MODEL);

    expect(layout.scene.xaxis.title).toBe("x");
    expect(layout.scene.yaxis.title).toBe("z");
    expect(layout.scene.zaxis.title).toBe("y");
  });

  test("takes the vertical range from the surface", () => {
    const { layout } = moderation3dSpec(SURFACE, MODEL);

    expect(layout.scene.zaxis.range).toEqual([...SURFACE.zlim]);
    expectCloseToR(layout.scene.zaxis.range?.[0], ZLIM_M1[0]);
    expectCloseToR(layout.scene.zaxis.range?.[1], ZLIM_M1[1]);
  });

  test("lets the caller set the vertical range instead", () => {
    const { layout } = moderation3dSpec(SURFACE, MODEL, { zlim: [-10, 10] });

    expect(layout.scene.zaxis.range).toEqual([-10, 10]);
  });

  test("keeps one revision so a redraw does not move the camera", () => {
    const { layout } = moderation3dSpec(SURFACE, MODEL);

    expect(layout.uirevision).toBe("moderation3d");
    expect(layout.scene.uirevision).toBe("moderation3d");
  });

  test("opens at the view R's default rotations describe", () => {
    const { layout } = moderation3dSpec(SURFACE, MODEL);

    expect(layout.scene.camera).toEqual(cameraFromRotations(40, -70));
  });

  test("follows the rotations it is given", () => {
    const { layout } = moderation3dSpec(SURFACE, MODEL, {
      zRot: 270,
      xRot: -90,
    });

    expect(layout.scene.camera).toEqual(cameraFromRotations(270, -90));
  });
});

describe("cameraFromRotations", () => {
  const RADIUS = 2.1650635094610964;

  test("keeps Plotly's own viewing distance", () => {
    for (const [zRot, xRot] of [
      [40, -70],
      [0, -90],
      [123, -80],
    ] as const) {
      const eye = cameraFromRotations(zRot, xRot).eye;
      expect(Math.hypot(eye.x, eye.y, eye.z)).toBeCloseTo(RADIUS, 12);
    }
  });

  test("pins the default view", () => {
    expect(cameraFromRotations(40, -70)).toEqual({
      eye: {
        x: -1.3077476659075298,
        y: -1.5585129790519912,
        z: 0.7404953318150594,
      },
    });
  });

  test("puts the IV across the screen at 0, as R's help says", () => {
    const eye = cameraFromRotations(0, -70).eye;

    expect(Math.abs(eye.x)).toBeLessThan(1e-15);
    expect(eye.y).toBeCloseTo(-2.034494203373434, 12);
  });

  test("puts the moderator across the screen at 270", () => {
    const eye = cameraFromRotations(270, -70).eye;

    expect(Math.abs(eye.y)).toBeLessThan(1e-15);
    expect(eye.x).toBeCloseTo(2.034494203373434, 12);
  });

  test("rises with the tilt: -90 looks along the floor, -70 stands above it", () => {
    expect(cameraFromRotations(40, -90).eye.z).toBeCloseTo(0, 12);
    expect(cameraFromRotations(40, -70).eye.z).toBeCloseTo(0.7404953318150594, 12);
    expect(cameraFromRotations(40, -80).eye.z).toBeGreaterThan(0);
    expect(cameraFromRotations(40, -80).eye.z).toBeLessThan(
      cameraFromRotations(40, -70).eye.z,
    );
  });

  test("turns full circle", () => {
    const once = cameraFromRotations(40, -70).eye;
    const again = cameraFromRotations(400, -70).eye;

    expect(once.x).toBe(-1.3077476659075298);
    expect(again.x).toBeCloseTo(once.x, 12);
    expect(again.y).toBeCloseTo(once.y, 12);
    expect(again.z).toBeCloseTo(once.z, 12);
  });

  test("refuses rotations that are not numbers", () => {
    expect(() => cameraFromRotations(Number.NaN, -70)).toThrow(
      "`zRot` and `xRot` must be finite numbers.",
    );
    expect(() => cameraFromRotations(40, Number.POSITIVE_INFINITY)).toThrow(
      "`zRot` and `xRot` must be finite numbers.",
    );
  });
});

describe("moderation3dSpec notes", () => {
  test("says nothing when every predictor is on an axis", () => {
    const spec = moderation3dSpec(SURFACE, MODEL);

    expect(spec.note).toBe(null);
    expect(surfaceTrace(spec).z.length).toBe(15);
  });

  test("repeats R's sentence when predictors are held", () => {
    const model = { ...MODEL, controls: ["w"] };
    const spec = moderation3dSpec(moderationSurface(moderationData, model), model);

    expect(spec.note).toBe(
      "Surface shows predicted y over x and z. " +
        "Other predictors are held at their typical values.",
    );
  });
});

describe("plotModeration3d", () => {
  test("fits the surface, draws it, and hands both back", async () => {
    const engine = new RecordingPlotly();
    const element = plotlyTarget();

    const handle = await plotModeration3d(element, moderationData, {
      ...MODEL,
      plotly: engine,
    });
    const spec = moderation3dSpec(SURFACE, MODEL);

    expect(engine.calls.length).toBe(1);
    expect(engine.last().element).toBe(element);
    expect(engine.last().data).toEqual(spec.traces);
    expect(engine.last().layout).toEqual(spec.layout);
    expect(engine.last().config).toEqual({ responsive: true });
    expect(handle.element).toBe(element);
    expect(handle.plotly).toBe(engine);
    expect(handle.note).toBe(null);
    expect(handle.surface).toEqual(SURFACE);
  });

  test("forwards the model options to the surface, model for model", async () => {
    const engine = new RecordingPlotly();

    const additive = await plotModeration3d(plotlyTarget(), moderationData, {
      ...MODEL,
      interaction: false,
      plotly: engine,
    });
    expect(additive.surface.zlim).toEqual([...ZLIM_M2]);
    expect(additive.layout.scene.zaxis.range).toEqual([...additive.surface.zlim]);

    const controlled = await plotModeration3d(plotlyTarget(), moderationData, {
      ...MODEL,
      controls: ["w"],
      plotly: engine,
    });
    expectCloseToR(controlled.surface.zlim[0], ZLIM_M3[0]);
    expectCloseToR(controlled.surface.zlim[1], ZLIM_M3[1]);
    expect(controlled.layout.scene.zaxis.range).toEqual([
      ...controlled.surface.zlim,
    ]);
    expectCloseToR(controlled.surface.holds.w, -0.25603872504820924);
    expect(controlled.note).toContain("held at their typical values");
  });

  test("never touches the engine when the model is refused", async () => {
    const engine = new RecordingPlotly();

    await expect(
      plotModeration3d(plotlyTarget(), moderationData, {
        outcome: "y",
        iv: "x",
        mod: "x",
        plotly: engine,
      }),
    ).rejects.toThrow("must name different columns");
    await expect(
      plotModeration3d(plotlyTarget(), moderationData, {
        outcome: "y",
        iv: "nope",
        mod: "z",
        plotly: engine,
      }),
    ).rejects.toThrow('Column "nope" (passed as `iv`) is not in the data.');
    await expect(
      plotModeration3d(plotlyTarget(), moderationData, {
        ...MODEL,
        zRot: Number.NaN,
        plotly: engine,
      }),
    ).rejects.toThrow("`zRot` and `xRot` must be finite numbers.");

    expect(engine.calls.length).toBe(0);
  });

  test("refuses a vertical range that is not two numbers", () => {
    expect(() =>
      moderation3dSpec(SURFACE, MODEL, { zlim: [0, Number.NaN] }),
    ).toThrow("`zlim` must be two finite numbers.");
  });
});
