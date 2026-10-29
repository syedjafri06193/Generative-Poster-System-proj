/**
 * Font loading, metrics and shaping (design guide §8.1). Metrics come from
 * the font tables and shaping from HarfBuzz, once, in the layout engine —
 * the renderers only ever see positioned glyphs and outlines.
 */
import * as hb from "harfbuzzjs";
import { sha256Bytes } from "../core/hash.js";
import type { PathCommand } from "../model/document.js";
import { canEmbed, readFsType, readVerticalMetrics } from "./licensing.js";

export interface FontSpec {
  /** Stable reference used in the document model. */
  ref: string;
  family: string;
  weight: number;
  file: string;
  /** "sans" | "serif" — used by grammars to pair faces. */
  classification: "sans" | "serif";
}

export interface FontMetrics {
  upem: number;
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
  /** Mean advance over a representative English sample, in em (§8.3). */
  averageAdvanceEm: number;
}

export interface ShapedGlyph {
  glyphId: number;
  cluster: number;
  xAdvance: number;
  xOffset: number;
  yOffset: number;
}

const SAMPLE =
  "The quick brown fox jumps over the lazy dog. Typography is the craft of endowing human language with a durable visual form.";

export class LoadedFont {
  readonly metrics: FontMetrics;
  readonly hash: string;
  readonly fsType: number;
  private readonly font: hb.Font;
  private readonly outlineCache = new Map<number, PathCommand[]>();
  private readonly shapeCache = new Map<string, ShapedGlyph[]>();
  private readonly buffer = new hb.Buffer();

  constructor(
    readonly spec: FontSpec,
    readonly bytes: Uint8Array,
  ) {
    this.fsType = readFsType(bytes);
    const permit = canEmbed(this.fsType);
    if (!permit.ok) throw new Error(`font ${spec.ref}: ${permit.reason}`);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const face = new hb.Face(new hb.Blob(ab));
    this.font = new hb.Font(face);
    const vm = readVerticalMetrics(bytes);
    const upem = face.upem;
    this.hash = sha256Bytes(bytes).slice(0, 16);
    const sample = this.shape(SAMPLE);
    let total = 0;
    for (const g of sample) total += g.xAdvance;
    this.metrics = {
      upem,
      ascender: vm.ascender,
      descender: vm.descender,
      capHeight: vm.capHeight,
      xHeight: vm.xHeight,
      averageAdvanceEm: total / sample.length / upem,
    };
  }

  /**
   * Shape a run of text; positions are in font units. One HarfBuzz buffer is
   * reused per font: harfbuzzjs frees buffers only through a
   * FinalizationRegistry, which never runs inside a long synchronous batch,
   * so allocating one per call exhausts the WebAssembly heap after a few
   * thousand posters. Results are cached; shaping is pure.
   */
  shape(text: string): ShapedGlyph[] {
    const hit = this.shapeCache.get(text);
    if (hit) return hit;
    const buf = this.buffer;
    buf.reset();
    buf.addText(text);
    buf.guessSegmentProperties();
    hb.shape(this.font, buf);
    const infos = buf.getGlyphInfos();
    const pos = buf.getGlyphPositions();
    const out: ShapedGlyph[] = [];
    for (let i = 0; i < infos.length; i++) {
      out.push({ glyphId: infos[i]!.codepoint, cluster: infos[i]!.cluster, xAdvance: pos[i]!.xAdvance, xOffset: pos[i]!.xOffset, yOffset: pos[i]!.yOffset });
    }
    if (this.shapeCache.size > 4096) this.shapeCache.clear();
    this.shapeCache.set(text, out);
    return out;
  }

  /** Glyph outline in font units, y up, as path commands (quadratics raised to cubics). */
  outline(glyphId: number): PathCommand[] {
    const cached = this.outlineCache.get(glyphId);
    if (cached) return cached;
    const cmds = parseSvgPath(this.font.glyphToPath(glyphId));
    this.outlineCache.set(glyphId, cmds);
    return cmds;
  }
}

/** Parse the absolute M/L/Q/C/Z path HarfBuzz emits. */
export function parseSvgPath(d: string): PathCommand[] {
  const out: PathCommand[] = [];
  const re = /([MLQCZ])([^MLQCZ]*)/g;
  let cx = 0,
    cy = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const op = m[1]!;
    const n = m[2]!.trim() === "" ? [] : m[2]!.trim().split(/[\s,]+/).map(Number);
    if (op === "M" || op === "L") {
      for (let i = 0; i + 1 < n.length; i += 2) {
        out.push({ op: i === 0 ? (op as "M" | "L") : "L", x: n[i]!, y: n[i + 1]! });
        cx = n[i]!;
        cy = n[i + 1]!;
      }
    } else if (op === "Q") {
      for (let i = 0; i + 3 < n.length; i += 4) {
        const [qx, qy, x, y] = [n[i]!, n[i + 1]!, n[i + 2]!, n[i + 3]!];
        // Exact degree elevation: control points at 2/3 of the way to q.
        out.push({ op: "C", x1: cx + ((qx - cx) * 2) / 3, y1: cy + ((qy - cy) * 2) / 3, x2: x + ((qx - x) * 2) / 3, y2: y + ((qy - y) * 2) / 3, x, y });
        cx = x;
        cy = y;
      }
    } else if (op === "C") {
      for (let i = 0; i + 5 < n.length; i += 6) {
        out.push({ op: "C", x1: n[i]!, y1: n[i + 1]!, x2: n[i + 2]!, y2: n[i + 3]!, x: n[i + 4]!, y: n[i + 5]! });
        cx = n[i + 4]!;
        cy = n[i + 5]!;
      }
    } else if (op === "Z") out.push({ op: "Z" });
  }
  return out;
}

export class FontSet {
  private constructor(readonly fonts: Map<string, LoadedFont>) {}

  static load(entries: Array<{ spec: FontSpec; bytes: Uint8Array }>): FontSet {
    const map = new Map<string, LoadedFont>();
    for (const e of entries) map.set(e.spec.ref, new LoadedFont(e.spec, e.bytes));
    return new FontSet(map);
  }

  get(ref: string): LoadedFont {
    const f = this.fonts.get(ref);
    if (!f) throw new Error(`font "${ref}" is not loaded`);
    return f;
  }

  /** Fonts affect metrics, so they affect layout: part of provenance (§4.1). */
  get hash(): string {
    return sha256Bytes(new TextEncoder().encode([...this.fonts.values()].map((f) => `${f.spec.ref}:${f.hash}`).sort().join("|"))).slice(0, 16);
  }

  specs(): FontSpec[] {
    return [...this.fonts.values()].map((f) => f.spec);
  }
}
