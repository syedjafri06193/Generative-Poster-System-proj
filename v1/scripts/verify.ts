/** Hard-constraint sweep (§15.1). Usage: npm run verify -- [n=10000] */
import { SAMPLE_BRIEF } from "../src/briefs.js";
import { generate, GenerationError } from "../src/generate.js";
import { loadGrammar } from "../src/grammar/registry.js";
import { loadContext } from "../src/node.js";
import { preflight } from "../src/render-pdf/preflight.js";

const n = Number(process.argv[2] ?? 10000);
const ctx = await loadContext();
const g = loadGrammar("poster-grid@1");
let failed = 0, preflightErrors = 0;
for (let i = 0; i < n; i++) {
  try {
    const { doc } = generate(g, BigInt(i) * 0x9e3779b1n, SAMPLE_BRIEF, ctx);
    if (!preflight(doc, ctx.profile).ok) preflightErrors++;
  } catch (e) {
    if (e instanceof GenerationError) failed++; else throw e;
  }
  if ((i + 1) % 1000 === 0) console.log(`${i + 1}/${n}  failed ${failed}  preflight ${preflightErrors}`);
}
process.exit(failed || preflightErrors ? 1 : 0);
