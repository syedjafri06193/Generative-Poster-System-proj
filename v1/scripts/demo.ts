/** Generate one poster and print a summary. Usage: npm run demo -- [seed] */
import { SAMPLE_BRIEF } from "../src/briefs.js";
import { parseSeed } from "../src/core/prng.js";
import { generate, hashDocument } from "../src/generate.js";
import { loadGrammar } from "../src/grammar/registry.js";
import { loadContext } from "../src/node.js";

const seed = parseSeed(process.argv[2] ?? "7f3a-9c21-0e48");
const ctx = await loadContext();
const t0 = performance.now();
const { doc, attempt, rejected } = generate(loadGrammar("poster-grid@1"), seed, SAMPLE_BRIEF, ctx);
console.log(`seed ${doc.provenance.seed}: ${doc.nodes.length} nodes, attempt ${attempt}, ${(performance.now() - t0).toFixed(0)} ms`);
for (const r of rejected) console.log(`  rejected #${r.attempt}: ${r.reason}`);
console.log(`hash ${hashDocument(doc)}`);
