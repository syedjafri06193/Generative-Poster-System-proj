/**
 * Series generation (stretch goal §17): N related posters from one family
 * seed. Every member shares canvas, grid, type scale and palette (see
 * SERIES_SHARED in layout/compose.ts); layout and ornaments vary. Member seeds
 * derive from the family seed, so the whole set reproduces from one number.
 */
import { SEED_MASK, subStream } from "../core/prng.js";
import { generate } from "../generate.js";
import type { Brief, Grammar } from "../grammar/schema.js";
import type { ComposeContext } from "../layout/compose.js";
import type { PosterDocument } from "../model/document.js";

export function memberSeed(family: bigint, i: number): bigint {
  return subStream(family, `series/${i}`).nextBigInt() & SEED_MASK;
}

/** One brief per member (an exhibition's talks, a festival's nights). */
export function generateSeries(grammar: Grammar, family: bigint, briefs: Brief[], ctx: ComposeContext): PosterDocument[] {
  return briefs.map((brief, i) => generate(grammar, memberSeed(family, i), brief, ctx, { family }).doc);
}
