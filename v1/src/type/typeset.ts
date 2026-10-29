/**
 * Typesetting (design guide §8): modular scales, measure, leading on the
 * baseline grid, size-dependent tracking, optical margin alignment, line
 * breaking — and conversion of shaped glyphs to absolute outlines.
 *
 * All values that feed decisions are integers in 1/1000 pt.
 */
import { detPowInt } from "../core/detmath.js";
import { pt, unit } from "../core/units.js";
import type { PathCommand, PositionedGlyph } from "../model/document.js";
import type { LoadedFont } from "./fonts.js";

/** base · ratio^step, rounded to a quarter point (§8.2). Integer steps only. */
export function modularScale(baseUnits: number, ratio: number, step: number): number {
  const raw = baseUnits * detPowInt(ratio, step);
  return Math.round(raw / 250) * 250;
}

/**
 * A two-ratio scale (§8.2): a tight ratio for text sizes and a loose one for
 * display, so a large ratio doesn't collapse the middle of the hierarchy.
 */
export function typeHierarchy(baseUnits: number, textRatio: number, displayRatio: number, levels: number): number[] {
  const sizes: number[] = [];
  for (let i = 0; i < levels; i++) {
    sizes.push(i < 2 ? modularScale(baseUnits, textRatio, i) : modularScale(modularScale(baseUnits, textRatio, 1), displayRatio, i - 1));
  }
  return sizes.reverse(); // largest first
}

/** Leading as the nearest positive multiple of the baseline unit (§7.3). */
export function leadingOnGrid(sizeUnits: number, ratio: number, baselineUnit: number): number {
  const target = sizeUnits * ratio;
  return Math.max(baselineUnit, Math.round(target / baselineUnit) * baselineUnit);
}

/** Leading ratio grows with measure to hold the line return (§8.3, §15.2). */
export function leadingRatioForMeasure(measureChars: number): number {
  const m = measureChars < 30 ? 30 : measureChars > 80 ? 80 : measureChars;
  return 1.35 + (m - 45) * 0.006;
}

/** Characters per line for a column, from measured average advance (§8.3). */
export function measureChars(columnWidth: number, sizeUnits: number, font: LoadedFont): number {
  return columnWidth / (sizeUnits * font.metrics.averageAdvanceEm);
}

/** Tracking in em by size (§8.5): tighten display, open small type. */
export function opticalTracking(sizeUnits: number): number {
  if (sizeUnits >= pt(72)) return -0.025;
  if (sizeUnits >= pt(48)) return -0.02;
  if (sizeUnits >= pt(24)) return -0.01;
  if (sizeUnits <= pt(9)) return 0.02;
  return 0;
}

/**
 * Optical margin alignment (§8.4): punctuation and round or diagonal
 * letters hang into the margin so the edge *looks* straight.
 */
export const OVERHANG: Readonly<Record<string, number>> = {
  '"': 0.35, "'": 0.35, "“": 0.35, "”": 0.35, "‘": 0.35, "’": 0.35,
  ",": 0.25, ".": 0.25, "-": 0.3, "–": 0.3, "—": 0.3,
  A: 0.02, T: 0.02, V: 0.03, W: 0.03, Y: 0.03,
  O: 0.01, C: 0.01, G: 0.01, Q: 0.01,
};

export function opticalOffset(ch: string, sizeUnits: number): number {
  return -unit((OVERHANG[ch] ?? 0) * sizeUnits);
}

export interface SetLine {
  text: string;
  glyphs: PositionedGlyph[];
  outlines: PathCommand[];
  width: number;
  baseline: number;
  x: number;
}

/** Advance width of a string at a size with tracking, in units. */
export function measureText(font: LoadedFont, text: string, sizeUnits: number, trackingEm: number): number {
  const shaped = font.shape(text);
  let w = 0;
  for (const g of shaped) w += g.xAdvance;
  const track = trackingEm * font.metrics.upem * Math.max(0, shaped.length - 1);
  return unit(((w + track) * sizeUnits) / font.metrics.upem);
}

/**
 * Set one line of text at (x, baseline): shape, apply tracking, hang the
 * first character, and resolve every glyph to absolute outlines (y down).
 */
export function setLine(font: LoadedFont, text: string, sizeUnits: number, x: number, baseline: number, opts: { tracking?: number; hang?: boolean } = {}): SetLine {
  const tracking = opts.tracking ?? opticalTracking(sizeUnits);
  const upem = font.metrics.upem;
  const shaped = font.shape(text);
  const startX = x + (opts.hang === false ? 0 : opticalOffset(text[0] ?? "", sizeUnits));
  const trackFu = tracking * upem;
  const glyphs: PositionedGlyph[] = [];
  const outlines: PathCommand[] = [];
  let penFu = 0;
  const sx = (fu: number) => startX + unit((fu * sizeUnits) / upem);
  const sy = (fu: number) => baseline - unit((fu * sizeUnits) / upem);
  for (let i = 0; i < shaped.length; i++) {
    const g = shaped[i]!;
    const gx = penFu + g.xOffset;
    glyphs.push({ glyphId: g.glyphId, x: sx(gx), y: sy(g.yOffset) });
    for (const c of font.outline(g.glyphId)) {
      if (c.op === "Z") outlines.push(c);
      else if (c.op === "C") outlines.push({ op: "C", x1: sx(gx + c.x1), y1: sy(g.yOffset + c.y1), x2: sx(gx + c.x2), y2: sy(g.yOffset + c.y2), x: sx(gx + c.x), y: sy(g.yOffset + c.y) });
      else outlines.push({ op: c.op, x: sx(gx + c.x), y: sy(g.yOffset + c.y) });
    }
    penFu += g.xAdvance + (i < shaped.length - 1 ? trackFu : 0);
  }
  return { text, glyphs, outlines, width: unit((penFu * sizeUnits) / upem), baseline, x: startX };
}

/**
 * Greedy line breaking by measured width. Good enough for poster copy (short
 * blocks); a Knuth–Plass breaker is the upgrade for long text.
 */
export function breakLines(font: LoadedFont, text: string, sizeUnits: number, maxWidth: number, trackingEm: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const trial = current ? `${current} ${w}` : w;
    if (current && measureText(font, trial, sizeUnits, trackingEm) > maxWidth) {
      lines.push(current);
      current = w;
    } else current = trial;
  }
  if (current) lines.push(current);
  return lines;
}

/** Largest scale step whose text fits `maxWidth` on at most `maxLines` lines. */
export function fitDisplaySize(font: LoadedFont, text: string, candidates: number[], maxWidth: number, maxLines: number): number | null {
  for (const size of candidates) {
    const lines = breakLines(font, text, size, maxWidth, opticalTracking(size));
    const widest = Math.max(...lines.map((l) => measureText(font, l, size, opticalTracking(size))));
    // Never break inside a word: a single word wider than the column fails.
    if (lines.length <= maxLines && widest <= maxWidth) return size;
  }
  return null;
}
