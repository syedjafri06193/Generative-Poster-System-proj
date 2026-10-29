/** Browser loaders: the same context as src/node.ts, fetched over HTTP. */
import { PressColor } from "../src/color/icc.js";
import type { ComposeContext } from "../src/layout/compose.js";
import { PRESS_PROFILES } from "../src/model/press.js";
import { FontSet } from "../src/type/fonts.js";
import { FONT_SPECS } from "../src/type/fontset.js";

const bytes = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};

export async function loadBrowserContext(base = "./", pressId = "fogra39-coated"): Promise<ComposeContext & { icc: Uint8Array }> {
  const profile = PRESS_PROFILES[pressId]!;
  const icc = await bytes(`${base}profiles/${profile.iccFile}`);
  const press = await PressColor.create(icc);
  const fonts = FontSet.load(await Promise.all(FONT_SPECS.map(async (spec) => ({ spec, bytes: await bytes(`${base}fonts/${spec.file}`) }))));
  return { fonts, press, profile, icc };
}
