/**
 * Grammar schema (design guide §6). A grammar is data: production ranges plus
 * hard constraints. Grammars are versioned and immutable once published —
 * edits create a new version, because changing one changes every poster it
 * ever produced (§6.3).
 */
import type { PaletteSpec } from "../color/palette.js";

export type GridSystem = "column" | "modular" | "broken";
export type CompositionTemplate = "headline-top" | "headline-bottom" | "split-field" | "column-stack";
export type Ornament = "bars" | "discs" | "blocks" | "rules" | "none";

export interface Brief {
  headline: string;
  subhead?: string;
  body: string;
  details: string[];
}

export interface Grammar {
  name: string;
  version: number;
  description: string;

  canvas: {
    /** Keys of PAPER in core/units.ts. */
    sizes: string[];
    press: string;
  };

  grid: {
    systems: GridSystem[];
    columns: [number, number];
    /** Gutter as a multiple of the baseline unit. */
    gutterBaselines: [number, number];
    /** Top margin as a multiple of the baseline unit (§7.2). */
    marginBaselines: [number, number];
    /** Baseline unit in points. */
    baselinePt: [number, number];
    rows: [number, number];
  };

  type: {
    families: Array<{ display: string; body: string; caption: string }>;
    textRatios: number[];
    displayRatios: number[];
    /** Hierarchy depth: display, subhead, body, caption. */
    maxLevels: number;
    measureChars: [number, number];
    /** Body leading ratio range; actual leading snaps to the baseline unit. */
    bodyLeading: [number, number];
    headlineMaxLines: number;
  };

  palette: PaletteSpec;

  composition: {
    templates: CompositionTemplate[];
    ornaments: Ornament[];
    minWhitespaceRatio: number;
    allowRotation: boolean;
    imagePolicy: "none";
  };

  /** Ids of hard constraints from constraints.ts that this grammar enforces. */
  constraints: string[];
  /** Maximum resampling attempts before generation fails (§6.2). */
  maxAttempts: number;
}

export function grammarId(g: Grammar): string {
  return `${g.name}@${g.version}`;
}

export function validateGrammar(g: Grammar): string[] {
  const errors: string[] = [];
  const range = (name: string, r: [number, number]) => {
    if (!(r[0] <= r[1])) errors.push(`${name}: min must be <= max`);
  };
  if (!g.name || !Number.isInteger(g.version)) errors.push("grammar needs a name and an integer version");
  if (g.canvas.sizes.length === 0) errors.push("canvas.sizes is empty");
  range("grid.columns", g.grid.columns);
  range("grid.gutterBaselines", g.grid.gutterBaselines);
  range("grid.marginBaselines", g.grid.marginBaselines);
  range("grid.baselinePt", g.grid.baselinePt);
  range("grid.rows", g.grid.rows);
  range("type.measureChars", g.type.measureChars);
  range("palette.colorCount", g.palette.colorCount);
  if (g.type.families.length === 0) errors.push("type.families is empty");
  if (g.composition.templates.length === 0) errors.push("composition.templates is empty");
  if (g.maxAttempts < 1) errors.push("maxAttempts must be >= 1");
  return errors;
}
