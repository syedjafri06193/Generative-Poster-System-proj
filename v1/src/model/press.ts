/**
 * Press profile: the machine-readable form of 1—Documentation/v1/print-spec.md
 * (design guide §3, milestone M0). Every hard constraint and preflight check
 * reads its limits from here, never from a literal.
 */
import { mm, pt } from "../core/units.js";
import type { CMYK } from "./document.js";

export interface PressProfile {
  id: string;
  /** Output intent condition identifier written into the PDF. */
  outputCondition: string;
  outputConditionIdentifier: string;
  registryName: string;
  /** ICC profile file under profiles/. */
  iccFile: string;
  /** Total area coverage limit, percent (§3.3). */
  tacLimit: number;
  /** Rich black for large fills and display type (§3.4). */
  richBlack: CMYK;
  /** Minimum stroke width, internal units (§3.5). */
  minStroke: number;
  /** Text smaller than this must be single-ink black (§3.4). */
  smallTextLimit: number;
  /** Minimum size for reversed-out text (§3.5). */
  minReversedText: number;
  bleed: number;
  safetyMargin: number;
  /** Max ΔE (OKLab ×100) a colour may move through the profile (§9.3). */
  maxGamutDeltaE: number;
}

export const FOGRA39_COATED: PressProfile = {
  id: "fogra39-coated",
  outputCondition: "FOGRA39L Coated",
  outputConditionIdentifier: "FOGRA39",
  registryName: "http://www.color.org",
  iccFile: "FOGRA39L_coated.icc",
  tacLimit: 330,
  richBlack: { c: 60, m: 40, y: 40, k: 100 },
  minStroke: pt(0.25),
  smallTextLimit: pt(12),
  minReversedText: pt(7),
  bleed: mm(3),
  safetyMargin: mm(5),
  maxGamutDeltaE: 3,
};

export const PRESS_PROFILES: Record<string, PressProfile> = {
  [FOGRA39_COATED.id]: FOGRA39_COATED,
};

export const PURE_BLACK: CMYK = { c: 0, m: 0, y: 0, k: 100 };

export function tac(c: CMYK): number {
  return c.c + c.m + c.y + c.k;
}

export function isRichBlack(c: CMYK): boolean {
  return c.k >= 95 && c.c + c.m + c.y > 0;
}
