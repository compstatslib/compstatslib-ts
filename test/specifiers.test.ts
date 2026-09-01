import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every relative specifier this package publishes must carry a `.js`
 * extension.
 *
 * `tsconfig.json` uses `moduleResolution: "bundler"`, which accepts an
 * extensionless specifier, so nothing inside this repo notices when one is
 * written. A consumer on `node16`/`nodenext` does: the emitted `.d.ts`
 * re-exports relatively, and TypeScript rejects the extensionless form with
 * TS2834. Worse, under the consumer's `skipLibCheck: true` (the common case)
 * it does not reject at all — every export silently becomes `any`.
 *
 * `test/consumer/check.ts` catches the same defect from the outside, against a
 * built `dist/`. This test catches it at the source, with no build.
 */

const ROOTS = ["src", "demo", "test"];

/** `demo/server.ts` imports the demo page; Bun bundles it, and it is not published. */
const ALLOWED_WITHOUT_JS = new Set(["./index.html"]);

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bexport\s*\*\s*from\s*)["'](\.[^"']*)["']/g;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? walk(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });

const offenders = ROOTS.flatMap(walk).flatMap((path) => {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(SPECIFIER)]
    .map((match) => match[1] as string)
    .filter((spec) => !spec.endsWith(".js") && !ALLOWED_WITHOUT_JS.has(spec))
    .map((spec) => `${path}: "${spec}"`);
});

describe("relative import specifiers", () => {
  test("every relative specifier ends in .js", () => {
    expect(offenders).toEqual([]);
  });

  test("the scan actually found specifiers to check", () => {
    const found = ROOTS.flatMap(walk).flatMap((path) => [
      ...readFileSync(path, "utf8").matchAll(SPECIFIER),
    ]);
    expect(found.length).toBeGreaterThan(400);
  });
});
