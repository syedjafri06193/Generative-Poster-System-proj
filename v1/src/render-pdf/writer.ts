/**
 * A purpose-built PDF/X-4 writer (design guide §11.3, §12). Poster content is
 * simple — paths, fills and glyph outlines — so writing the file directly
 * gives exact control over the structures PDF/X-4 checks:
 *
 *  - PDF 1.6 header, no encryption, JavaScript or OPI
 *  - MediaBox ⊇ BleedBox ⊇ TrimBox on the page
 *  - one /GTS_PDFX output intent with the embedded ICC profile
 *  - XMP declaring pdfxid:GTS_PDFXVersion = PDF/X-4, matching the Info dict
 *  - every colour DeviceCMYK (converted upstream, §11.2)
 *  - the transparency group colour space set to DeviceCMYK (§11.4)
 *  - text as outlines (no font programs), with ActualText kept for search
 *
 * The output is deterministic: given the same document and dates it is
 * byte-identical.
 */
import { zlibSync } from "fflate";
import { toPt } from "../core/units.js";
import type { Node, Paint, PathCommand, PosterDocument } from "../model/document.js";
import type { PressProfile } from "../model/press.js";
import { sha256Hex } from "../core/hash.js";
import { buildXmp, pdfDate } from "./xmp.js";
import { transparencyGroup } from "./transparency.js";

export interface PdfOptions {
  title?: string;
  /** Creation date for Info/XMP; defaults to 2000-01-01 so output is reproducible. */
  date?: Date;
  /** ICC profile bytes for the output intent. */
  icc: Uint8Array;
  profile: PressProfile;
  /** Compress content streams (default true). */
  compress?: boolean;
}

const enc = new TextEncoder();

/** Format a number for PDF: up to 3 decimals, no exponent, no trailing zeros. */
export function num(v: number): string {
  if (!Number.isFinite(v)) throw new Error("PDF: non-finite number");
  const r = Math.round(v * 1000) / 1000;
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(3).replace(/0+$/, "");
}

const P = (u: number) => num(toPt(u));

/** PDF literal string with escapes; ASCII only. */
export function pdfString(s: string): string {
  return "(" + s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/\r/g, "\\r").replace(/\n/g, "\\n") + ")";
}

/** UTF-16BE hex string with BOM, for text that may be non-ASCII. */
export function pdfTextString(s: string): string {
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

function pathOps(path: PathCommand[]): string {
  const out: string[] = [];
  for (const c of path) {
    if (c.op === "M") out.push(`${P(c.x)} ${P(c.y)} m`);
    else if (c.op === "L") out.push(`${P(c.x)} ${P(c.y)} l`);
    else if (c.op === "C") out.push(`${P(c.x1)} ${P(c.y1)} ${P(c.x2)} ${P(c.y2)} ${P(c.x)} ${P(c.y)} c`);
    else out.push("h");
  }
  return out.join("\n");
}

const cmykOp = (p: Paint, stroke: boolean) => {
  const f = (v: number) => num(v / 100);
  return `${f(p.cmyk.c)} ${f(p.cmyk.m)} ${f(p.cmyk.y)} ${f(p.cmyk.k)} ${stroke ? "K" : "k"}`;
};

/** Constant opacity → named ExtGState (/GS0, /GS1…), in first-use order. */
const gsName = (opacity: number, states: number[]) => {
  let i = states.indexOf(opacity);
  if (i < 0) i = states.push(opacity) - 1;
  return `/GS${i}`;
};

function nodeOps(node: Node, states: number[]): string {
  if (node.kind === "shape") {
    const ops: string[] = ["q"];
    if (node.opacity !== undefined && node.opacity < 1) ops.push(`${gsName(node.opacity, states)} gs`);
    if (node.fill) ops.push(cmykOp(node.fill, false));
    if (node.stroke) ops.push(cmykOp(node.stroke.paint, true), `${P(node.stroke.width)} w`);
    ops.push(pathOps(node.path));
    ops.push(node.fill && node.stroke ? "B" : node.fill ? "f" : "S");
    ops.push("Q");
    return ops.join("\n");
  }
  // Outlined text, tagged with its source so it stays searchable/extractable.
  return [`/Span <</ActualText ${pdfTextString(node.text)}>> BDC`, "q", cmykOp(node.fill, false), pathOps(node.outlines), "f", "Q", "EMC"].join("\n");
}

class ObjectWriter {
  private parts: Uint8Array[] = [];
  private offsets: number[] = [];
  private length = 0;

  push(data: string | Uint8Array): void {
    const b = typeof data === "string" ? enc.encode(data) : data;
    this.parts.push(b);
    this.length += b.length;
  }

  object(id: number, body: string | Uint8Array, stream?: Uint8Array): void {
    this.offsets[id] = this.length;
    this.push(`${id} 0 obj\n`);
    this.push(body);
    if (stream) {
      this.push("\nstream\n");
      this.push(stream);
      this.push("\nendstream");
    }
    this.push("\nendobj\n");
  }

  finish(rootId: number, infoId: number, idHex: string): Uint8Array {
    const xref = this.length;
    const n = this.offsets.length;
    let table = `xref\n0 ${n}\n0000000000 65535 f \n`;
    for (let i = 1; i < n; i++) table += `${String(this.offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
    this.push(table);
    this.push(`trailer\n<< /Size ${n} /Root ${rootId} 0 R /Info ${infoId} 0 R /ID [<${idHex}> <${idHex}>] >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

export function writePdfX4(doc: PosterDocument, opts: PdfOptions): Uint8Array {
  const compress = opts.compress !== false;
  const date = opts.date ?? new Date(Date.UTC(2000, 0, 1));
  const title = opts.title ?? `Poster ${doc.provenance.seed}`;
  const b = doc.bleed;
  const W = doc.trim.w + 2 * b;
  const H = doc.trim.h + 2 * b;

  // Content: flip to the model's y-down, trim-relative coordinates once.
  const states: number[] = [];
  const content = [`1 0 0 -1 ${P(b)} ${P(H - b)} cm`, ...doc.nodes.map((n) => nodeOps(n, states))].join("\n");
  const resources = states.length
    ? `<< /ExtGState << ${states.map((a, i) => `/GS${i} << /Type /ExtGState /ca ${num(a)} /CA ${num(a)} >>`).join(" ")} >> >>`
    : "<< >>";
  const contentBytes = enc.encode(content);
  const stream = compress ? zlibSync(contentBytes, { level: 9 }) : contentBytes;
  const icc = zlibSync(opts.icc, { level: 9 });
  const docId = sha256Hex(`${doc.provenance.seed}|${doc.provenance.generatorVersion}|${doc.provenance.grammarVersion}|${content.length}`).slice(0, 32).toUpperCase();
  const xmp = enc.encode(buildXmp({ title, date, documentId: docId, producer: `generative-poster-system ${doc.provenance.generatorVersion}` }));

  const w = new ObjectWriter();
  // %PDF-1.6 plus a comment of four bytes >127, so transfers treat the file as binary.
  w.push(new Uint8Array([...enc.encode("%PDF-1.6\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const box = (x0: number, y0: number, x1: number, y1: number) => `[${P(x0)} ${P(y0)} ${P(x1)} ${P(y1)}]`;
  const media = box(0, 0, W, H);
  const bleed = box(0, 0, W, H);
  const trim = box(b, b, b + doc.trim.w, b + doc.trim.h);

  w.object(1, `<< /Type /Catalog /Pages 2 0 R /Metadata 5 0 R /OutputIntents [6 0 R] >>`);
  w.object(2, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);
  w.object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox ${media} /BleedBox ${bleed} /TrimBox ${trim} /Contents 4 0 R /Resources ${resources} /Group ${transparencyGroup()} >>`,
  );
  w.object(4, `<< /Length ${stream.length}${compress ? " /Filter /FlateDecode" : ""} >>`, stream);
  w.object(5, `<< /Type /Metadata /Subtype /XML /Length ${xmp.length} >>`, xmp);
  const p = opts.profile;
  w.object(
    6,
    `<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier ${pdfString(p.outputConditionIdentifier)} /OutputCondition ${pdfString(p.outputCondition)} /RegistryName ${pdfString(p.registryName)} /Info ${pdfString(p.outputCondition)} /DestOutputProfile 7 0 R >>`,
  );
  w.object(7, `<< /N 4 /Length ${icc.length} /Filter /FlateDecode >>`, icc);
  const d = pdfDate(date);
  w.object(
    8,
    `<< /Title ${pdfTextString(title)} /Producer ${pdfString(`generative-poster-system ${doc.provenance.generatorVersion}`)} /Creator ${pdfString(`generative-poster-system ${doc.provenance.generatorVersion}`)} /CreationDate ${pdfString(d)} /ModDate ${pdfString(d)} /Trapped /False /GTS_PDFXVersion (PDF/X-4) >>`,
  );
  return w.finish(1, 8, docId);
}
