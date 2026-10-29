/** Generate a poster and export SVG + PDF/X-4. Usage: npm run export -- <outdir> [seed ...] */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_BRIEF } from "../src/briefs.js";
import { parseSeed } from "../src/core/prng.js";
import { generate } from "../src/generate.js";
import { loadGrammar } from "../src/grammar/registry.js";
import { loadContext, ROOT } from "../src/node.js";
import { preflight } from "../src/render-pdf/preflight.js";
import { writePdfX4 } from "../src/render-pdf/writer.js";
import { renderSvg } from "../src/render-svg/svg.js";

const [out = "out", ...seeds] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const ctx = await loadContext();
const icc = new Uint8Array(readFileSync(join(ROOT, "profiles", ctx.profile.iccFile)));
let failed = false;
for (const s of seeds.length ? seeds : ["7f3a-9c21-0e48"]) {
  const { doc } = generate(loadGrammar("poster-grid@1"), parseSeed(s), SAMPLE_BRIEF, ctx);
  const report = preflight(doc, ctx.profile);
  for (const i of report.issues) console.log(`  ${i.severity} ${i.code}: ${i.message}`);
  if (!report.ok) {
    failed = true;
    console.error(`${doc.provenance.seed}: preflight failed; not exporting`);
    continue;
  }
  writeFileSync(join(out, `${doc.provenance.seed}.svg`), renderSvg(doc));
  writeFileSync(join(out, `${doc.provenance.seed}.pdf`), writePdfX4(doc, { icc, profile: ctx.profile, title: SAMPLE_BRIEF.headline }));
  console.log(`${doc.provenance.seed}: TAC max ${report.maxTAC}% -> ${join(out, doc.provenance.seed)}.{svg,pdf}`);
}
process.exit(failed ? 1 : 0);
