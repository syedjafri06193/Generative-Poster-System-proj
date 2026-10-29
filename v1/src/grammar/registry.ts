/**
 * Published grammars. Immutable once listed here: an edit is a new version
 * file, never a change to an existing one (design guide §6.3).
 */
import posterGrid1 from "./grammars/poster-grid-1.json" with { type: "json" };
import { grammarId, validateGrammar, type Grammar } from "./schema.js";

const ALL: Grammar[] = [posterGrid1 as unknown as Grammar];

export const GRAMMARS: ReadonlyMap<string, Grammar> = new Map(
  ALL.map((g) => {
    const errors = validateGrammar(g);
    if (errors.length) throw new Error(`grammar ${grammarId(g)} is invalid: ${errors.join("; ")}`);
    return [grammarId(g), Object.freeze(g)] as const;
  }),
);

export function loadGrammar(id: string): Grammar {
  const g = GRAMMARS.get(id);
  if (!g) throw new Error(`unknown grammar "${id}" (have: ${[...GRAMMARS.keys()].join(", ")})`);
  return g;
}
