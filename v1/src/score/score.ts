/**
 * Mechanical aesthetic heuristics and generate-and-filter (design guide §10).
 * None of these is "good design"; each is a computable proxy that correlates
 * with layouts looking composed rather than scattered. Every feature is
 * normalised to [0, 1] with 1 = better, so weights are comparable.
 */
import { contentNodes, textNodes, type PosterDocument } from "../model/document.js";
import { tac } from "../model/press.js";

export interface Features {
  /** Fraction of text baselines on the baseline grid (§7.3). */
  baselineAdherence: number;
  /** 1 − normalised variance of emptiness over a coarse cell grid (§7.5). */
  whitespaceBalance: number;
  /** Fewer distinct left edges reads as composed (§10.2). */
  alignmentConsistency: number;
  /** Adjacent hierarchy sizes are distinctly different. */
  hierarchyClarity: number;
  /** Spread of OKLCH lightness across the palette. */
  contrastRange: number;
  /** Centre of visual mass near the optical centre (§7.4). */
  opticalBalance: number;
  /** Ink density varies across the canvas (a void against density). */
  densityVariation: number;
  /** Share of the content box left empty, scored against a target. */
  whitespaceRatio: number;
}

export type Weights = Record<keyof Features, number>;

export interface Score extends Features {
  total: number;
}

/** Hand-set starting weights; replace with tuned weights (score/tune.ts) once preferences are recorded. */
export const DEFAULT_WEIGHTS: Weights = {
  baselineAdherence: 1.0,
  whitespaceBalance: 0.6,
  alignmentConsistency: 1.4,
  hierarchyClarity: 1.0,
  contrastRange: 0.6,
  opticalBalance: 0.8,
  densityVariation: 0.5,
  whitespaceRatio: 0.8,
};

export const FEATURE_KEYS = Object.keys(DEFAULT_WEIGHTS) as Array<keyof Features>;

const CELLS = 12;

/** Rasterise node bounds onto a coarse occupancy grid over the trim. */
function occupancy(doc: PosterDocument): { cells: number[]; ink: number[] } {
  const cells = new Array(CELLS * CELLS).fill(0) as number[];
  const ink = new Array(CELLS * CELLS).fill(0) as number[];
  const cw = doc.trim.w / CELLS,
    ch = doc.trim.h / CELLS;
  for (const n of contentNodes(doc)) {
    const b = n.bounds;
    const fill = n.kind === "shape" ? n.fill : n.fill;
    const coverage = fill ? tac(fill.cmyk) / 400 : 0;
    // text is a texture, not a solid
    const density = n.kind === "glyphRun" ? 0.35 : 1;
    const x0 = Math.max(0, Math.floor(b.x / cw)),
      x1 = Math.min(CELLS - 1, Math.floor((b.x + b.w) / cw));
    const y0 = Math.max(0, Math.floor(b.y / ch)),
      y1 = Math.min(CELLS - 1, Math.floor((b.y + b.h) / ch));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const cx0 = x * cw,
          cy0 = y * ch;
        const ox = Math.max(0, Math.min(b.x + b.w, cx0 + cw) - Math.max(b.x, cx0));
        const oy = Math.max(0, Math.min(b.y + b.h, cy0 + ch) - Math.max(b.y, cy0));
        const frac = (ox * oy) / (cw * ch);
        cells[y * CELLS + x] = Math.min(1, cells[y * CELLS + x]! + frac * density);
        ink[y * CELLS + x] = Math.min(1, ink[y * CELLS + x]! + frac * density * coverage);
      }
  }
  return { cells, ink };
}

const variance = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
};

export function features(doc: PosterDocument): Features {
  const texts = textNodes(doc).filter((t) => t.id !== "provenance");
  const { baselineOrigin: o, baselineUnit: u } = doc.layout;

  const baselineAdherence = texts.length ? texts.filter((t) => (t.baseline - o) % u === 0).length / texts.length : 1;

  const { cells, ink } = occupancy(doc);
  const empty = cells.map((c) => 1 - c);
  // variance of a [0,1] variable is at most 0.25
  const whitespaceBalance = 1 - Math.min(1, variance(empty) / 0.25);

  // Distinct left edges of content, within half a baseline.
  const edges: number[] = [];
  for (const n of contentNodes(doc)) {
    if (n.kind === "shape" && n.role === "background") continue;
    const x = n.bounds.x;
    if (!edges.some((e) => Math.abs(e - x) < u / 2)) edges.push(x);
  }
  const alignmentConsistency = edges.length <= 2 ? 1 : Math.max(0, 1 - (edges.length - 2) / 10);

  const sizes = [...new Set(texts.map((t) => t.sizeUnits))].sort((a, b) => b - a);
  let hierarchyClarity = 1;
  for (let i = 1; i < sizes.length; i++) {
    const ratio = sizes[i - 1]! / sizes[i]!;
    if (ratio < 1.15) hierarchyClarity -= 0.3; // too close to tell apart
  }
  hierarchyClarity = Math.max(0, hierarchyClarity);

  const ls = doc.layout.paletteOklch.map((c) => c.l);
  const contrastRange = Math.min(1, (Math.max(...ls) - Math.min(...ls)) / 0.8);

  // Visual mass: occupancy-weighted centroid vs the optical centre (x=0.5, y=0.45).
  let mx = 0,
    my = 0,
    mass = 0;
  for (let y = 0; y < CELLS; y++)
    for (let x = 0; x < CELLS; x++) {
      const w = cells[y * CELLS + x]!;
      mx += w * (x + 0.5);
      my += w * (y + 0.5);
      mass += w;
    }
  const cx = mass ? mx / mass / CELLS : 0.5,
    cy = mass ? my / mass / CELLS : 0.45;
  const dist = Math.sqrt((cx - 0.5) * (cx - 0.5) + (cy - 0.45) * (cy - 0.45));
  const opticalBalance = Math.max(0, 1 - dist / 0.5);

  const densityVariation = Math.min(1, Math.sqrt(variance(ink)) / 0.25);

  const emptyShare = empty.reduce((a, b) => a + b, 0) / empty.length;
  // Posters want generous space; peak at 55% empty, falling off either side.
  const whitespaceRatio = Math.max(0, 1 - Math.abs(emptyShare - 0.55) / 0.45);

  return { baselineAdherence, whitespaceBalance, alignmentConsistency, hierarchyClarity, contrastRange, opticalBalance, densityVariation, whitespaceRatio };
}

export function score(doc: PosterDocument, weights: Weights = DEFAULT_WEIGHTS): Score {
  const f = features(doc);
  let total = 0,
    wsum = 0;
  for (const k of FEATURE_KEYS) {
    total += weights[k] * f[k];
    wsum += Math.abs(weights[k]);
  }
  return { ...f, total: wsum ? total / wsum : 0 };
}
