/** Node.js loaders for fonts and the press profile. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PressColor } from "./color/icc.js";
import type { ComposeContext } from "./layout/compose.js";
import { PRESS_PROFILES, type PressProfile } from "./model/press.js";
import { FontSet } from "./type/fonts.js";
import { FONT_SPECS } from "./type/fontset.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function loadContext(pressId = "fogra39-coated"): Promise<ComposeContext> {
  const profile: PressProfile | undefined = PRESS_PROFILES[pressId];
  if (!profile) throw new Error(`unknown press profile ${pressId}`);
  const icc = new Uint8Array(readFileSync(join(ROOT, "profiles", profile.iccFile)));
  const press = await PressColor.create(icc);
  const fonts = FontSet.load(FONT_SPECS.map((spec) => ({ spec, bytes: new Uint8Array(readFileSync(join(ROOT, "fonts", spec.file))) })));
  return { fonts, press, profile };
}
