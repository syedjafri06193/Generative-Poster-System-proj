/**
 * Risograph mode (stretch goal §17): separate a poster into spot-colour
 * layers, one per drum, with a misregistration simulation for proofing.
 *
 * Each paint's colour is decomposed onto the chosen inks by non-negative
 * least squares in OKLab-derived "ink density" space (subtractive mixing is
 * approximated as density addition, which is what riso overprinting does).
 * Every layer is a greyscale density map — exactly what a riso master takes.
 * Within a layer, later objects knock out earlier ones (each is painted
 * opaque at its own density), so light type on a dark ground stays light.
 */

const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
/** Opaque colour of `ink` at density a over white paper. */
const tint = (rgb: [number, number, number], a: number) => `rgb(${rgb.map((v) => Math.round(255 + (v - 255) * a)).join(",")})`;
import type { PressColor } from "../color/icc.js";
import type { Node, PosterDocument } from "../model/document.js";
import { pathData } from "../render-svg/svg.js";
import { toPt } from "../core/units.js";

export interface RisoInk {
  name: string;
  /** Display colour of the ink at full density, sRGB hex. */
  hex: string;
  /** Per-channel density (1 − reflectance) of the ink at 100% on white. */
  density: [number, number, number];
}

/** A few standard riso drum colours (approximate). */
export const RISO_INKS: Record<string, RisoInk> = {
  black: { name: "Black", hex: "#000000", density: [1, 1, 1] },
  blue: { name: "Blue", hex: "#0078bf", density: [1, 0.53, 0.25] },
  fluorescentPink: { name: "Fluorescent Pink", hex: "#ff48b0", density: [0, 0.72, 0.31] },
  yellow: { name: "Yellow", hex: "#ffe800", density: [0, 0.09, 1] },
  red: { name: "Bright Red", hex: "#f15060", density: [0.05, 0.69, 0.62] },
  teal: { name: "Teal", hex: "#00838a", density: [1, 0.49, 0.46] },
};

const srgbToDensity = (rgb: [number, number, number]): [number, number, number] => [1 - rgb[0] / 255, 1 - rgb[1] / 255, 1 - rgb[2] / 255];

/** Non-negative least squares for 1–3 inks by projected gradient (fixed iterations: deterministic). */
export function decompose(target: [number, number, number], inks: RisoInk[]): number[] {
  const x = inks.map(() => 0.5);
  for (let it = 0; it < 400; it++) {
    const r = [0, 1, 2].map((ch) => inks.reduce((a, ink, i) => a + ink.density[ch]! * x[i]!, 0) - target[ch]!);
    for (let i = 0; i < inks.length; i++) {
      const g = [0, 1, 2].reduce((a, ch) => a + r[ch]! * inks[i]!.density[ch]!, 0);
      x[i] = Math.min(1, Math.max(0, x[i]! - 0.3 * g));
    }
  }
  return x.map((v) => Math.round(v * 1000) / 1000);
}

export interface RisoLayer {
  ink: RisoInk;
  /** Standalone SVG of this drum's master: black at density, on white. */
  masterSvg: string;
}

function nodePath(n: Node): string {
  return pathData(n.kind === "shape" ? n.path : n.outlines);
}

export function separate(doc: PosterDocument, inks: RisoInk[], press: PressColor): { layers: RisoLayer[]; proofSvg: (misregistration?: number, seed?: number) => string } {
  const W = toPt(doc.trim.w), H = toPt(doc.trim.h);
  const amounts = doc.nodes.map((n) => {
    const p = n.kind === "shape" ? n.fill : n.fill;
    if (!p) return inks.map(() => 0);
    return decompose(srgbToDensity(press.proofSrgb(p.cmyk)), inks);
  });
  const layers = inks.map((ink, i) => {
    const paths = doc.nodes.map((n, j) => {
      const a = amounts[j]![i]!;
      return `<path d="${nodePath(n)}" fill="${tint([0, 0, 0], a)}"/>`;
    }).join("");
    return { ink, masterSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}pt" height="${H}pt"><rect width="100%" height="100%" fill="#fff"/>${paths}</svg>` };
  });
  const proofSvg = (mis = 0.6, seed = 1) => {
    const rgbs = inks.map((ink) => hexRgb(ink.hex));
    // Deterministic per-drum offsets in pt (a small LCG, display only).
    let s = seed >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    const groups = inks.map((ink, i) => {
      const dx = (rnd() * mis).toFixed(2), dy = (rnd() * mis).toFixed(2);
      const paths = doc.nodes.map((n, j) => {
        const a = amounts[j]![i]!;
        return `<path d="${nodePath(n)}" fill="${tint(rgbs[i]!, a)}"/>`;
      }).join("");
      return `<g style="mix-blend-mode:multiply" transform="translate(${dx} ${dy})">${paths}</g>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}pt" height="${H}pt"><rect width="100%" height="100%" fill="#f6f3ea"/>${groups.join("")}</svg>`;
  };
  return { layers, proofSvg };
}
