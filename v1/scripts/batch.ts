/** Generate N candidates, rank by score, write the top K as SVG. Usage: npm run batch -- [masterSeed] [n=64] [k=8] */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_BRIEF } from "../src/briefs.js";
import { formatSeed, parseSeed } from "../src/core/prng.js";
import { loadGrammar } from "../src/grammar/registry.js";
import { loadContext, ROOT } from "../src/node.js";
import { renderSvg } from "../src/render-svg/svg.js";
import { generateBatch } from "../src/score/batch.js";

const master = parseSeed(process.argv[2] ?? "0000-0000-0001");
const n = Number(process.argv[3] ?? 64), k = Number(process.argv[4] ?? 8);
const ctx = await loadContext();
const { ranked, failed } = generateBatch(loadGrammar("poster-grid@1"), master, n, SAMPLE_BRIEF, ctx);
const dir = join(ROOT, "out/batch");
mkdirSync(dir, { recursive: true });
ranked.slice(0, k).forEach((r, i) => {
  const name = `${String(i + 1).padStart(2, "0")}-${formatSeed(r.seed)}.svg`;
  writeFileSync(join(dir, name), renderSvg(r.doc));
  console.log(`${name}  score ${r.score.total.toFixed(3)}`);
});
console.log(`${ranked.length} generated, ${failed} failed; top ${k} in out/batch`);
