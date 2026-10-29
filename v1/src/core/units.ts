/**
 * Internal units (design guide §5.3): integers of 1/1000 pt. All geometry in
 * the document model is integer, so it is exact and reproducible; conversion
 * to points (PDF) or user units (SVG) happens only at emission.
 */
export const UNITS_PER_PT = 1000;
export const PT_PER_MM = 72 / 25.4;

/** Millimetres to internal units. */
export const mm = (v: number): number => Math.round(v * PT_PER_MM * UNITS_PER_PT);
/** Points to internal units. */
export const pt = (v: number): number => Math.round(v * UNITS_PER_PT);
/** Inches to internal units. */
export const inch = (v: number): number => Math.round(v * 72 * UNITS_PER_PT);

/** Internal units to points (for PDF). */
export const toPt = (u: number): number => u / UNITS_PER_PT;
/** Internal units to millimetres (for reports). */
export const toMm = (u: number): number => u / UNITS_PER_PT / PT_PER_MM;

/** Round to the nearest integer unit; use wherever a computed value enters the model. */
export const unit = (v: number): number => Math.round(v);

export interface Size {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PAPER: Record<string, Size> = {
  A1: { w: mm(594), h: mm(841) },
  A2: { w: mm(420), h: mm(594) },
  A3: { w: mm(297), h: mm(420) },
  A4: { w: mm(210), h: mm(297) },
  "18x24in": { w: inch(18), h: inch(24) },
  "11x17in": { w: inch(11), h: inch(17) },
};

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function rectInside(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function inset(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d };
}
