import { Resvg } from "@resvg/resvg-js";
import jsQRModule from "jsqr";
// jsqr ships CJS with an `export default` typing; normalise both shapes.
const jsQR = ((jsQRModule as unknown as { default?: unknown }).default ?? jsQRModule) as unknown as typeof import("jsqr").default;
import { describe, expect, test } from "vitest";
import { SAMPLE_BRIEF } from "../../src/briefs.js";
import { mm } from "../../src/core/units.js";
import { generate, hashDocument } from "../../src/generate.js";
import { loadGrammar } from "../../src/grammar/registry.js";
import { preflight } from "../../src/render-pdf/preflight.js";
import { renderSvg } from "../../src/render-svg/svg.js";
import { renderPagedHtml } from "../../src/stretch/paged-media.js";
import { decompose, RISO_INKS, separate } from "../../src/stretch/riso.js";
import { parseSeedPayload, seedCard, seedPayload } from "../../src/stretch/seedcard.js";
import { generateSeries } from "../../src/stretch/series.js";
import { tile } from "../../src/stretch/tiling.js";
import { context } from "../helpers.js";

const g = loadGrammar("poster-grid@1");
const briefs = ["Night One", "Night Two", "Night Three", "Night Four"].map((headline) => ({ ...SAMPLE_BRIEF, headline }));

describe("series generation", () => {
  test("members share canvas, grid and palette, differ in layout, and reproduce", async () => {
    const ctx = await context();
    const a = generateSeries(g, 0xabcdef123456n, briefs, ctx);
    const b = generateSeries(g, 0xabcdef123456n, briefs, ctx);
    expect(a.map(hashDocument)).toEqual(b.map(hashDocument));
    for (const d of a) {
      expect(d.trim).toEqual(a[0]!.trim);
      expect(d.layout.columns).toBe(a[0]!.layout.columns);
      expect(d.layout.paletteOklch).toEqual(a[0]!.layout.paletteOklch);
      expect(d.provenance.family).toBe("abcd-ef12-3456");
    }
    expect(new Set(a.map(hashDocument)).size).toBe(a.length);
  });
});

describe("large-format tiling", () => {
  test("panels cover the poster with overlap and each is a printable document", async () => {
    const ctx = await context();
    const { doc } = generate(g, 0x7f3a9c210e48n, SAMPLE_BRIEF, ctx);
    const tiles = tile(doc, { cols: 3, rows: 2, overlap: mm(20) });
    expect(tiles).toHaveLength(6);
    expect(tiles.filter((t) => t.row === 0).reduce((a, t) => a + t.area.w, 0)).toBe(doc.trim.w + 2 * mm(20));
    expect(Math.max(...tiles.map((t) => t.area.x + t.area.w))).toBe(doc.trim.w);
    for (const t of tiles) {
      expect(t.doc.nodes.some((n) => n.kind === "shape" && n.role === "background")).toBe(true);
      expect(preflight(t.doc, ctx.profile).issues.filter((i) => i.code === "TAC_EXCEEDED" || i.code === "HAIRLINE")).toEqual([]);
    }
  });
});

describe("physical seed card", () => {
  test("payload round-trips", () => {
    const p = { seed: "7f3a-9c21-0e48", generatorVersion: "1.0.0", grammarVersion: "poster-grid@1", fontSetHash: "x", paletteSetHash: "y", family: "0000-0000-0001" };
    expect(parseSeedPayload(seedPayload(p))).toEqual({ seed: p.seed, generatorVersion: "1.0.0", grammar: "poster-grid@1", family: p.family });
  });

  test("the printed QR code scans back to the poster's provenance", async () => {
    const ctx = await context();
    const { doc } = generate(g, 0x7f3a9c210e48n, SAMPLE_BRIEF, ctx);
    const card = seedCard(doc, ctx);
    expect(preflight(card, ctx.profile).ok).toBe(true);
    const png = new Resvg(renderSvg(card, { bleed: false }), { fitTo: { mode: "width", value: 1000 } }).render();
    const scanned = jsQR(new Uint8ClampedArray(png.pixels), png.width, png.height);
    expect(scanned?.data).toBe(seedPayload(doc.provenance));
    const back = parseSeedPayload(scanned!.data);
    expect(hashDocument(generate(loadGrammar(back.grammar), BigInt("0x" + back.seed.replace(/-/g, "")), SAMPLE_BRIEF, ctx).doc)).toBe(hashDocument(doc));
  });
});

describe("risograph separations", () => {
  test("an ink's own colour decomposes to 100% of that ink", () => {
    const inks = [RISO_INKS.blue!, RISO_INKS.fluorescentPink!];
    expect(decompose(RISO_INKS.blue!.density, inks)[0]).toBeGreaterThan(0.95);
    expect(decompose([0, 0, 0], inks)).toEqual([0, 0]);
  });
  test("one master per drum", async () => {
    const ctx = await context();
    const { doc } = generate(g, 0x7f3a9c210e48n, SAMPLE_BRIEF, ctx);
    const { layers, proofSvg } = separate(doc, [RISO_INKS.blue!, RISO_INKS.fluorescentPink!, RISO_INKS.black!], ctx.press);
    expect(layers).toHaveLength(3);
    for (const l of layers) expect(l.masterSvg).toMatch(/^<svg/);
    expect(proofSvg(0.8, 3)).toMatch(/mix-blend-mode:multiply/);
  });
});

describe("CSS Paged Media renderer", () => {
  test("page box is the trim with bleed and crop marks", async () => {
    const ctx = await context();
    const docs = generateSeries(g, 1n, briefs.slice(0, 2), ctx);
    const html = renderPagedHtml(docs);
    expect(html).toMatch(/@page \{ size: [\d.]+mm [\d.]+mm; margin: 0; bleed: 3.00mm; marks: crop; \}/);
    expect(html.match(/class="poster"/g)).toHaveLength(2);
  });
});
