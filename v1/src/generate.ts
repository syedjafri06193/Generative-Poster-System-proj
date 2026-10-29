/**
 * Generation entry point: grammar + seed + brief -> PosterDocument, with
 * hard-constraint resampling (design guide §6.2) and provenance (§4.1).
 *
 * Generators are registered by version and never mutated once released, so a
 * poster printed with v1.0.0 can always be regenerated (§4.1).
 */
import { canonicalJson, sha256Hex } from "./core/hash.js";
import { formatSeed, subSeed, SEED_MASK } from "./core/prng.js";
import { pt } from "./core/units.js";
import { GENERATOR_VERSION } from "./core/version.js";
import { textPaint } from "./color/gamut.js";
import { violations } from "./grammar/constraints.js";
import { grammarId, type Brief, type Grammar } from "./grammar/schema.js";
import { compose, type ComposeContext } from "./layout/compose.js";
import { pathBounds, type GlyphRunNode, type Node, type PosterDocument } from "./model/document.js";
import { setLine } from "./type/typeset.js";

export interface GenerateResult {
  doc: PosterDocument;
  /** Seed actually used after resampling (equal to the input when attempt 0 succeeded). */
  attempt: number;
  rejected: Array<{ attempt: number; reason: string }>;
}

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly rejected: Array<{ attempt: number; reason: string }>,
  ) {
    super(message);
  }
}

function paletteHash(grammar: Grammar): string {
  return sha256Hex(canonicalJson(grammar.palette)).slice(0, 16);
}

function provenanceRun(doc: PosterDocument, ctx: ComposeContext, captionRef: string, textColor: { l: number; c: number; h: number }): GlyphRunNode {
  const p = doc.provenance;
  const text = `${p.seed} · v${p.generatorVersion} · ${p.grammarVersion}`;
  const font = ctx.fonts.get(captionRef);
  const size = pt(7);
  const desc = Math.ceil((-font.metrics.descender * size) / font.metrics.upem);
  const baseline = doc.trim.h - ctx.profile.safetyMargin - desc;
  const x = doc.layout.contentBox.x;
  const set = setLine(font, text, size, x, baseline, { hang: false });
  return {
    kind: "glyphRun",
    id: "provenance",
    fontRef: captionRef,
    sizeUnits: size,
    glyphs: set.glyphs,
    outlines: set.outlines,
    fill: textPaint(textColor, "caption", size, ctx.press, ctx.profile),
    role: "caption",
    text,
    baseline,
    bounds: pathBounds(set.outlines),
  };
}

export function generate(grammar: Grammar, seed: bigint, brief: Brief, ctx: ComposeContext, opts: { family?: bigint } = {}): GenerateResult {
  if (seed < 0n || seed > SEED_MASK) throw new RangeError("seed must be 48-bit");
  const rejected: GenerateResult["rejected"] = [];
  for (let attempt = 0; attempt < grammar.maxAttempts; attempt++) {
    // Attempt 0 uses the seed itself; resamples derive from it, so the whole
    // search is reproducible from the printed seed.
    const s = attempt === 0 ? seed : subSeed(seed, `resample/${attempt}`);
    const comp = compose(grammar, s, brief, ctx, opts.family);
    if (comp.infeasible) {
      rejected.push({ attempt, reason: comp.infeasible });
      continue;
    }
    const doc: PosterDocument = {
      provenance: {
        seed: formatSeed(seed),
        generatorVersion: GENERATOR_VERSION,
        grammarVersion: grammarId(grammar),
        fontSetHash: ctx.fonts.hash,
        paletteSetHash: paletteHash(grammar),
        ...(opts.family !== undefined ? { family: formatSeed(opts.family) } : {}),
      },
      trim: comp.trim,
      bleed: ctx.profile.bleed,
      safety: ctx.profile.safetyMargin,
      colorSpace: "cmyk",
      outputIntent: ctx.profile.outputConditionIdentifier,
      nodes: comp.nodes,
      layout: comp.layout,
    };
    const captionRef = grammar.type.families[0]!.caption;
    doc.nodes.push(provenanceRun(doc, ctx, captionRef, comp.palette.text));
    const v = violations(doc, grammar.constraints, { press: ctx.press, profile: ctx.profile, measureRange: grammar.type.measureChars });
    if (v.length) {
      rejected.push({ attempt, reason: v.map((x) => `${x.id}: ${x.message}`).join("; ") });
      continue;
    }
    return { doc, attempt, rejected };
  }
  throw new GenerationError(`no poster satisfied every hard constraint in ${grammar.maxAttempts} attempts`, rejected);
}

/**
 * Hash of the geometry, glyph ids and CMYK values (design guide §16.1) — not
 * of any serialised output, so formatting changes can't cause false failures.
 * The soft-proof RGB is excluded: it is a display aid, not part of the print.
 */
export function hashDocument(doc: PosterDocument): string {
  const strip = (n: Node) => {
    if (n.kind === "shape")
      return { ...n, fill: n.fill && { ...n.fill, proofRgb: undefined }, stroke: n.stroke && { ...n.stroke, paint: { ...n.stroke.paint, proofRgb: undefined } } };
    return { ...n, fill: { ...n.fill, proofRgb: undefined } };
  };
  return sha256Hex(canonicalJson({ provenance: doc.provenance, trim: doc.trim, bleed: doc.bleed, nodes: doc.nodes.map(strip) }));
}
