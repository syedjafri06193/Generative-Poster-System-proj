/**
 * OKLCH / OKLab (Ottosson 2020) and CIE L*a*b* D50, using deterministic math
 * only (design guide §4.3, §9.1): colour decisions such as "is this in
 * gamut?" are comparisons, so they must be bit-identical on every engine.
 */
import { degToRad, detAtan2, detCbrt, detCos, detSin, PI } from "../core/detmath.js";

export interface Oklch {
  /** Lightness 0-1. */
  l: number;
  /** Chroma, roughly 0-0.37. */
  c: number;
  /** Hue in degrees, 0-360. */
  h: number;
}

export interface Oklab {
  l: number;
  a: number;
  b: number;
}

export interface LabD50 {
  L: number;
  a: number;
  b: number;
}

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

// XYZ (D65) -> LMS, and its inverse (Ottosson M1).
const M1: Mat3 = [
  [0.8189330101, 0.3618667424, -0.1288597137],
  [0.0329845436, 0.9293118715, 0.0361456387],
  [0.0482003018, 0.2643662691, 0.633851707],
];
const M1_INV: Mat3 = [
  [1.2270138511035211, -0.5577999806518222, 0.2812561489664678],
  [-0.0405801784232806, 1.1122568696168302, -0.0716766786656012],
  [-0.0763812845057069, -0.4214819784180127, 1.5861632204407947],
];
// LMS' -> OKLab (M2) and inverse.
const M2: Mat3 = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];
const M2_INV: Mat3 = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
];
// Bradford chromatic adaptation.
const D65_TO_D50: Mat3 = [
  [1.0478112, 0.0228866, -0.050127],
  [0.0295424, 0.9904844, -0.0170491],
  [-0.0092345, 0.0150436, 0.7521316],
];
const D50_TO_D65: Mat3 = [
  [0.9555766, -0.0230393, 0.0631636],
  [-0.0282895, 1.0099416, 0.0210077],
  [0.0122982, -0.020483, 1.3299098],
];
const D50_WHITE: Vec3 = [0.96422, 1, 0.82521];
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

export function oklchToOklab(c: Oklch): Oklab {
  const hr = degToRad(c.h);
  return { l: c.l, a: c.c * detCos(hr), b: c.c * detSin(hr) };
}

export function oklabToOklch(c: Oklab): Oklch {
  const chroma = Math.sqrt(c.a * c.a + c.b * c.b);
  let h = (detAtan2(c.b, c.a) * 180) / PI;
  if (h < 0) h += 360;
  return { l: c.l, c: chroma, h: chroma < 1e-9 ? 0 : h };
}

function oklabToXyzD65(c: Oklab): Vec3 {
  const lms_ = mul(M2_INV, [c.l, c.a, c.b]);
  const cube = (v: number) => v * v * v; // not **: exponentiation is implementation-approximated
  const lms: Vec3 = [cube(lms_[0]), cube(lms_[1]), cube(lms_[2])];
  return mul(M1_INV, lms);
}

function xyzD65ToOklab(xyz: Vec3): Oklab {
  const lms = mul(M1, xyz);
  const lms_: Vec3 = [detCbrt(lms[0]), detCbrt(lms[1]), detCbrt(lms[2])];
  const [l, a, b] = mul(M2, lms_);
  return { l, a, b };
}

const f = (t: number) => (t > EPS ? detCbrt(t) : (KAPPA * t + 16) / 116);
const fInv = (t: number) => {
  const t3 = t * t * t;
  return t3 > EPS ? t3 : (116 * t - 16) / KAPPA;
};

export function oklabToLabD50(c: Oklab): LabD50 {
  const xyz50 = mul(D65_TO_D50, oklabToXyzD65(c));
  const fx = f(xyz50[0] / D50_WHITE[0]);
  const fy = f(xyz50[1] / D50_WHITE[1]);
  const fz = f(xyz50[2] / D50_WHITE[2]);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labD50ToOklab(c: LabD50): Oklab {
  const fy = (c.L + 16) / 116;
  const fx = fy + c.a / 500;
  const fz = fy - c.b / 200;
  const xyz50: Vec3 = [fInv(fx) * D50_WHITE[0], fInv(fy) * D50_WHITE[1], fInv(fz) * D50_WHITE[2]];
  return xyzD65ToOklab(mul(D50_TO_D65, xyz50));
}

export const oklchToLab = (c: Oklch): LabD50 => oklabToLabD50(oklchToOklab(c));
export const labToOklch = (c: LabD50): Oklch => oklabToOklch(labD50ToOklab(c));

/** Euclidean distance in OKLab, ×100 so that ~2 is a just-noticeable difference. */
export function deltaEOK(a: Oklab, b: Oklab): number {
  const dl = a.l - b.l,
    da = a.a - b.a,
    db = a.b - b.b;
  return 100 * Math.sqrt(dl * dl + da * da + db * db);
}

/** Relative luminance proxy from OKLab L (L^3 ≈ Y for neutrals). */
export function luminanceFromOklch(c: Oklch): number {
  return c.l * c.l * c.l;
}

/** WCAG-style contrast ratio between two colours, from approximate luminance. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const ya = luminanceFromOklch(a),
    yb = luminanceFromOklch(b);
  const hi = ya > yb ? ya : yb,
    lo = ya > yb ? yb : ya;
  return (hi + 0.05) / (lo + 0.05);
}
