/**
 * ICC colour conversion through Little CMS 2 compiled to WebAssembly
 * (design guide §9.3, §11.2). WebAssembly float arithmetic is IEEE-754
 * deterministic, so conversions are reproducible across engines.
 *
 * All colour conversion happens here, upstream of the PDF writer: by the time
 * the document model exists, every paint is already DeviceCMYK.
 */
import * as L from "lcms-wasm";
import type { CMYK } from "../model/document.js";
import type { LabD50 } from "./oklch.js";

type Lcms = L.LcmsInstance;

// lcms-wasm's exported TYPE_*_DBL constants decode as 32-bit floats, so build
// the 32-bit float formats explicitly: FLOAT_SH(1) | COLORSPACE_SH | CHANNELS_SH | BYTES_SH(4).
const fmt = (space: number, channels: number) => (1 << 22) | (space << 16) | (channels << 3) | 4;
const LAB_FLT = fmt(L.PT_Lab, 3);
const CMYK_FLT = fmt(L.PT_CMYK, 4);
const RGB_FLT = fmt(L.PT_RGB, 3);

export type RenderingIntent = "relative_colorimetric" | "perceptual";

export class PressColor {
  private constructor(
    private readonly lcms: Lcms,
    private readonly labToCmykRel: number,
    private readonly labToCmykPerc: number,
    private readonly cmykToLab: number,
    private readonly cmykToSrgb: number,
    /** The ICC bytes, embedded in the PDF output intent. */
    readonly iccBytes: Uint8Array,
    readonly description: string,
  ) {}

  static async create(iccBytes: Uint8Array, wasm?: { locateFile?: (name: string) => string }): Promise<PressColor> {
    const lcms = await L.instantiate(wasm);
    const press = lcms.cmsOpenProfileFromMem(iccBytes, iccBytes.byteLength);
    if (!press) throw new Error("PressColor: could not open the ICC profile");
    if (lcms.cmsGetColorSpaceASCII(press) !== "CMYK") throw new Error("PressColor: the output profile must be CMYK");
    const lab = lcms.cmsCreateLab4Profile(null);
    const srgb = lcms.cmsCreate_sRGBProfile();
    const bpc = L.cmsFLAGS_BLACKPOINTCOMPENSATION;
    const mk = (a: number, af: number, b: number, bf: number, intent: number, flags: number) => {
      const t = lcms.cmsCreateTransform(a, af, b, bf, intent, flags);
      if (!t) throw new Error("PressColor: could not create a transform");
      return t;
    };
    const description = lcms.cmsGetProfileInfoASCII(press, L.cmsInfoDescription, "en", "US") || "CMYK";
    return new PressColor(
      lcms,
      mk(lab, LAB_FLT, press, CMYK_FLT, L.INTENT_RELATIVE_COLORIMETRIC, bpc),
      mk(lab, LAB_FLT, press, CMYK_FLT, L.INTENT_PERCEPTUAL, bpc),
      mk(press, CMYK_FLT, lab, LAB_FLT, L.INTENT_RELATIVE_COLORIMETRIC, 0),
      mk(press, CMYK_FLT, srgb, RGB_FLT, L.INTENT_RELATIVE_COLORIMETRIC, bpc),
      iccBytes,
      description,
    );
  }

  toCmyk(lab: LabD50, intent: RenderingIntent = "relative_colorimetric"): CMYK {
    const t = intent === "perceptual" ? this.labToCmykPerc : this.labToCmykRel;
    const o = this.lcms.cmsDoTransform(t, new Float32Array([lab.L, lab.a, lab.b]), 1);
    return roundCmyk({ c: o[0]!, m: o[1]!, y: o[2]!, k: o[3]! });
  }

  toLab(c: CMYK): LabD50 {
    const o = this.lcms.cmsDoTransform(this.cmykToLab, new Float32Array([c.c, c.m, c.y, c.k]), 1);
    return { L: o[0]!, a: o[1]!, b: o[2]! };
  }

  /** Soft proof (§11.6): what the CMYK prints as, shown on an sRGB screen. 0-255. */
  proofSrgb(c: CMYK): [number, number, number] {
    const o = this.lcms.cmsDoTransform(this.cmykToSrgb, new Float32Array([c.c, c.m, c.y, c.k]), 1);
    const q = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
    return [q(o[0]!), q(o[1]!), q(o[2]!)];
  }
}

/** CMYK is stored to 0.1% so the model hashes identically everywhere. */
export function roundCmyk(c: CMYK): CMYK {
  const r = (v: number) => {
    const x = Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
    return x === 0 ? 0 : x; // normalise -0
  };
  return { c: r(c.c), m: r(c.m), y: r(c.y), k: r(c.k) };
}
