/**
 * Hard constraints (design guide §6.2). These are inviolable: the generator
 * resamples rather than emit a violation. Soft preferences live in score/.
 */
import { inset, rectInside, rectsOverlap } from "../core/units.js";
import { contrastRatio, labToOklch } from "../color/oklch.js";
import type { PressColor } from "../color/icc.js";
import { textNodes, trimRect, type GlyphRunNode, type PosterDocument } from "../model/document.js";
import { tac, type PressProfile } from "../model/press.js";

export interface ConstraintContext {
  press: PressColor;
  profile: PressProfile;
  measureRange: [number, number];
}

export interface Constraint {
  id: string;
  description: string;
  check(doc: PosterDocument, ctx: ConstraintContext): string | null;
}

/** Printed colour of a node, as the press will reproduce it. */
function printed(doc: PosterDocument, ctx: ConstraintContext, cmyk: { c: number; m: number; y: number; k: number }) {
  return labToOklch(ctx.press.toLab(cmyk));
}

function backgroundUnder(doc: PosterDocument, run: GlyphRunNode) {
  // Topmost shape below the text whose bounds contain the text box.
  const idx = doc.nodes.indexOf(run);
  for (let i = idx - 1; i >= 0; i--) {
    const n = doc.nodes[i]!;
    if (n.kind === "shape" && n.fill && rectsOverlap(n.bounds, run.bounds)) return n.fill.cmyk;
  }
  return null;
}

export const CONSTRAINTS: Constraint[] = [
  {
    id: "measure",
    description: "Body text measure is within the grammar's range (45–75 characters by default)",
    check: (d, c) => {
      const m = d.layout.bodyMeasure;
      return m >= c.measureRange[0] && m <= c.measureRange[1] ? null : `body measure ${m.toFixed(1)} outside ${c.measureRange.join("–")}`;
    },
  },
  {
    id: "safety-margin",
    description: "All text lies inside the safety margin",
    check: (d, c) => {
      const safe = inset(trimRect(d), c.profile.safetyMargin);
      const out = textNodes(d).filter((t) => !rectInside(t.bounds, safe));
      return out.length ? `${out.length} text run(s) outside the safety margin` : null;
    },
  },
  {
    id: "min-stroke",
    description: "No stroke is thinner than the press minimum",
    check: (d, c) => {
      const thin = d.nodes.filter((n) => n.kind === "shape" && n.stroke && n.stroke.width < c.profile.minStroke);
      return thin.length ? `${thin.length} stroke(s) below the press minimum` : null;
    },
  },
  {
    id: "tac",
    description: "No colour exceeds the press TAC limit",
    check: (d, c) => {
      for (const n of d.nodes) {
        const paints = n.kind === "shape" ? [n.fill, n.stroke?.paint] : [n.fill];
        for (const p of paints) if (p && tac(p.cmyk) > c.profile.tacLimit) return `TAC ${tac(p.cmyk)}% exceeds ${c.profile.tacLimit}%`;
      }
      return null;
    },
  },
  {
    id: "no-collision",
    description: "No two text runs overlap, and no text overlaps an ornament",
    check: (d) => {
      const texts = textNodes(d);
      for (let i = 0; i < texts.length; i++)
        for (let j = i + 1; j < texts.length; j++) if (rectsOverlap(texts[i]!.bounds, texts[j]!.bounds)) return `text "${texts[i]!.text.slice(0, 20)}" overlaps "${texts[j]!.text.slice(0, 20)}"`;
      const shapes = d.nodes.filter((n) => n.kind === "shape" && n.role !== "background");
      for (const t of texts) for (const s of shapes) if (rectsOverlap(t.bounds, s.bounds)) return `text "${t.text.slice(0, 20)}" overlaps ornament ${s.id}`;
      return null;
    },
  },
  {
    id: "contrast",
    description: "Text contrast against what is printed under it: ≥4.5:1 for body and captions, ≥3:1 for display",
    check: (d, c) => {
      for (const t of textNodes(d)) {
        const under = backgroundUnder(d, t);
        if (!under) continue;
        const ratio = contrastRatio(printed(d, c, t.fill.cmyk), printed(d, c, under));
        const need = t.role === "display" ? 3 : 4.5;
        if (ratio < need) return `${t.role} text "${t.text.slice(0, 20)}" contrast ${ratio.toFixed(2)} < ${need}`;
      }
      return null;
    },
  },
  {
    id: "baseline-grid",
    description: "Every text baseline lies on the baseline grid",
    check: (d) => {
      const { baselineOrigin: o, baselineUnit: u } = d.layout;
      const off = textNodes(d).filter((t) => t.role !== "caption" || !t.id.startsWith("provenance")).filter((t) => (t.baseline - o) % u !== 0);
      return off.length ? `${off.length} baseline(s) off the grid` : null;
    },
  },
  {
    id: "inside-media",
    description: "All geometry lies within the bleed box",
    check: (d) => {
      const bleed = { x: -d.bleed, y: -d.bleed, w: d.trim.w + 2 * d.bleed, h: d.trim.h + 2 * d.bleed };
      const out = d.nodes.filter((n) => !rectInside(n.bounds, bleed));
      return out.length ? `${out.length} node(s) extend beyond the bleed box` : null;
    },
  },
];

export function violations(doc: PosterDocument, ids: string[], ctx: ConstraintContext): Array<{ id: string; message: string }> {
  const out: Array<{ id: string; message: string }> = [];
  for (const c of CONSTRAINTS) {
    if (!ids.includes(c.id)) continue;
    const msg = c.check(doc, ctx);
    if (msg) out.push({ id: c.id, message: msg });
  }
  return out;
}
