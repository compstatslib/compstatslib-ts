/**
 * The DOM-free entry: `@compstats/core/stats`.
 *
 * Two things are asserted here, and the second is the one that matters. The
 * first is that the statistics are reachable from this entry. The second is
 * that its module graph never reaches `plot/` or `interactive/` — that is the
 * whole promise of the subpath, and the architecture rule that makes it true
 * (`core/` is pure; rendering lives in `plot/`) is a rule, not a mechanism.
 * Asserted rather than assumed, so a stray import in `core/` fails here
 * instead of at a consumer's bundler.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as stats from "./stats.js";
import * as root from "./index.js";

describe("@compstats/core/stats", () => {
  test("carries the statistics", () => {
    expect(stats.pchisq(1, 2)).toBe(0.3934693402873667);
    expect(stats.mean([1, 2, 3])).toBe(2);
    expect(stats.pnorm(0)).toBe(0.5);
    expect(stats.qt(0.975, 10)).toBeCloseTo(2.228138851986273, 12);
    const fit = stats.optim([1, 1], (par) => par[0] ** 2 + par[1] ** 2);
    expect(fit.value).toBeCloseTo(0, 12);
  });

  test("carries the bundled data", () => {
    expect(stats.moderationData.y.length).toBe(200);
    expect(stats.pcaDegenerate.length).toBe(16);
  });

  test("the root entry re-exports every one of its names", () => {
    const missing = Object.keys(stats).filter((name) => !(name in root));
    expect(missing).toEqual([]);
  });

  test("the root entry is the stats entry plus the drawing layers", () => {
    expect(Object.keys(root).length).toBeGreaterThan(Object.keys(stats).length);
    expect("plotRegression" in stats).toBe(false);
    expect("interactiveRegression" in stats).toBe(false);
  });
});

/**
 * Walk the relative imports out of a module and return every source file the
 * graph reaches. Every specifier in this package is relative and ends in
 * `.js` (`test/specifiers.test.ts` enforces that), so resolving one is
 * swapping the extension back.
 */
function moduleGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.[^"']*)["']/g,
    )) {
      const specifier = (match[1] as string).replace(/\.js$/, ".ts");
      pending.push(resolve(dirname(file), specifier));
    }
  }
  return seen;
}

describe("the stats entry is DOM-free", () => {
  const src = dirname(Bun.fileURLToPath(import.meta.url));
  const reached = [...moduleGraph(join(src, "stats.ts"))].map((file) =>
    file.slice(src.length + 1),
  );

  test("reaches no plot/ or interactive/ module", () => {
    expect(reached.filter((f) => f.startsWith("plot/"))).toEqual([]);
    expect(reached.filter((f) => f.startsWith("interactive/"))).toEqual([]);
  });

  test("reaches core/ and data/, so the walk is not vacuous", () => {
    expect(reached.some((f) => f.startsWith("core/"))).toBe(true);
    expect(reached.some((f) => f.startsWith("data/"))).toBe(true);
    expect(reached.length).toBeGreaterThan(15);
  });

  /**
   * Comments are stripped first. `core/kde.ts` and `core/pretty.ts` describe
   * R's density and tick *windows* at length, and a scan of raw text reads
   * that prose as a DOM reference.
   */
  test("names no DOM global", () => {
    const code = (file: string) =>
      readFileSync(join(src, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
    const offenders = reached.filter((file) =>
      /\b(?:document|window|globalThis|HTMLCanvasElement|CanvasRenderingContext2D|HTMLElement)\b/.test(
        code(file),
      ),
    );
    expect(offenders).toEqual([]);

    // The scan is not vacuous: the drawing layer it is meant to exclude does
    // name these, so the same test over `index.ts` would report offenders.
    const drawing = [...moduleGraph(join(src, "index.ts"))]
      .map((f) => f.slice(src.length + 1))
      .filter((f) => /\bHTMLCanvasElement\b/.test(code(f)));
    expect(drawing.length).toBeGreaterThan(0);
  });
});
