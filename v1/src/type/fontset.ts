import type { FontSpec } from "./fonts.js";

/** The bundled font set. Inter is OFL-1.1; TeX Gyre Termes is GUST (see fonts/). */
export const FONT_SPECS: FontSpec[] = [
  { ref: "inter-regular", family: "Inter", weight: 400, file: "Inter-Regular.otf", classification: "sans" },
  { ref: "inter-medium", family: "Inter", weight: 500, file: "Inter-Medium.otf", classification: "sans" },
  { ref: "inter-bold", family: "Inter", weight: 700, file: "Inter-Bold.otf", classification: "sans" },
  { ref: "inter-black", family: "Inter", weight: 900, file: "Inter-Black.otf", classification: "sans" },
  { ref: "termes-regular", family: "TeX Gyre Termes", weight: 400, file: "texgyretermes-regular.otf", classification: "serif" },
  { ref: "termes-bold", family: "TeX Gyre Termes", weight: 700, file: "texgyretermes-bold.otf", classification: "serif" },
];
