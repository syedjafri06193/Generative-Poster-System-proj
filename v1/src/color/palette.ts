/**
 * OKLCH palette generation (design guide §9.1, §9.2, §9.3). Colours are
 * sampled in a perceptually uniform space, then made press-safe: anything
 * that moves more than the profile's ΔE limit through FOGRA39 is pulled in
 * by reducing chroma (hue and lightness kept) until it prints as intended.
 */
import type { Rng } from "../core/prng.js";
import type { PressProfile } from "../model/press.js";
import { assess, type ConversionReport } from "./gamut.js";
import type { PressColor } from "./icc.js";
import { contrastRatio, deltaEOK, labToOklch, oklchToOklab, type Oklch } from "./oklch.js";
import { tac } from "../model/press.js";

export type PaletteStrategy = "monochrome" | "analogous" | "complementary" | "split-complementary" | "triadic" | "tetradic";

export interface PaletteSpec {
  strategies: PaletteStrategy[];
  /** OKLCH lightness range for accent colours. */
  lightnessRange: [number, number];
  chromaRange: [number, number];
  /** Number of accent colours, inclusive range. */
  colorCount: [number, number];
  /**
   * Ground: light (paper), dark (a deep colour field, kept above the press's
   * black point so it prints as intended) or black (rich black, §3.4).
   */
  grounds: Array<"light" | "dark" | "black">;
  /** Minimum OKLab ΔE×100 between any two palette entries. */
  minDistance: number;
  requireGamutSafe: true;
}

export interface Palette {
  strategy: PaletteStrategy;
  ground: "light" | "dark" | "black";
  background: Oklch;
  text: Oklch;
  accents: Oklch[];
  reports: ConversionReport[];
}

const HUE_OFFSETS: Record<PaletteStrategy, number[]> = {
  monochrome: [0],
  analogous: [-30, 0, 30],
  complementary: [0, 180],
  "split-complementary": [0, 150, 210],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
};

const wrap = (h: number) => ((h % 360) + 360) % 360;

/** Near-neutral colours darker than this are "black" and print as press black (§3.4). */
export function isNearBlack(c: Oklch): boolean {
  return c.l < 0.25 && c.c < 0.04;
}

/**
 * Reduce chroma in 10% steps until the colour round-trips within the limit.
 *
 * Near-blacks are a special case: they sit below the press's black point, so
 * no conversion can hit them. They are resolved to rich black or 100K by role
 * at layout time (§3.4); here the intended colour becomes the printed rich
 * black itself, so the palette describes what will actually print.
 */
export function gamutSafe(c: Oklch, press: PressColor, profile: PressProfile): { color: Oklch; report: ConversionReport } {
  if (isNearBlack(c)) {
    const printed = labToOklch(press.toLab(profile.richBlack));
    return { color: printed, report: { source: printed, cmyk: profile.richBlack, roundTrip: printed, deltaE: 0, inGamut: true, tac: tac(profile.richBlack) } };
  }
  let color = c;
  for (let i = 0; i <= 20; i++) {
    const report = assess(color, press, profile);
    if (report.inGamut && report.tac <= profile.tacLimit) return { color, report };
    color = { l: color.l, c: color.c * 0.9, h: color.h };
  }
  // Chroma is now ~12% of the original; a near-neutral of this lightness
  // always round-trips, so take it.
  color = { l: c.l, c: 0, h: c.h };
  return { color, report: assess(color, press, profile) };
}

export function generatePalette(spec: PaletteSpec, rng: Rng, press: PressColor, profile: PressProfile): Palette {
  const strategy = rng.pick(spec.strategies);
  const ground = rng.pick(spec.grounds);
  const baseHue = rng.range(0, 360);
  const count = rng.int(spec.colorCount[0], spec.colorCount[1]);
  const offsets = HUE_OFFSETS[strategy];

  const background: Oklch =
    ground === "light"
      ? { l: rng.range(0.94, 0.985), c: rng.range(0.004, 0.02), h: wrap(baseHue + 20) }
      : ground === "dark"
        ? { l: rng.range(0.34, 0.42), c: rng.range(0.03, 0.07), h: wrap(baseHue) }
        : { l: 0.2, c: 0, h: 0 }; // resolved to rich black by gamutSafe
  const text: Oklch = ground === "light" ? { l: 0.18, c: 0.01, h: baseHue } : { l: 0.96, c: 0.01, h: baseHue };

  const reports: ConversionReport[] = [];
  const bg = gamutSafe(background, press, profile);
  const tx = gamutSafe(text, press, profile);
  reports.push(bg.report, tx.report);

  const accents: Oklch[] = [];
  let attempts = 0;
  while (accents.length < count && attempts < count * 12) {
    attempts++;
    const i = accents.length;
    const hue = wrap(baseHue + offsets[i % offsets.length]! + (strategy === "monochrome" ? 0 : rng.range(-6, 6)));
    const candidate: Oklch = {
      l: rng.range(spec.lightnessRange[0], spec.lightnessRange[1]),
      c: rng.range(spec.chromaRange[0], spec.chromaRange[1]),
      h: hue,
    };
    const safe = gamutSafe(candidate, press, profile);
    const lab = oklchToOklab(safe.color);
    const others = [bg.color, tx.color, ...accents];
    const tooClose = others.some((o) => deltaEOK(oklchToOklab(o), lab) < spec.minDistance);
    // An accent must be visible against the ground.
    const visible = contrastRatio(safe.color, bg.color) >= 1.6;
    if (tooClose || !visible) continue;
    accents.push(safe.color);
    reports.push(safe.report);
  }
  return { strategy, ground, background: bg.color, text: tx.color, accents, reports };
}
