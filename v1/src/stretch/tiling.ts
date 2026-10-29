/**
 * Large-format tiling (stretch goal §17): split a poster into printable panels
 * with overlap, for billboards and wall graphics. Each tile is an ordinary
 * PosterDocument whose trim is the panel (plus overlap) and whose nodes are
 * translated, so every renderer — SVG, PDF/X-4 — works on it unchanged.
 * Paths crossing a panel edge are kept whole and clipped by the panel's
 * MediaBox (= its bleed box), which every RIP honours; node bounds are
 * intersected with that box so preflight measures what will actually print.
 */
import { rectsOverlap, type Rect } from "../core/units.js";
import type { Node, PathCommand, PosterDocument } from "../model/document.js";

export interface TileOptions {
  cols: number;
  rows: number;
  /** Overlap between neighbouring panels, in units (1/1000 pt). */
  overlap: number;
}

export interface Tile {
  col: number;
  row: number;
  /** The panel's area in the source poster's trim coordinates. */
  area: Rect;
  doc: PosterDocument;
}

const shiftPath = (p: PathCommand[], dx: number, dy: number): PathCommand[] =>
  p.map((c) => {
    switch (c.op) {
      case "M": case "L": return { ...c, x: c.x + dx, y: c.y + dy };
      case "C": return { ...c, x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy, x: c.x + dx, y: c.y + dy };
      default: return c;
    }
  });

function shift(n: Node, dx: number, dy: number): Node {
  const bounds = { ...n.bounds, x: n.bounds.x + dx, y: n.bounds.y + dy };
  if (n.kind === "shape") return { ...n, path: shiftPath(n.path, dx, dy), bounds };
  return {
    ...n,
    outlines: shiftPath(n.outlines, dx, dy),
    glyphs: n.glyphs.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
    baseline: n.baseline + dy,
    bounds,
  };
}

function intersect(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export function tile(doc: PosterDocument, opts: TileOptions): Tile[] {
  if (opts.cols < 1 || opts.rows < 1) throw new RangeError("cols and rows must be at least 1");
  const tw = Math.ceil(doc.trim.w / opts.cols), th = Math.ceil(doc.trim.h / opts.rows);
  const tiles: Tile[] = [];
  for (let row = 0; row < opts.rows; row++)
    for (let col = 0; col < opts.cols; col++) {
      // Each panel carries the overlap on its right and bottom edges, except the last.
      const x = col * tw, y = row * th;
      const w = Math.min(doc.trim.w - x, tw + (col < opts.cols - 1 ? opts.overlap : 0));
      const h = Math.min(doc.trim.h - y, th + (row < opts.rows - 1 ? opts.overlap : 0));
      const area = { x, y, w, h };
      // Keep anything that reaches into this panel or its bleed.
      const reach = { x: x - doc.bleed, y: y - doc.bleed, w: w + 2 * doc.bleed, h: h + 2 * doc.bleed };
      const local = { x: -doc.bleed, y: -doc.bleed, w: w + 2 * doc.bleed, h: h + 2 * doc.bleed };
      const nodes = doc.nodes.filter((n) => rectsOverlap(n.bounds, reach)).map((n) => {
        const m = shift(n, -x, -y);
        return { ...m, bounds: intersect(m.bounds, local) };
      });
      tiles.push({
        col, row, area,
        doc: { ...doc, trim: { w, h }, nodes, provenance: { ...doc.provenance, seed: `${doc.provenance.seed} tile ${col + 1},${row + 1}` } },
      });
    }
  return tiles;
}
