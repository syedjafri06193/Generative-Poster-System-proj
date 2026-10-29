import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync, unzlibSync } from "fflate";
import { describe, expect, test } from "vitest";
import { SAMPLE_BRIEF } from "../../src/briefs.js";
import { generate } from "../../src/generate.js";
import { loadGrammar } from "../../src/grammar/registry.js";
import { ROOT } from "../../src/node.js";
import { writePdfX4 } from "../../src/render-pdf/writer.js";
import { context } from "../helpers.js";

const icc = new Uint8Array(readFileSync(join(ROOT, "profiles/FOGRA39L_coated.icc")));
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

async function poster(seed = 0x7f3a9c210e48n) {
  const ctx = await context();
  return { ctx, doc: generate(loadGrammar("poster-grid@1"), seed, SAMPLE_BRIEF, ctx).doc };
}

describe("PDF/X-4 writer (§11.3)", () => {
  test("emits the structures PDF/X-4 requires", async () => {
    const { ctx, doc } = await poster();
    const pdf = latin1(writePdfX4(doc, { icc, profile: ctx.profile }));
    expect(pdf.startsWith("%PDF-1.6\n")).toBe(true);
    expect(pdf).toMatch(/\/OutputIntents \[6 0 R\]/);
    expect(pdf).toMatch(/\/S \/GTS_PDFX/);
    expect(pdf).toMatch(/\/DestOutputProfile 7 0 R/);
    expect(pdf).toMatch(/\/TrimBox \[/);
    expect(pdf).toMatch(/\/BleedBox \[/);
    expect(pdf).toMatch(/\/GTS_PDFXVersion \(PDF\/X-4\)/);
    expect(pdf).toMatch(/<pdfxid:GTS_PDFXVersion>PDF\/X-4<\/pdfxid:GTS_PDFXVersion>/);
    expect(pdf).toMatch(/\/Trapped \/False/);
    expect(pdf).not.toMatch(/\/Encrypt|\/JavaScript|\/OPI/);
  });

  test("the transparency group is DeviceCMYK, never the DeviceRGB default (§11.4)", async () => {
    const { ctx, doc } = await poster();
    const pdf = latin1(writePdfX4(doc, { icc, profile: ctx.profile }));
    expect(pdf).toMatch(/\/Group << \/Type \/Group \/S \/Transparency \/CS \/DeviceCMYK/);
    expect(pdf).not.toMatch(/DeviceRGB/);
  });

  test("content uses only CMYK colour operators, and text is tagged with ActualText", async () => {
    const { ctx, doc } = await poster();
    const pdf = writePdfX4(doc, { icc, profile: ctx.profile, compress: false });
    const content = latin1(pdf);
    expect(content).not.toMatch(/ (rg|RG|g|G|sc|scn)\n/);
    expect(content).toMatch(/ k\n/);
    expect(content).toMatch(/\/Span <<\/ActualText <FEFF/);
  });

  test("boxes nest: MediaBox ⊇ BleedBox ⊇ TrimBox, trim inset by the bleed", async () => {
    const { ctx, doc } = await poster();
    const pdf = latin1(writePdfX4(doc, { icc, profile: ctx.profile }));
    const box = (name: string) => pdf.match(new RegExp(`/${name} \\[([^\\]]+)\\]`))![1]!.split(" ").map(Number);
    const [m, b, t] = [box("MediaBox"), box("BleedBox"), box("TrimBox")];
    expect(b[0]! >= m[0]! && b[2]! <= m[2]!).toBe(true);
    expect(t[0]).toBeCloseTo(doc.bleed / 1000, 2);
    expect(t[2]! - t[0]!).toBeCloseTo(doc.trim.w / 1000, 2);
  });

  test("output is byte-identical for the same document and date", async () => {
    const { ctx, doc } = await poster();
    const a = writePdfX4(doc, { icc, profile: ctx.profile });
    const b = writePdfX4(doc, { icc, profile: ctx.profile });
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  test("the embedded ICC profile is the press profile", async () => {
    const { ctx, doc } = await poster();
    const pdf = writePdfX4(doc, { icc, profile: ctx.profile });
    const s = latin1(pdf);
    const at = s.indexOf("7 0 obj");
    const start = s.indexOf("stream\n", at) + 7;
    const end = s.indexOf("\nendstream", start);
    expect(Buffer.compare(Buffer.from(unzlibSync(pdf.subarray(start, end))), Buffer.from(icc))).toBe(0);
    void inflateSync;
  });

  const python = spawnSync("python3", ["-c", "import pikepdf"]).status === 0;
  test.skipIf(!python)("passes the independent structural PDF/X-4 checker and qpdf", async () => {
    const { ctx, doc } = await poster();
    const dir = mkdtempSync(join(tmpdir(), "pdfx-"));
    const file = join(dir, "poster.pdf");
    writeFileSync(file, writePdfX4(doc, { icc, profile: ctx.profile }));
    execFileSync("python3", [join(ROOT, "tools/pdfx_check.py"), file]);
    const qpdf = spawnSync("qpdf", ["--check", file]);
    if (qpdf.error === undefined) expect(qpdf.status).toBe(0);
  });
});
