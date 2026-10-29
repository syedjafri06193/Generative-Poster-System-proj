import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { pt } from "../../src/core/units.js";
import { ROOT } from "../../src/node.js";
import { canEmbed, FS_TYPE, readFsType } from "../../src/type/licensing.js";
import { breakLines, leadingOnGrid, leadingRatioForMeasure, measureText, modularScale, opticalOffset, opticalTracking, setLine } from "../../src/type/typeset.js";
import { context } from "../helpers.js";

describe("scale and leading", () => {
  test("modular scale rounds to quarter points", () => {
    expect(modularScale(pt(12), 1.25, 1)).toBe(pt(15));
    expect(modularScale(pt(11), 1.2, 1) % 250).toBe(0);
  });
  test("leading is a whole number of baselines", () => {
    for (const s of [pt(9), pt(12), pt(31), pt(80)]) expect(leadingOnGrid(s, 1.4, pt(14)) % pt(14)).toBe(0);
  });
  test("leading grows with measure", () => {
    expect(leadingRatioForMeasure(75)).toBeGreaterThan(leadingRatioForMeasure(45));
  });
  test("tracking tightens display and opens small type", () => {
    expect(opticalTracking(pt(60))).toBeLessThan(0);
    expect(opticalTracking(pt(8))).toBeGreaterThan(0);
    expect(opticalTracking(pt(12))).toBe(0);
  });
});

describe("optical margin alignment (§8.4)", () => {
  test("quotes and punctuation hang; plain letters do not", () => {
    expect(opticalOffset("“", pt(40))).toBe(-pt(14));
    expect(opticalOffset("H", pt(40))).toBe(-0);
  });
  test("a line starting with a quote starts left of the margin", async () => {
    const { fonts } = await context();
    const f = fonts.get("inter-bold");
    expect(setLine(f, "“Hello”", pt(40), 1000, 50000).x).toBeLessThan(1000);
    expect(setLine(f, "Hello", pt(40), 1000, 50000).x).toBe(1000);
  });
});

describe("shaping and breaking", () => {
  test("kerning is applied (AV is narrower than A + V)", async () => {
    const f = (await context()).fonts.get("inter-bold");
    expect(measureText(f, "AV", pt(100), 0)).toBeLessThan(measureText(f, "A", pt(100), 0) + measureText(f, "V", pt(100), 0));
  });
  test("lines never exceed the measure", async () => {
    const f = (await context()).fonts.get("inter-regular");
    const text = "The quick brown fox jumps over the lazy dog ".repeat(8);
    for (const line of breakLines(f, text, pt(12), pt(200), 0)) expect(measureText(f, line, pt(12), 0)).toBeLessThanOrEqual(pt(200));
  });
  test("shaping stays correct across tens of thousands of calls (no WASM heap exhaustion)", async () => {
    const f = (await context()).fonts.get("inter-regular");
    const ref = measureText(f, "Stable 0", pt(12), 0);
    for (let i = 0; i < 30000; i++) f.shape(`Stable ${i}`);
    expect(measureText(f, "Stable 0", pt(12), 0)).toBe(ref);
  });
});

describe("fsType (§8.6)", () => {
  test("bundled fonts permit embedding", () => {
    for (const file of ["Inter-Regular.otf", "texgyretermes-regular.otf"]) {
      expect(canEmbed(readFsType(new Uint8Array(readFileSync(join(ROOT, "fonts", file))))).ok).toBe(true);
    }
  });
  test("restricted fonts are refused, permissive bits win in old fonts", () => {
    expect(canEmbed(FS_TYPE.RESTRICTED).ok).toBe(false);
    expect(canEmbed(FS_TYPE.RESTRICTED | FS_TYPE.PREVIEW_PRINT).ok).toBe(true);
    expect(canEmbed(FS_TYPE.BITMAP_ONLY).ok).toBe(false);
    expect(canEmbed(FS_TYPE.EDITABLE).ok).toBe(true);
  });
  test("a font whose OS/2 table says restricted cannot be loaded", async () => {
    const bytes = new Uint8Array(readFileSync(join(ROOT, "fonts", "Inter-Regular.otf")));
    const dv = new DataView(bytes.buffer);
    // patch fsType in place on a copy
    const copy = bytes.slice();
    const numTables = dv.getUint16(4);
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (String.fromCharCode(...copy.slice(rec, rec + 4)) === "OS/2") new DataView(copy.buffer).setUint16(dv.getUint32(rec + 8) + 8, FS_TYPE.RESTRICTED);
    }
    const { LoadedFont } = await import("../../src/type/fonts.js");
    expect(() => new LoadedFont({ ref: "x", family: "x", weight: 400, file: "x", classification: "sans" }, copy)).toThrow(/forbids embedding/);
  });
});
