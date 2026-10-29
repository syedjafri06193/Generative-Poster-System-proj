/**
 * Font embedding permissions (design guide §8.6). The OS/2 table's fsType
 * field is the font's machine-readable statement of intent. Converting text
 * to outlines counts as embedding under most EULAs, so a restricted font is
 * refused either way.
 */
export const FS_TYPE = {
  INSTALLABLE: 0x0000,
  RESTRICTED: 0x0002,
  PREVIEW_PRINT: 0x0004,
  EDITABLE: 0x0008,
  NO_SUBSET: 0x0100,
  BITMAP_ONLY: 0x0200,
} as const;

/** Offset of a table in an OpenType/TrueType file, or -1. */
export function findTable(font: Uint8Array, tag: string): number {
  const dv = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const magic = dv.getUint32(0);
  if (magic === 0x774f4646 || magic === 0x774f4632) throw new Error("WOFF/WOFF2 fonts are not supported; supply OTF or TTF");
  const numTables = dv.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const t = String.fromCharCode(font[rec]!, font[rec + 1]!, font[rec + 2]!, font[rec + 3]!);
    if (t === tag) return dv.getUint32(rec + 8);
  }
  return -1;
}

/** Read the raw fsType from the OS/2 table (offset 8). */
export function readFsType(font: Uint8Array): number {
  const os2 = findTable(font, "OS/2");
  if (os2 < 0) return FS_TYPE.INSTALLABLE; // no OS/2 table: no stated restriction
  return new DataView(font.buffer, font.byteOffset, font.byteLength).getUint16(os2 + 8);
}

/** Vertical metrics from OS/2 (typo ascender/descender, cap and x height). */
export function readVerticalMetrics(font: Uint8Array): { ascender: number; descender: number; capHeight: number; xHeight: number } {
  const dv = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const os2 = findTable(font, "OS/2");
  if (os2 < 0) throw new Error("font has no OS/2 table");
  const version = dv.getUint16(os2);
  const ascender = dv.getInt16(os2 + 68);
  const descender = dv.getInt16(os2 + 70);
  const xHeight = version >= 2 ? dv.getInt16(os2 + 86) : Math.round(ascender * 0.5);
  const capHeight = version >= 2 ? dv.getInt16(os2 + 88) : Math.round(ascender * 0.7);
  return { ascender, descender, capHeight, xHeight };
}

export function canEmbed(fsType: number): { ok: boolean; reason?: string } {
  // Bits 0-3 are the usage permission. In pre-v3 fonts several may be set, and
  // the least restrictive one applies, so the font is restricted only when
  // RESTRICTED is the sole permission bit.
  if ((fsType & 0x000f) === FS_TYPE.RESTRICTED) return { ok: false, reason: "the font's fsType forbids embedding (restricted license)" };
  if (fsType & FS_TYPE.BITMAP_ONLY) return { ok: false, reason: "the font's fsType allows bitmap embedding only; outlines are not permitted" };
  return { ok: true };
}
