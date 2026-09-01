/**
 * Type-checks a `node16`/`nodenext` consumer against the built `dist/`.
 *
 * The repo's own `tsconfig.json` uses `moduleResolution: "bundler"`, which
 * accepts an extensionless relative specifier. A consumer on `nodenext` does
 * not: an extensionless re-export in `dist/*.d.ts` is TS2834 under
 * `skipLibCheck: false`, and — the half that actually reached a published
 * consumer — silently `any` under `skipLibCheck: true`.
 *
 * So this runs two passes, and one alone is not enough:
 *
 *   1. `main.ts` with `skipLibCheck: false` must compile clean.
 *   2. `wrong.ts` with `skipLibCheck: true` must still report an error. If the
 *      declarations have degraded to `any`, a call with six wrong arguments
 *      compiles, and pass 1 cannot see it.
 *
 * Run after `bun run build`. `prepublishOnly` does exactly that.
 *
 * Usage: `bun run test/consumer/check.ts`
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");

const fail = (message: string): never => {
  console.error(`consumer check: ${message}`);
  process.exit(1);
};

for (const entry of ["index", "stats", "linalg"]) {
  if (!existsSync(join(repo, "dist", `${entry}.d.ts`))) {
    fail(`dist/${entry}.d.ts is missing - run \`bun run build\` first`);
  }
}

// The package resolves through its own `exports` map, so the consumer needs it
// under a real `node_modules`. A `paths` mapping would bypass the map and test
// the wrong thing.
const scope = join(here, "node_modules", "@compstats");
rmSync(join(here, "node_modules"), { recursive: true, force: true });
mkdirSync(scope, { recursive: true });
symlinkSync(repo, join(scope, "core"), "dir");

const tsc = async (project: string) =>
  await Bun.$`bunx tsc -p ${join(here, project)}`.nothrow().quiet();

const clean = await tsc("tsconfig.json");
if (clean.exitCode !== 0) {
  console.error(clean.stdout.toString() + clean.stderr.toString());
  fail("main.ts must compile clean under nodenext + skipLibCheck: false");
}

const degraded = await tsc("tsconfig.skiplib.json");
if (degraded.exitCode === 0) {
  fail(
    "wrong.ts compiled under skipLibCheck: true - the declarations have " +
      "degraded to `any`, so the consumer gets no types at all",
  );
}

rmSync(join(here, "node_modules"), { recursive: true, force: true });
console.log("consumer check: passed (nodenext types are real, not `any`)");
