/**
 * CSS Paged Media output (stretch goal §17): a third renderer for web-to-print
 * engines (Prince, WeasyPrint, Paged.js, browser print). The page box is the
 * trim plus bleed, `marks: crop` asks the engine for crop marks, and the
 * artwork is the same SVG the screen renderer draws, so the three renderers
 * cannot drift apart.
 *
 * CSS cannot carry an output intent or DeviceCMYK, so this is for proofs and
 * web-to-print pipelines that convert downstream; press files remain the
 * PDF/X-4 writer's job.
 */
import { toMm } from "../core/units.js";
import type { PosterDocument } from "../model/document.js";
import { renderSvg } from "../render-svg/svg.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function renderPagedHtml(docs: PosterDocument[], title = "Posters"): string {
  if (docs.length === 0) throw new Error("no documents");
  const d = docs[0]!;
  const w = toMm(d.trim.w).toFixed(2), h = toMm(d.trim.h).toFixed(2), bleed = toMm(d.bleed).toFixed(2);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: ${w}mm ${h}mm; margin: 0; bleed: ${bleed}mm; marks: crop; }
html, body { margin: 0; padding: 0; }
.poster { width: ${w}mm; height: ${h}mm; break-after: page; overflow: visible; position: relative; }
.poster > svg { position: absolute; left: -${bleed}mm; top: -${bleed}mm; width: calc(${w}mm + ${2 * Number(bleed)}mm); height: calc(${h}mm + ${2 * Number(bleed)}mm); }
@media screen { body { background: #888; } .poster { margin: 20mm auto; box-shadow: 0 0 0 ${bleed}mm rgba(255,0,0,.15); } }
</style></head><body>
${docs.map((doc) => `<section class="poster" data-seed="${esc(doc.provenance.seed)}">${renderSvg(doc, { bleed: true })}</section>`).join("\n")}
</body></html>
`;
}
