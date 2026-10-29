/**
 * The generator and layout engine (design guide §5.1, §6, §7). This is the
 * ONLY place decisions are made: grid, type, colour, composition. Its output
 * is a fully resolved PosterDocument that renderers draw without deciding
 * anything.
 *
 * Every decision draws from a named sub-stream (§4.2), so adding a choice in
 * one subsystem never shifts another's randomness.
 */
import { subStream as baseStream, type Rng } from "../core/prng.js";
import { PAPER, unit, type Rect } from "../core/units.js";
import { assess, paint, resolveBlack, textPaint } from "../color/gamut.js";
import type { PressColor } from "../color/icc.js";
import { generatePalette, isNearBlack, type Palette } from "../color/palette.js";
import { contrastRatio, type Oklch } from "../color/oklch.js";
import type { GlyphRunNode, LayoutFacts, Node, PathCommand, ShapeNode, TextRole } from "../model/document.js";
import { pathBounds, rectPath } from "../model/document.js";
import type { PressProfile } from "../model/press.js";
import type { Brief, CompositionTemplate, Grammar, Ornament } from "../grammar/schema.js";
import type { FontSet, LoadedFont } from "../type/fonts.js";
import {
  breakLines,
  fitDisplaySize,
  leadingOnGrid,
  leadingRatioForMeasure,
  measureChars,
  opticalTracking,
  setLine,
  typeHierarchy,
} from "../type/typeset.js";
import { baselineAtOrBelow, buildGrid, moduleRect, proportionalMargins, spanWidth, colX, type Grid } from "./grid.js";

export interface ComposeContext {
  fonts: FontSet;
  press: PressColor;
  profile: PressProfile;
}

export interface Composition {
  nodes: Node[];
  layout: LayoutFacts;
  trim: { w: number; h: number };
  palette: Palette;
  template: CompositionTemplate;
  ornament: Ornament;
  /** Why this attempt cannot work, if it can't (consumed by the resampler). */
  infeasible?: string;
}

interface TypeChoice {
  display: LoadedFont;
  body: LoadedFont;
  caption: LoadedFont;
  sizes: number[]; // largest first: display, subhead, body, caption
  displayRatio: number;
  bodySize: number;
  bodyLeading: number;
  captionSize: number;
  subheadSize: number;
}

interface Region {
  col0: number;
  cols: number;
  top: number;
  bottom: number;
  anchor: "top" | "bottom";
}

const CIRCLE_K = 0.5522847498307936; // 4/3·(√2−1), cubic circle approximation

function chooseGrid(grammar: Grammar, rng: Rng, trim: { w: number; h: number }, profile: PressProfile): Grid {
  const g = grammar.grid;
  const baselineUnit = unit(rng.int(g.baselinePt[0] * 4, g.baselinePt[1] * 4) * 250); // quarter-point steps
  const columns = rng.int(g.columns[0], g.columns[1]);
  const gutterB = rng.int(g.gutterBaselines[0], g.gutterBaselines[1]);
  const marginB = rng.int(g.marginBaselines[0], g.marginBaselines[1]);
  const rows = rng.int(g.rows[0], g.rows[1]);
  const margins = proportionalMargins(marginB, baselineUnit, profile.safetyMargin + baselineUnit);
  return buildGrid(trim, baselineUnit, margins, columns, gutterB, rows);
}

function chooseType(grammar: Grammar, rng: Rng, fonts: FontSet, grid: Grid): TypeChoice {
  const fam = rng.pick(grammar.type.families);
  const display = fonts.get(fam.display);
  const body = fonts.get(fam.body);
  const caption = fonts.get(fam.caption);
  const textRatio = rng.pick(grammar.type.textRatios);
  const displayRatio = rng.pick(grammar.type.displayRatios);
  // Body size from the baseline unit: one baseline of leading at a ratio in range.
  const lr = rng.range(grammar.type.bodyLeading[0], grammar.type.bodyLeading[1]);
  const bodySize = Math.round(grid.baselineUnit / lr / 250) * 250;
  const sizes = typeHierarchy(bodySize, textRatio, displayRatio, grammar.type.maxLevels);
  const captionSize = Math.max(Math.round((bodySize * 0.8) / 250) * 250, 7000);
  const subheadSize = sizes.length >= 3 ? sizes[sizes.length - 3]! : bodySize;
  return { display, body, caption, sizes: [...sizes.slice(0, -1), captionSize], displayRatio, bodySize, bodyLeading: grid.baselineUnit, captionSize, subheadSize };
}

/**
 * Regions for a template. `lead` holds the headline and subhead; `rest` the
 * body and details. When they are the same region the blocks form one stack.
 */
function chooseRegions(template: CompositionTemplate, g: Grid, rng: Rng): { lead: Region; rest: Region; field: Rect | null } {
  const C = g.columns,
    R = g.rows;
  const top = g.content.y,
    bottom = g.content.y + g.content.h;
  const rowTop = (r: number) => moduleRect(g, 0, 1, r, 1).y;
  const rowBottom = (r: number) => {
    const m = moduleRect(g, 0, 1, r, 1);
    return m.y + m.h;
  };
  switch (template) {
    case "headline-top": {
      // headline rows | ornament field rows | body rows, top to bottom
      const leadRows = Math.max(1, Math.floor(R / 3));
      const fieldRows = Math.max(1, Math.floor((R - leadRows) / 2));
      const lead: Region = { col0: 0, cols: C, top, bottom: rowBottom(leadRows - 1), anchor: "top" };
      const rest: Region = { col0: 0, cols: C, top: rowTop(leadRows + fieldRows), bottom, anchor: "bottom" };
      return { lead, rest, field: moduleRect(g, 0, C, leadRows, fieldRows) };
    }
    case "headline-bottom": {
      const fieldRows = Math.max(1, Math.floor(R / 2));
      const region: Region = { col0: 0, cols: C, top: rowTop(fieldRows), bottom, anchor: "bottom" };
      return { lead: region, rest: region, field: moduleRect(g, 0, C, 0, fieldRows) };
    }
    case "split-field": {
      const fc = Math.max(1, Math.floor(C / 2));
      const left = rng.bool();
      const field = left ? moduleRect(g, 0, fc, 0, R) : moduleRect(g, C - fc, fc, 0, R);
      const region: Region = { col0: left ? fc : 0, cols: C - fc, top, bottom, anchor: "top" };
      return { lead: region, rest: region, field };
    }
    case "column-stack": {
      const tc = Math.max(2, Math.ceil(C / 2));
      const region: Region = { col0: 0, cols: tc, top, bottom, anchor: rng.bool() ? "top" : "bottom" };
      return { lead: region, rest: region, field: C - tc > 0 ? moduleRect(g, tc, C - tc, 0, R) : null };
    }
  }
}

interface Block {
  role: TextRole;
  font: LoadedFont;
  size: number;
  leading: number;
  lines: string[];
  x: number;
  width: number;
  text: string;
  /** Baselines of space after the block. */
  gapAfter: number;
}

function layoutBlocks(blocks: Block[], region: Region, g: Grid): { block: Block; baselines: number[] }[] {
  // Lay out relative to region.top, then shift by whole baselines if bottom-anchored.
  const out: { block: Block; baselines: number[] }[] = [];
  let cursor = region.top;
  for (const b of blocks) {
    const asc = Math.ceil((b.font.metrics.ascender * b.size) / b.font.metrics.upem);
    const first = baselineAtOrBelow(cursor + asc, g);
    const baselines = b.lines.map((_, i) => first + i * b.leading);
    out.push({ block: b, baselines });
    const desc = Math.ceil((-b.font.metrics.descender * b.size) / b.font.metrics.upem);
    cursor = baselines[baselines.length - 1]! + desc + b.gapAfter * g.baselineUnit;
  }
  if (region.anchor === "bottom" && out.length) {
    const last = out[out.length - 1]!;
    const lastB = last.baselines[last.baselines.length - 1]!;
    const desc = Math.ceil((-last.block.font.metrics.descender * last.block.size) / last.block.font.metrics.upem);
    const slack = region.bottom - (lastB + desc);
    const shift = Math.floor(slack / g.baselineUnit) * g.baselineUnit;
    if (shift > 0) for (const o of out) o.baselines = o.baselines.map((y) => y + shift);
  }
  return out;
}

function glyphRun(id: string, b: Block, text: string, baseline: number, fill: ReturnType<typeof paint>): GlyphRunNode {
  const set = setLine(b.font, text, b.size, b.x, baseline, { tracking: opticalTracking(b.size) });
  return {
    kind: "glyphRun",
    id,
    fontRef: b.font.spec.ref,
    sizeUnits: b.size,
    glyphs: set.glyphs,
    outlines: set.outlines,
    fill,
    role: b.role,
    text,
    baseline,
    // Ink bounds from the actual outlines: display type is set tighter than
    // its ascender+descender, so the font's line box would report collisions
    // between lines that never touch.
    bounds: pathBounds(set.outlines),
  };
}

function circlePath(cx: number, cy: number, r: number): PathCommand[] {
  const k = unit(r * CIRCLE_K);
  return [
    { op: "M", x: cx + r, y: cy },
    { op: "C", x1: cx + r, y1: cy + k, x2: cx + k, y2: cy + r, x: cx, y: cy + r },
    { op: "C", x1: cx - k, y1: cy + r, x2: cx - r, y2: cy + k, x: cx - r, y: cy },
    { op: "C", x1: cx - r, y1: cy - k, x2: cx - k, y2: cy - r, x: cx, y: cy - r },
    { op: "C", x1: cx + k, y1: cy - r, x2: cx + r, y2: cy - k, x: cx + r, y: cy },
    { op: "Z" },
  ];
}

function ornaments(kind: Ornament, field: Rect, g: Grid, rng: Rng, accents: Oklch[], ctx: ComposeContext, broken: boolean): ShapeNode[] {
  if (kind === "none" || accents.length === 0) return [];
  const shapes: ShapeNode[] = [];
  const fills = accents.map((a) => paint(fillCmyk(a, ctx), ctx.press));
  const shape = (id: string, path: PathCommand[], fillIdx: number, role: ShapeNode["role"] = "ornament"): ShapeNode => ({
    kind: "shape",
    id,
    path,
    fill: fills[fillIdx % fills.length],
    role,
    bounds: pathBounds(path),
  });
  const u = g.baselineUnit;
  if (kind === "bars") {
    const n = rng.int(2, 5);
    let y = field.y;
    for (let i = 0; i < n && y < field.y + field.h; i++) {
      const hB = rng.int(1, Math.max(1, Math.floor(field.h / u / (n + 1))));
      const h = hB * u;
      // Broken grid (§7.1): one bar breaks out of the field and runs off the trim into the bleed.
      const w = broken && i === 0 ? g.trim.w + ctx.profile.bleed - field.x : field.w;
      const x = field.x;
      if (y + h > field.y + field.h) break;
      shapes.push(shape(`bar-${i}`, rectPath({ x, y, w, h }), i));
      y += h + rng.int(1, 3) * u;
    }
  } else if (kind === "discs") {
    const cols = Math.max(1, Math.round(field.w / (g.columnWidth + g.gutter)));
    const n = rng.int(1, Math.min(4, cols + 1));
    for (let i = 0; i < n; i++) {
      const r = unit((Math.min(field.w, field.h) / 2) * rng.range(0.3, 0.95));
      const cx = field.x + r + rng.int(0, Math.max(0, field.w - 2 * r));
      const cy = field.y + r + rng.int(0, Math.max(0, field.h - 2 * r));
      shapes.push(shape(`disc-${i}`, circlePath(cx, cy, r), i));
    }
  } else if (kind === "blocks") {
    const fc = Math.max(1, Math.round((field.w + g.gutter) / (g.columnWidth + g.gutter)));
    const fr = Math.max(1, Math.round((field.h + g.rowGutter) / (g.rowHeight + g.rowGutter)));
    const c0 = Math.round((field.x - g.content.x) / (g.columnWidth + g.gutter));
    const r0 = Math.round((field.y - g.content.y) / (g.rowHeight + g.rowGutter));
    let k = 0;
    for (let c = 0; c < fc; c++)
      for (let r = 0; r < fr; r++) {
        if (rng.bool(0.45)) {
          const m = moduleRect(g, c0 + c, 1, r0 + r, 1);
          shapes.push(shape(`block-${c}-${r}`, rectPath(m), k++));
        }
      }
    if (shapes.length === 0) shapes.push(shape("block-0-0", rectPath(moduleRect(g, c0, 1, r0, 1)), 0));
  } else if (kind === "rules") {
    const n = rng.int(3, 7);
    const step = Math.max(u, Math.floor(field.h / n / u) * u);
    const w = ctx.profile.minStroke * rng.int(2, 8); // filled rules, always above the press minimum
    for (let i = 0; i < n; i++) {
      const y = field.y + i * step;
      if (y + w > field.y + field.h) break;
      shapes.push(shape(`rule-${i}`, rectPath({ x: field.x, y, w: field.w, h: w }), 0, "rule"));
    }
  }
  return shapes;
}

/** A large-area fill: near-black becomes rich black (§3.4); anything else converts through the profile. */
function fillCmyk(c: Oklch, ctx: ComposeContext) {
  if (isNearBlack(c)) return resolveBlack("large_fill", 0, ctx.profile, ctx.press).cmyk;
  return assess(c, ctx.press, ctx.profile).cmyk;
}

/**
 * One composition attempt from `seed`. May report `infeasible` when the
 * sampled parameters cannot satisfy the grammar (e.g. no column span gives a
 * readable measure); the generator then resamples.
 */
/**
 * Decisions shared by every member of a series (stretch goal §17): canvas,
 * grid, type scale and palette come from the family seed, so the posters read
 * as a set while layout, regions and ornaments vary per member.
 */
export const SERIES_SHARED = ["canvas", "grid", "type/scale", "palette", "grid/system"] as const;

export function compose(grammar: Grammar, seed: bigint, brief: Brief, ctx: ComposeContext, family?: bigint): Composition {
  const subStream = (s: bigint, path: string): Rng => baseStream(family !== undefined && (SERIES_SHARED as readonly string[]).includes(path) ? family : s, path);
  const rCanvas = subStream(seed, "canvas");
  const sizeKey = rCanvas.pick(grammar.canvas.sizes);
  const trim = PAPER[sizeKey];
  if (!trim) throw new Error(`unknown canvas size ${sizeKey}`);

  const grid = chooseGrid(grammar, subStream(seed, "grid"), trim, ctx.profile);
  const type = chooseType(grammar, subStream(seed, "type/scale"), ctx.fonts, grid);
  const palette = generatePalette(grammar.palette, subStream(seed, "palette"), ctx.press, ctx.profile);
  const rComp = subStream(seed, "composition");
  const template = rComp.pick(grammar.composition.templates);
  const ornamentKind = rComp.pick(grammar.composition.ornaments);
  const system = subStream(seed, "grid/system").pick(grammar.grid.systems);
  const { lead, rest, field } = chooseRegions(template, grid, subStream(seed, "layout/regions"));

  const base = (): Omit<Composition, "nodes" | "layout"> => ({ trim, palette, template, ornament: ornamentKind });
  const facts = (bodyMeasure: number): LayoutFacts => ({
    baselineOrigin: grid.baselineOrigin,
    baselineUnit: grid.baselineUnit,
    columns: grid.columns,
    gutter: grid.gutter,
    margins: grid.margins,
    contentBox: grid.content,
    typeSizes: type.sizes,
    paletteOklch: [palette.background, palette.text, ...palette.accents],
    bodyMeasure,
  });

  // Body measure is a hard constraint (§8.3): choose the column span whose
  // measure is closest to the classic 62–66 characters.
  const [mMin, mMax] = grammar.type.measureChars;
  let bodyCols = -1;
  let bodyMeasure = 0;
  let best = Infinity;
  for (let n = 1; n <= rest.cols; n++) {
    const m = measureChars(spanWidth(grid, n), type.bodySize, type.body);
    if (m >= mMin && m <= mMax && Math.abs(m - 64) < best) {
      best = Math.abs(m - 64);
      bodyCols = n;
      bodyMeasure = m;
    }
  }
  if (bodyCols < 0) return { ...base(), nodes: [], layout: facts(0), infeasible: "no column span gives a body measure within range" };

  // Leading must grow with measure, on the grid.
  const bodyLeading = leadingOnGrid(type.bodySize, leadingRatioForMeasure(bodyMeasure), grid.baselineUnit);

  // Headline: largest hierarchy size that fits the region on few lines.
  const textW = spanWidth(grid, lead.cols);
  // Display sizes continue the scale upward to the poster's scale: steps of
  // the display ratio until a size would exceed a third of the text width.
  const displayCandidates = [...type.sizes.slice(0, Math.max(1, type.sizes.length - 2))];
  for (let s = displayCandidates[0]!; ; ) {
    s = Math.round((s * type.displayRatio) / 1000) * 1000;
    if (s > textW / 3) break;
    displayCandidates.unshift(s);
  }
  const headSize = fitDisplaySize(type.display, brief.headline, displayCandidates, textW, grammar.type.headlineMaxLines);
  if (headSize === null) return { ...base(), nodes: [], layout: facts(bodyMeasure), infeasible: "headline does not fit at any display size" };
  const headLeading = leadingOnGrid(headSize, 1.04, grid.baselineUnit);

  const x0 = colX(grid, lead.col0);
  const bodyOffsetCols = rest.cols - bodyCols > 0 ? subStream(seed, "layout/body-offset").int(0, rest.cols - bodyCols) : 0;
  const bodyX = colX(grid, rest.col0 + bodyOffsetCols);
  const bodyW = spanWidth(grid, bodyCols);

  const leadBlocks: Block[] = [
    {
      role: "display",
      font: type.display,
      size: headSize,
      leading: headLeading,
      lines: breakLines(type.display, brief.headline, headSize, textW, opticalTracking(headSize)),
      x: x0,
      width: textW,
      text: brief.headline,
      gapAfter: 2,
    },
  ];
  if (brief.subhead) {
    const sub = type.subheadSize < headSize ? type.subheadSize : type.bodySize;
    leadBlocks.push({
      role: sub >= 24000 ? "display" : "body",
      font: type.display,
      size: sub,
      leading: leadingOnGrid(sub, 1.2, grid.baselineUnit),
      lines: breakLines(type.display, brief.subhead, sub, textW, opticalTracking(sub)),
      x: x0,
      width: textW,
      text: brief.subhead,
      gapAfter: 3,
    });
  }
  const restX = colX(grid, rest.col0);
  const restW = spanWidth(grid, rest.cols);
  const restBlocks: Block[] = [];
  restBlocks.push({
    role: "body",
    font: type.body,
    size: type.bodySize,
    leading: bodyLeading,
    lines: breakLines(type.body, brief.body, type.bodySize, bodyW, opticalTracking(type.bodySize)),
    x: bodyX,
    width: bodyW,
    text: brief.body,
    gapAfter: 2,
  });
  if (brief.details.length) {
    restBlocks.push({
      role: "caption",
      font: type.caption,
      size: type.captionSize,
      leading: leadingOnGrid(type.captionSize, 1.3, grid.baselineUnit),
      lines: brief.details,
      x: restX,
      width: restW,
      text: brief.details.join("\n"),
      gapAfter: 0,
    });
  }

  const sameRegion = lead === rest;
  const placed = sameRegion ? layoutBlocks([...leadBlocks, ...restBlocks], lead, grid) : [...layoutBlocks(leadBlocks, lead, grid), ...layoutBlocks(restBlocks, rest, grid)];
  for (const [blocks, reg] of sameRegion ? ([[placed, lead]] as const) : ([[placed.slice(0, leadBlocks.length), lead], [placed.slice(leadBlocks.length), rest]] as const)) {
    const last = blocks[blocks.length - 1];
    if (!last) continue;
    const first = blocks[0]!;
    const lastBaseline = last.baselines[last.baselines.length - 1]!;
    const firstTop = first.baselines[0]! - Math.ceil((first.block.font.metrics.ascender * first.block.size) / first.block.font.metrics.upem);
    if (lastBaseline > reg.bottom || firstTop < reg.top) return { ...base(), nodes: [], layout: facts(bodyMeasure), infeasible: "text does not fit its region" };
  }

  // Colour by role and size (§3.4).
  const nodes: Node[] = [];
  const bleedRect: Rect = { x: -ctx.profile.bleed, y: -ctx.profile.bleed, w: trim.w + 2 * ctx.profile.bleed, h: trim.h + 2 * ctx.profile.bleed };
  nodes.push({ kind: "shape", id: "background", path: rectPath(bleedRect), fill: paint(fillCmyk(palette.background, ctx), ctx.press), role: "background", bounds: bleedRect });

  // Ornament field, clipped away from any text region it might share.
  if (field) {
    const r = subStream(seed, "layout/ornaments");
    nodes.push(...ornaments(ornamentKind, field, grid, r, palette.accents, ctx, system === "broken"));
  }

  let ti = 0;
  for (const { block, baselines } of placed) {
    // Display type may take the first accent, but only if it still reads
    // against the ground as printed (contrast is a hard constraint).
    const wantAccent = block.role === "display" && palette.accents.length > 0 && subStream(seed, `color/${ti}`).bool(0.35);
    const accentOk = wantAccent && contrastRatio(palette.accents[0]!, palette.background) >= 3.5;
    const fill = textPaint(accentOk ? palette.accents[0]! : palette.text, block.role, block.size, ctx.press, ctx.profile);
    block.lines.forEach((line, i) => nodes.push(glyphRun(`text-${ti}-${i}`, block, line, baselines[i]!, fill)));
    ti++;
  }

  return { ...base(), nodes, layout: facts(bodyMeasure) };
}
