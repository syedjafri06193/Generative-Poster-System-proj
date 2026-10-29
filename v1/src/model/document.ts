/**
 * The document model (design guide §5). The layout engine produces this; the
 * SVG and PDF renderers only draw it. Everything here is already decided:
 * absolute integer coordinates (1/1000 pt, y down from the top-left of the
 * trim box), positioned glyphs with outlines, and colour resolved to CMYK.
 *
 * If a renderer needs to decide anything about position, size, line breaking
 * or colour, the architecture is wrong.
 */
import type { Rect, Size } from "../core/units.js";

export interface CMYK {
  /** Percentages, 0-100. */
  c: number;
  m: number;
  y: number;
  k: number;
}

export interface Paint {
  cmyk: CMYK;
  /** sRGB soft-proof of `cmyk` through the press profile, for screen preview. */
  proofRgb: [number, number, number];
  spot?: { name: string; tint: number };
  overprint?: boolean;
}

export type PathCommand =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: "Z" };

export interface ShapeNode {
  kind: "shape";
  id: string;
  path: PathCommand[];
  fill?: Paint;
  stroke?: { paint: Paint; width: number };
  opacity?: number;
  /** Background shapes may extend into the bleed; content must not. */
  role: "background" | "ornament" | "rule";
  bounds: Rect;
}

export type TextRole = "display" | "body" | "caption";

export interface PositionedGlyph {
  glyphId: number;
  /** Pen position of the glyph origin on the baseline. */
  x: number;
  y: number;
}

export interface GlyphRunNode {
  kind: "glyphRun";
  id: string;
  fontRef: string;
  sizeUnits: number;
  glyphs: PositionedGlyph[];
  /** Outlines in absolute coordinates, resolved at layout time. */
  outlines: PathCommand[];
  fill: Paint;
  role: TextRole;
  /** Source text, kept for PDF ActualText and searchability. */
  text: string;
  /** Baseline y, for baseline-grid scoring. */
  baseline: number;
  /** Ink-independent layout box: advance width × (ascender..descender). */
  bounds: Rect;
}

export type Node = ShapeNode | GlyphRunNode;

export interface Provenance {
  seed: string;
  generatorVersion: string;
  grammarVersion: string;
  fontSetHash: string;
  paletteSetHash: string;
  /** Series family seed, when the poster is one of a set (§17). */
  family?: string;
}

export interface LayoutFacts {
  /** Origin and step of the baseline grid. */
  baselineOrigin: number;
  baselineUnit: number;
  columns: number;
  gutter: number;
  margins: { top: number; inner: number; outer: number; bottom: number };
  contentBox: Rect;
  /** Distinct type sizes in hierarchy order, largest first. */
  typeSizes: number[];
  paletteOklch: Array<{ l: number; c: number; h: number }>;
  bodyMeasure: number;
}

export interface PosterDocument {
  provenance: Provenance;
  trim: Size;
  bleed: number;
  safety: number;
  colorSpace: "cmyk";
  outputIntent: string;
  nodes: Node[];
  layout: LayoutFacts;
}

/** Union of all node bounds that are content (everything but backgrounds). */
export function contentNodes(doc: PosterDocument): Node[] {
  return doc.nodes.filter((n) => n.kind === "glyphRun" || n.role !== "background");
}

export function textNodes(doc: PosterDocument): GlyphRunNode[] {
  return doc.nodes.filter((n): n is GlyphRunNode => n.kind === "glyphRun");
}

export function trimRect(doc: PosterDocument): Rect {
  return { x: 0, y: 0, w: doc.trim.w, h: doc.trim.h };
}

export function bleedRect(doc: PosterDocument): Rect {
  return { x: -doc.bleed, y: -doc.bleed, w: doc.trim.w + 2 * doc.bleed, h: doc.trim.h + 2 * doc.bleed };
}

export function pathBounds(path: PathCommand[]): Rect {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };
  for (const c of path) {
    if (c.op === "M" || c.op === "L") add(c.x, c.y);
    else if (c.op === "C") {
      add(c.x1, c.y1);
      add(c.x2, c.y2);
      add(c.x, c.y);
    }
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectPath(r: Rect): PathCommand[] {
  return [
    { op: "M", x: r.x, y: r.y },
    { op: "L", x: r.x + r.w, y: r.y },
    { op: "L", x: r.x + r.w, y: r.y + r.h },
    { op: "L", x: r.x, y: r.y + r.h },
    { op: "Z" },
  ];
}
