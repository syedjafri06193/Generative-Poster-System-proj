/**
 * Conformance corpus (§16.3): edge-case documents written as PDF/X-4 and
 * checked by two independent readers — qpdf (structure) and
 * tools/pdfx_check.py (PDF/X-4 rules, via pikepdf). veraPDF is the reference
 * validator for PDF/A and does not validate PDF/X; a certified PDF/X check
 * (callas pdfToolbox, Acrobat Preflight) is the final gate before press — see
 * 1—Documentation/v1/print-spec.md.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { paint } from "../../src/color/gamut.js";
import { pt } from "../../src/core/units.js";
import { SAMPLE_BRIEF } from "../../src/briefs.js";
import { generate } from "../../src/generate.js";
import { loadGrammar } from "../../src/grammar/registry.js";
import { pathBounds, rectPath, type PosterDocument } from "../../src/model/document.js";
import { ROOT } from "../../src/node.js";
import { preflight } from "../../src/render-pdf/preflight.js";
import { writePdfX4 } from "../../src/render-pdf/writer.js";
import { seedCard } from "../../src/stretch/seedcard.js";
import { tile } from "../../src/stretch/tiling.js";
import { PAPER } from "../../src/core/units.js";
import { context } from "../helpers.js";

const OUT = join(ROOT, "out/conformance");
const icc = new Uint8Array(readFileSync(join(ROOT, "profiles/FOGRA39L_coated.icc")));
const hasPikepdf = spawnSync("python3", ["-c", "import pikepdf"]).status === 0;
const hasQpdf = spawnSync("qpdf", ["--version"]).status === 0;

async function corpus(): Promise<Record<string, PosterDocument>> {
  const ctx = await context();
  const base = loadGrammar("poster-grid@1");
  const one = generate(base, 0x7f3a9c210e48n, SAMPLE_BRIEF, ctx).doc;
  const docs: Record<string, PosterDocument> = {};

  docs["text-only"] = { ...one, nodes: one.nodes.filter((n) => n.kind === "glyphRun" || n.role === "background") };

  const rich = paint(ctx.profile.richBlack, ctx.press);
  const block = rectPath({ x: one.layout.contentBox.x, y: one.layout.contentBox.y, w: pt(200), h: pt(200) });
  docs["max-tac"] = { ...one, nodes: [...one.nodes, { kind: "shape", id: "rich-black-block", role: "ornament", path: block, fill: rich, bounds: pathBounds(block) }] };

  const rule = rectPath({ x: one.layout.contentBox.x, y: one.layout.contentBox.y + pt(300), w: pt(300), h: 0 });
  docs["min-stroke"] = { ...one, nodes: [...one.nodes, { kind: "shape", id: "hairline-limit", role: "rule", path: rule, stroke: { paint: paint({ c: 0, m: 0, y: 0, k: 100 }, ctx.press), width: ctx.profile.minStroke }, bounds: pathBounds(rule) }] };

  docs["transparency"] = { ...one, nodes: one.nodes.map((n) => (n.kind === "shape" && n.role === "ornament" ? { ...n, opacity: 0.6 } : n)) };

  for (const size of Object.keys(PAPER)) {
    const g = { ...base, canvas: { ...base.canvas, sizes: [size] } };
    // poster-grid@1 doesn't list A4 (too small for its body measure on many
    // seeds), so take the first seed that composes at each size.
    for (let s = 1n; ; s++) {
      try { docs[`size-${size}`] = generate(g, s, SAMPLE_BRIEF, ctx).doc; break; } catch (e) { if (s > 50n) throw e; }
    }
  }
  docs["seed-card"] = seedCard(one, ctx);
  docs["tile-2-2"] = tile(one, { cols: 2, rows: 2, overlap: pt(36) })[3]!.doc;
  return docs;
}

describe("PDF/X-4 conformance corpus", async () => {
  const ctx = await context();
  const docs = await corpus();
  mkdirSync(OUT, { recursive: true });

  test.each(Object.keys(docs))("%s", (name) => {
    const doc = docs[name]!;
    const pf = preflight(doc, ctx.profile);
    expect(pf.issues.filter((i) => i.severity === "error" && i.code !== "OUTSIDE_SAFETY")).toEqual([]);
    const file = join(OUT, `${name}.pdf`);
    writeFileSync(file, writePdfX4(doc, { icc, profile: ctx.profile, title: name }));
    if (hasQpdf) expect(spawnSync("qpdf", ["--check", file]).status).toBe(0);
    if (hasPikepdf) execFileSync("python3", [join(ROOT, "tools/pdfx_check.py"), file]);
  });
});
