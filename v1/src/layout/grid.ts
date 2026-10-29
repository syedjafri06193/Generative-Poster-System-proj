/**
 * Grid systems, proportional margins and the baseline grid (design guide
 * §7.1–§7.4). All values are integer units; leftovers from integer division
 * go to the outer and bottom margins so the grid itself stays exact.
 */
import type { Rect, Size } from "../core/units.js";

export interface Margins {
  top: number;
  inner: number;
  outer: number;
  bottom: number;
}

export interface Grid {
  trim: Size;
  margins: Margins;
  content: Rect;
  columns: number;
  gutter: number;
  columnWidth: number;
  rows: number;
  rowHeight: number;
  rowGutter: number;
  baselineUnit: number;
  /** y of the first baseline. Baselines are baselineOrigin + k·baselineUnit. */
  baselineOrigin: number;
}

/**
 * Margins from the grid unit (§7.2): asymmetric, bottom-heavy for optical
 * centering (§7.4). Each is a whole number of baseline units, so text that
 * starts at the top margin is already on the grid.
 */
export function proportionalMargins(topBaselines: number, baselineUnit: number, minimum: number): Margins {
  const u = baselineUnit;
  let topN = topBaselines;
  while (topN * u < minimum) topN++;
  return {
    top: topN * u,
    inner: topN * u,
    outer: Math.ceil((topN * 3) / 2) * u,
    bottom: topN * 2 * u,
  };
}

export function buildGrid(trim: Size, baselineUnit: number, margins: Margins, columns: number, gutterBaselines: number, rows: number): Grid {
  const gutter = gutterBaselines * baselineUnit;
  const contentW = trim.w - margins.inner - margins.outer;
  const columnWidth = Math.floor((contentW - (columns - 1) * gutter) / columns);
  const usedW = columnWidth * columns + gutter * (columns - 1);
  const outer = trim.w - margins.inner - usedW;

  // Rows are whole baselines tall with a one-baseline gutter.
  const rowGutter = baselineUnit;
  const contentH0 = trim.h - margins.top - margins.bottom;
  const rowBaselines = Math.floor((contentH0 - (rows - 1) * rowGutter) / rows / baselineUnit);
  const rowHeight = rowBaselines * baselineUnit;
  const usedH = rowHeight * rows + rowGutter * (rows - 1);
  const bottom = trim.h - margins.top - usedH;

  return {
    trim,
    margins: { top: margins.top, inner: margins.inner, outer, bottom },
    content: { x: margins.inner, y: margins.top, w: usedW, h: usedH },
    columns,
    gutter,
    columnWidth,
    rows,
    rowHeight,
    rowGutter,
    baselineUnit,
    baselineOrigin: margins.top,
  };
}

/** x of a column's left edge. */
export function colX(g: Grid, col: number): number {
  return g.content.x + col * (g.columnWidth + g.gutter);
}

/** Width of a span of `n` columns starting anywhere. */
export function spanWidth(g: Grid, n: number): number {
  return n * g.columnWidth + (n - 1) * g.gutter;
}

export function rowY(g: Grid, row: number): number {
  return g.content.y + row * (g.rowHeight + g.rowGutter);
}

export function spanHeight(g: Grid, n: number): number {
  return n * g.rowHeight + (n - 1) * g.rowGutter;
}

/** Module rectangle for columns [c0, c0+cn) × rows [r0, r0+rn). */
export function moduleRect(g: Grid, c0: number, cn: number, r0: number, rn: number): Rect {
  return { x: colX(g, c0), y: rowY(g, r0), w: spanWidth(g, cn), h: spanHeight(g, rn) };
}

/** Snap y to the baseline grid (§7.3). */
export function snapToBaseline(y: number, g: Grid): number {
  return g.baselineOrigin + Math.round((y - g.baselineOrigin) / g.baselineUnit) * g.baselineUnit;
}

/** The first baseline at or below y. */
export function baselineAtOrBelow(y: number, g: Grid): number {
  return g.baselineOrigin + Math.ceil((y - g.baselineOrigin) / g.baselineUnit) * g.baselineUnit;
}

export function onBaseline(y: number, g: Grid): boolean {
  return (y - g.baselineOrigin) % g.baselineUnit === 0;
}
