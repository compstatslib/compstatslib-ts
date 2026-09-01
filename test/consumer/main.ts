// A consumer of the published package, resolving through its `exports` map
// under `node16`/`nodenext`. Every import here must type-check with
// `skipLibCheck: false`.
import { mean, optim, pchisq } from "@compstats/core";
import { matrix } from "@compstats/core/linalg";
import { moderationData, pnorm } from "@compstats/core/stats";

const x: number = pchisq(1, 2);
const m: number = mean([1, 2, 3]);
const ncol: number = matrix([1, 2, 3, 4], { nrow: 2 }).ncol;
const p: number = pnorm(0);
const rows: number = moderationData.y.length;
const fit = optim([1, 1], (par) => (par[0] as number) ** 2 + (par[1] as number) ** 2);
const value: number = fit.value;

export const results = { x, m, ncol, value, p, rows };
