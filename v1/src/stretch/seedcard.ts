/**
 * Physical seed cards (stretch goal §17): the provenance tuple printed as a QR
 * code on an 85 × 55 mm card, so a printed poster can carry its own
 * regeneration key. The card is an ordinary PosterDocument (100K only, no
 * rich black in small type), so it goes through the same PDF/X-4 writer.
 *
 * Payload: "poster:<seed>;<generatorVersion>;<grammar>[;family=<seed>]" —
 * parseSeedPayload() reverses it.
 */
import qrcode from "qrcode-generator";
import { mm, pt } from "../core/units.js";
import { paint, textPaint } from "../color/gamut.js";
import type { ComposeContext } from "../layout/compose.js";
import { pathBounds, rectPath, type GlyphRunNode, type PosterDocument, type Provenance, type ShapeNode } from "../model/document.js";
import { PURE_BLACK } from "../model/press.js";
import { setLine } from "../type/typeset.js";

export function seedPayload(p: Provenance): string {
  return `poster:${p.seed};${p.generatorVersion};${p.grammarVersion}${p.family ? `;family=${p.family}` : ""}`;
}

export function parseSeedPayload(s: string): { seed: string; generatorVersion: string; grammar: string; family?: string } {
  const m = /^poster:([0-9a-f-]+);([^;]+);([^;]+)(?:;family=([0-9a-f-]+))?$/.exec(s);
  if (!m) throw new Error("not a poster seed payload");
  return { seed: m[1]!, generatorVersion: m[2]!, grammar: m[3]!, ...(m[4] ? { family: m[4] } : {}) };
}

/** QR modules as a boolean matrix (error correction M, smallest version that fits). */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

export function seedCard(source: PosterDocument, ctx: ComposeContext, fontRef = "inter-medium"): PosterDocument {
  const W = mm(85), H = mm(55), margin = mm(5);
  const black = paint(PURE_BLACK, ctx.press);
  const white = paint({ c: 0, m: 0, y: 0, k: 0 }, ctx.press);
  const payload = seedPayload(source.provenance);
  const matrix = qrMatrix(payload);
  // Integer module size; quiet zone of 4 modules is inside the card margin.
  const side = H - 2 * margin;
  const mod = Math.floor(side / (matrix.length + 8));
  const q = margin + 4 * mod;
  const nodes: (ShapeNode | GlyphRunNode)[] = [
    { kind: "shape", id: "card-bg", role: "background", path: rectPath({ x: -ctx.profile.bleed, y: -ctx.profile.bleed, w: W + 2 * ctx.profile.bleed, h: H + 2 * ctx.profile.bleed }), fill: white, bounds: { x: -ctx.profile.bleed, y: -ctx.profile.bleed, w: W + 2 * ctx.profile.bleed, h: H + 2 * ctx.profile.bleed } },
  ];
  const path = matrix.flatMap((row, r) => row.flatMap((dark, c) => (dark ? rectPath({ x: q + c * mod, y: q + r * mod, w: mod, h: mod }) : [])));
  nodes.push({ kind: "shape", id: "qr", role: "ornament", path, fill: black, bounds: pathBounds(path) });

  const font = ctx.fonts.get(fontRef);
  const tx = q + matrix.length * mod + 4 * mod;
  const lines: [string, number][] = [
    [source.provenance.seed, pt(14)],
    [`generator v${source.provenance.generatorVersion}`, pt(7)],
    [source.provenance.grammarVersion, pt(7)],
    ...(source.provenance.family ? ([[`series ${source.provenance.family}`, pt(7)]] as [string, number][]) : []),
    [`fonts ${source.provenance.fontSetHash.slice(0, 12)}`, pt(7)],
  ];
  let y = q + pt(14);
  lines.forEach(([text, size], i) => {
    const set = setLine(font, text, size, tx, y, { hang: false });
    nodes.push({ kind: "glyphRun", id: `card-${i}`, fontRef, sizeUnits: size, glyphs: set.glyphs, outlines: set.outlines, fill: textPaint({ l: 0.1, c: 0, h: 0 }, "caption", size, ctx.press, ctx.profile), role: "caption", text, baseline: y, bounds: pathBounds(set.outlines) });
    y += i === 0 ? pt(14) : pt(10);
  });
  return { ...source, trim: { w: W, h: H }, nodes, provenance: { ...source.provenance } };
}
