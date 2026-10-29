/** Render posters to SVG and PNG. Usage: npm run render -- <outdir> [seed ...] */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { SAMPLE_BRIEF } from "../src/briefs.js";
import { parseSeed } from "../src/core/prng.js";
import { generate } from "../src/generate.js";
import { loadGrammar } from "../src/grammar/registry.js";
import { loadContext } from "../src/node.js";
import { renderSvg } from "../src/render-svg/svg.js";

const [out = "out", ...seeds] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const ctx = await loadContext();
for (const s of seeds.length ? seeds : ["7f3a-9c21-0e48"]) {
  const { doc } = generate(loadGrammar("poster-grid@1"), parseSeed(s), SAMPLE_BRIEF, ctx);
  const svg = renderSvg(doc, { guides: process.env.GUIDES === "1" });
  writeFileSync(join(out, `${doc.provenance.seed}.svg`), svg);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 900 } }).render().asPng();
  writeFileSync(join(out, `${doc.provenance.seed}.png`), png);
  console.log(join(out, `${doc.provenance.seed}.png`));
}
