/**
 * Fit scoring weights from recorded preferences (§10.3).
 * Usage: npm run tune -- prefs.json   where prefs.json is [{"preferred":"seed","rejected":"seed"}, ...]
 * (the Studio's "A is better" buttons export this file).
 */
import { readFileSync } from "node:fs";
import { SAMPLE_BRIEF } from "../src/briefs.js";
import { parseSeed } from "../src/core/prng.js";
import { generate } from "../src/generate.js";
import { loadGrammar } from "../src/grammar/registry.js";
import { loadContext } from "../src/node.js";
import { features } from "../src/score/score.js";
import { tuneWeights } from "../src/score/tune.js";

const pairs = JSON.parse(readFileSync(process.argv[2] ?? "prefs.json", "utf8")) as { preferred: string; rejected: string }[];
const ctx = await loadContext();
const g = loadGrammar("poster-grid@1");
const f = (s: string) => features(generate(g, parseSeed(s), SAMPLE_BRIEF, ctx).doc);
const result = tuneWeights(pairs.map((p) => ({ preferred: f(p.preferred), rejected: f(p.rejected) })));
console.log(JSON.stringify(result, null, 2));
