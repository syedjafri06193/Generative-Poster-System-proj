/**
 * Preflight (design guide §11.5, §15.3): the fast checks print shops reject
 * files over, run on the document model before the PDF is written. Formal
 * structural validation of the written file is a separate step
 * (tools/pdfx_check.py), because the two catch different things.
 */
import { inset, rectInside, toMm } from "../core/units.js";
import { bleedRect, textNodes, trimRect, type PosterDocument } from "../model/document.js";
import { isRichBlack, tac, type PressProfile } from "../model/press.js";

export interface PreflightIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface PreflightReport {
  boxesPresent: boolean;
  boxNesting: boolean;
  colorSpacesOnly: string[];
  outputIntentPresent: boolean;
  maxTAC: number;
  minStrokeWidth: number | null;
  issues: PreflightIssue[];
  ok: boolean;
}

export function maxTAC(doc: PosterDocument): number {
  let max = 0;
  for (const n of doc.nodes) {
    const paints = n.kind === "shape" ? [n.fill, n.stroke?.paint] : [n.fill];
    for (const p of paints) if (p) max = Math.max(max, tac(p.cmyk));
  }
  return Math.round(max * 10) / 10;
}

export function preflight(doc: PosterDocument, press: PressProfile): PreflightReport {
  const issues: PreflightIssue[] = [];

  const t = maxTAC(doc);
  if (t > press.tacLimit) issues.push({ severity: "error", code: "TAC_EXCEEDED", message: `Max TAC ${t}% exceeds limit ${press.tacLimit}%` });

  const strokes = doc.nodes.flatMap((n) => (n.kind === "shape" && n.stroke ? [n.stroke.width] : []));
  const minStroke = strokes.length ? Math.min(...strokes) : null;
  const thin = strokes.filter((w) => w < press.minStroke).length;
  if (thin) issues.push({ severity: "error", code: "HAIRLINE", message: `${thin} stroke(s) below ${press.minStroke / 1000}pt` });

  for (const n of textNodes(doc)) {
    if (n.sizeUnits < press.smallTextLimit && isRichBlack(n.fill.cmyk)) {
      issues.push({ severity: "error", code: "RICH_BLACK_SMALL_TEXT", message: `"${n.text.slice(0, 24)}" is small text in rich black — must be 100K only (registration risk)` });
    }
    const inks = [n.fill.cmyk.c, n.fill.cmyk.m, n.fill.cmyk.y, n.fill.cmyk.k].filter((v) => v > 0).length;
    if (n.sizeUnits < press.minReversedText && inks > 1) {
      issues.push({ severity: "error", code: "SMALL_MULTI_INK_TEXT", message: `"${n.text.slice(0, 24)}" is below ${press.minReversedText / 1000}pt and uses ${inks} inks` });
    }
  }

  const safe = inset(trimRect(doc), press.safetyMargin);
  const outside = textNodes(doc).filter((n) => !rectInside(n.bounds, safe));
  if (outside.length) issues.push({ severity: "warning", code: "OUTSIDE_SAFETY", message: `${outside.length} text run(s) outside the ${toMm(press.safetyMargin).toFixed(0)} mm safety margin may be trimmed` });

  // Anything touching the trim edge must extend into the bleed (§3.2).
  const bleed = bleedRect(doc);
  const trim = trimRect(doc);
  for (const n of doc.nodes) {
    if (n.kind !== "shape") continue;
    const b = n.bounds;
    const touches = b.x <= trim.x || b.y <= trim.y || b.x + b.w >= trim.w || b.y + b.h >= trim.h;
    const reachesBleed = b.x <= bleed.x || b.y <= bleed.y || b.x + b.w >= bleed.x + bleed.w || b.y + b.h >= bleed.y + bleed.h;
    if (touches && !reachesBleed) issues.push({ severity: "error", code: "NO_BLEED", message: `${n.id} touches the trim edge but does not extend into the bleed` });
    if (!rectInside(b, bleed)) issues.push({ severity: "error", code: "BEYOND_BLEED", message: `${n.id} extends beyond the bleed box` });
  }

  const boxNesting = doc.bleed >= 0;
  const report: PreflightReport = {
    boxesPresent: true, // the writer always emits TrimBox and BleedBox
    boxNesting,
    colorSpacesOnly: ["DeviceCMYK"],
    outputIntentPresent: true,
    maxTAC: t,
    minStrokeWidth: minStroke,
    issues,
    ok: !issues.some((i) => i.severity === "error"),
  };
  return report;
}
