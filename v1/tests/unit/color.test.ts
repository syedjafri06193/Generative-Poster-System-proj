import { describe, expect, test } from "vitest";
import { assess, limitTac, resolveBlack } from "../../src/color/gamut.js";
import { labD50ToOklab, oklabToLabD50, oklchToOklab, deltaEOK, contrastRatio } from "../../src/color/oklch.js";
import { gamutSafe, generatePalette } from "../../src/color/palette.js";
import { Rng } from "../../src/core/prng.js";
import { pt } from "../../src/core/units.js";
import { loadGrammar } from "../../src/grammar/registry.js";
import { PURE_BLACK, tac } from "../../src/model/press.js";
import { context } from "../helpers.js";

describe("OKLab ↔ Lab D50", () => {
  test("round-trips", () => {
    for (const c of [{ l: 0.5, a: 0.1, b: -0.05 }, { l: 0.9, a: -0.02, b: 0.08 }, { l: 0.2, a: 0, b: 0 }]) {
      expect(deltaEOK(c, labD50ToOklab(oklabToLabD50(c)))).toBeLessThan(0.02);
    }
  });
  test("white is L*=100", () => {
    expect(oklabToLabD50({ l: 1, a: 0, b: 0 }).L).toBeCloseTo(100, 1);
  });
});

describe("press conversion through FOGRA39 (§9.3)", () => {
  test("vivid RGB-only colours are flagged out of gamut; muted ones are not", async () => {
    const { press, profile } = await context();
    expect(assess({ l: 0.7, c: 0.3, h: 145 }, press, profile).inGamut).toBe(false); // screen green
    expect(assess({ l: 0.7, c: 0.05, h: 145 }, press, profile).inGamut).toBe(true);
  });

  test("gamutSafe pulls chroma in until ΔE is within the limit", async () => {
    const { press, profile } = await context();
    const { color, report } = gamutSafe({ l: 0.65, c: 0.3, h: 260 }, press, profile);
    expect(report.deltaE).toBeLessThanOrEqual(profile.maxGamutDeltaE);
    expect(color.c).toBeLessThan(0.3);
    expect(color.h).toBe(260);
  });

  test("generated palettes round-trip with ΔE ≤ limit and TAC ≤ limit (M5)", async () => {
    const { press, profile } = await context();
    const spec = loadGrammar("poster-grid@1").palette;
    for (let s = 0; s < 60; s++) {
      const p = generatePalette(spec, new Rng(BigInt(s)), press, profile);
      for (const r of p.reports) {
        expect(r.deltaE).toBeLessThanOrEqual(profile.maxGamutDeltaE);
        expect(r.tac).toBeLessThanOrEqual(profile.tacLimit);
      }
    }
  });

  test("TAC limiting keeps K and scales CMY", () => {
    const c = limitTac({ c: 90, m: 90, y: 90, k: 100 }, 300);
    expect(tac(c)).toBeLessThanOrEqual(300.1);
    expect(c.k).toBe(100);
  });
});

describe("black is two colours (§3.4)", () => {
  test("small text gets 100K; large fills get rich black", async () => {
    const { press, profile } = await context();
    expect(resolveBlack("body", pt(10), profile, press).cmyk).toEqual(PURE_BLACK);
    expect(resolveBlack("display", pt(9), profile, press).cmyk).toEqual(PURE_BLACK);
    expect(resolveBlack("large_fill", 0, profile, press).cmyk).toEqual(profile.richBlack);
    expect(resolveBlack("display", pt(72), profile, press).cmyk).toEqual(profile.richBlack);
  });
  test("rich black prints darker than 100K alone", async () => {
    const { press, profile } = await context();
    expect(press.toLab(profile.richBlack).L).toBeLessThan(press.toLab(PURE_BLACK).L);
  });
});

test("contrast ratio is symmetric and ≥ 1", () => {
  const a = { l: 0.2, c: 0, h: 0 },
    b = { l: 0.95, c: 0, h: 0 };
  expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a));
  expect(contrastRatio(a, a)).toBe(1);
  expect(deltaEOK(oklchToOklab(a), oklchToOklab(a))).toBe(0);
});
