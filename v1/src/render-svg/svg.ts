/**
 * SVG renderer (design guide §11.1). A dumb renderer: it draws the document
 * model and makes no layout or colour decisions. SVG is the screen format —
 * it has no CMYK, output intent or bleed box — so colours are the soft-proof
 * sRGB values, with the CMYK preserved in data attributes for round trips.
 */
import { toPt } from "../core/units.js";
import type { Node, Paint, PathCommand, PosterDocument } from "../model/document.js";
import { tac } from "../model/press.js";

export interface SvgOptions {
  /** Draw trim, bleed and safety guides. */
  guides?: boolean;
  /** Show ink coverage (TAC) as a heat map instead of colour (§11.6). */
  inkCoverage?: { limit: number };
  /** Include the bleed area (default true). */
  bleed?: boolean;
}

const n = (u: number) => {
  const v = toPt(u);
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
};

export function pathData(path: PathCommand[]): string {
  let d = "";
  for (const c of path) {
    if (c.op === "M" || c.op === "L") d += `${c.op}${n(c.x)} ${n(c.y)}`;
    else if (c.op === "C") d += `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
    else d += "Z";
  }
  return d;
}

const hex = (rgb: [number, number, number]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

/** Heat map: blue (0%) → green → yellow → red at the limit → magenta above it. */
function coverageColor(t: number, limit: number): string {
  if (t > limit) return "#ff00ff";
  const x = t / limit;
  const stops: Array<[number, [number, number, number]]> = [
    [0, [40, 60, 200]],
    [0.5, [60, 190, 90]],
    [0.8, [240, 220, 50]],
    [1, [230, 40, 30]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [x0, c0] = stops[i - 1]!;
    const [x1, c1] = stops[i]!;
    if (x <= x1) {
      const f = (x - x0) / (x1 - x0);
      return hex([0, 1, 2].map((k) => Math.round(c0[k]! + (c1[k]! - c0[k]!) * f)) as [number, number, number]);
    }
  }
  return hex(stops[stops.length - 1]![1]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function paintAttrs(p: Paint, opts: SvgOptions): string {
  const color = opts.inkCoverage ? coverageColor(tac(p.cmyk), opts.inkCoverage.limit) : hex(p.proofRgb);
  const { c, m, y, k } = p.cmyk;
  return `fill="${color}" data-cmyk="${c} ${m} ${y} ${k}"`;
}

function nodeSvg(node: Node, opts: SvgOptions): string {
  if (node.kind === "shape") {
    const fill = node.fill ? paintAttrs(node.fill, opts) : 'fill="none"';
    const stroke = node.stroke ? ` stroke="${hex(node.stroke.paint.proofRgb)}" stroke-width="${n(node.stroke.width)}"` : "";
    const op = node.opacity !== undefined && node.opacity < 1 ? ` opacity="${node.opacity}"` : "";
    return `<path id="${esc(node.id)}" class="${node.role}" d="${pathData(node.path)}" ${fill}${stroke}${op}/>`;
  }
  return `<path id="${esc(node.id)}" class="text ${node.role}" role="img" aria-label="${esc(node.text)}" d="${pathData(node.outlines)}" ${paintAttrs(node.fill, opts)}/>`;
}

export function renderSvg(doc: PosterDocument, opts: SvgOptions = {}): string {
  const b = opts.bleed === false ? 0 : doc.bleed;
  const x = -b,
    y = -b,
    w = doc.trim.w + 2 * b,
    h = doc.trim.h + 2 * b;
  const p = doc.provenance;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" width="${n(w)}pt" height="${n(h)}pt" data-seed="${esc(p.seed)}" data-generator="${esc(p.generatorVersion)}" data-grammar="${esc(p.grammarVersion)}">`,
    `<title>${esc(p.seed)} · v${esc(p.generatorVersion)} · ${esc(p.grammarVersion)}</title>`,
  ];
  if (opts.bleed === false) parts.push(`<clipPath id="trim"><rect x="0" y="0" width="${n(doc.trim.w)}" height="${n(doc.trim.h)}"/></clipPath><g clip-path="url(#trim)">`);
  for (const node of doc.nodes) parts.push(nodeSvg(node, opts));
  if (opts.bleed === false) parts.push("</g>");
  if (opts.guides) {
    const s = doc.safety;
    parts.push(
      `<g class="guides" fill="none" stroke-width="0.5">`,
      `<rect x="0" y="0" width="${n(doc.trim.w)}" height="${n(doc.trim.h)}" stroke="#00b0f0"/>`,
      `<rect x="${n(s)}" y="${n(s)}" width="${n(doc.trim.w - 2 * s)}" height="${n(doc.trim.h - 2 * s)}" stroke="#f05090" stroke-dasharray="4 3"/>`,
      `</g>`,
    );
  }
  parts.push("</svg>");
  return parts.join("\n");
}
