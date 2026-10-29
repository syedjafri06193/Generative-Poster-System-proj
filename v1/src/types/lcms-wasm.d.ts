/** Minimal typings for the parts of lcms-wasm this project uses. */
declare module "lcms-wasm" {
  export interface LcmsInstance {
    cmsOpenProfileFromMem(data: Uint8Array, size: number): number;
    cmsCreateLab4Profile(whitePoint: number[] | null): number;
    cmsCreate_sRGBProfile(): number;
    cmsGetColorSpaceASCII(profile: number): string | null;
    cmsGetProfileInfoASCII(profile: number, info: number, lang: string, country: string): string;
    cmsCreateTransform(input: number, inFmt: number, output: number, outFmt: number, intent: number, flags: number): number;
    cmsDoTransform(transform: number, input: Float32Array, count: number): Float32Array;
    cmsDeleteTransform(transform: number): void;
    cmsCloseProfile(profile: number): void;
  }
  export function instantiate(options?: { locateFile?: (name: string) => string }): Promise<LcmsInstance>;
  export const PT_Lab: number;
  export const PT_CMYK: number;
  export const PT_RGB: number;
  export const INTENT_RELATIVE_COLORIMETRIC: number;
  export const INTENT_PERCEPTUAL: number;
  export const cmsFLAGS_BLACKPOINTCOMPENSATION: number;
  export const cmsInfoDescription: number;
}
