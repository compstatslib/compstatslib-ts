// A deliberately wrong call. It must still be an error under the consumer's
// `skipLibCheck: true` — that is the setting under which extensionless
// re-exports degrade every export to `any` in silence.
import { pchisq } from "@compstats/core";

export const wrong = pchisq("hello", {}, [], 1, 2, 3);
