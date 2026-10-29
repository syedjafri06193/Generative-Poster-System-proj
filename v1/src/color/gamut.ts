/**
 * Gamut assessment and paint resolution (design guide §3.3, §3.4, §9.3).
 */
import type { CMYK, Paint, TextRole } from "../model/document.js";
import { PURE_BLACK, tac, type PressProfile } from "../model/press.js";
import { roundCmyk, type PressColor, type RenderingIntent } from "./icc.js";
import { deltaEOK, labD50ToOklab, labToOklch, oklchToLab, oklchToOklab, type Oklch } from "./oklch.js";

export interface ConversionReport {
  source: Oklch;
  cmyk: CMYK;
  roundTrip: Oklch;
  /** OKLab ΔE ×100 between the intended colour and what will print. */
  deltaE: number;
  inGamut: boolean;
  tac: number;
}

export function assess(c: Oklch, press: PressColor, profile: PressProfile, intent: RenderingIntent = "relative_colorimetric"): ConversionReport {
  let cmyk = press.toCmyk(oklchToLab(c), intent);
  cmyk = limitTac(cmyk, profile.tacLimit);
  const backLab = press.toLab(cmyk);
  const back = labToOklch(backLab);
  const dE = deltaEOK(oklchToOklab(c), labD50ToOklab(backLab));
  return { source: c, cmyk, roundTrip: back, deltaE: dE, inGamut: dE <= profile.maxGamutDeltaE, tac: tac(cmyk) };
}

/**
 * Pull CMY down proportionally (keeping K, which carries the darkness) until
 * TAC is under the limit. ICC profiles already respect their own ink limit,
 * so this rarely triggers — it is the guarantee, not the mechanism.
 */
export function limitTac(c: CMYK, limit: number): CMYK {
  const total = tac(c);
  if (total <= limit) return c;
  const cmy = c.c + c.m + c.y;
  const allowed = Math.max(0, limit - c.k);
  const s = cmy > 0 ? allowed / cmy : 0;
  return roundCmyk({ c: c.c * s, m: c.m * s, y: c.y * s, k: c.k });
}

export function paint(cmyk: CMYK, press: PressColor): Paint {
  return { cmyk, proofRgb: press.proofSrgb(cmyk) };
}

/**
 * Black is two colours (§3.4): rich black for large fills and display type,
 * single-ink 100K for small text so misregistration can't fringe it. The
 * layout engine calls this with the role it knows.
 */
export function resolveBlack(role: "large_fill" | TextRole, sizeUnits: number, profile: PressProfile, press: PressColor): Paint {
  const small = role !== "large_fill" && (role !== "display" || sizeUnits < profile.smallTextLimit);
  return paint(small ? PURE_BLACK : profile.richBlack, press);
}

/**
 * Resolve a text colour for its size: below the small-text limit, a colour
 * that would need several inks for a near-black is forced to single-ink K.
 */
export function textPaint(source: Oklch, role: TextRole, sizeUnits: number, press: PressColor, profile: PressProfile): Paint {
  // Near-black (or the printed rich black itself): resolve by role and size.
  if (source.l < 0.3 && source.c < 0.04) return resolveBlack(role, sizeUnits, profile, press);
  return paint(assess(source, press, profile).cmyk, press);
}
