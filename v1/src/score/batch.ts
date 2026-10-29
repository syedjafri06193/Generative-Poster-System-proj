/**
 * Generate many, show few (design guide §10.1). Candidate seeds derive from
 * the master seed, so a batch is reproducible from one number.
 */
import { SEED_MASK, subStream } from "../core/prng.js";
import { generate, GenerationError } from "../generate.js";
import type { Brief, Grammar } from "../grammar/schema.js";
import type { ComposeContext } from "../layout/compose.js";
import type { PosterDocument } from "../model/document.js";
import { DEFAULT_WEIGHTS, score, type Score, type Weights } from "./score.js";

export interface Scored {
  seed: bigint;
  doc: PosterDocument;
  score: Score;
}

export function candidateSeed(master: bigint, i: number): bigint {
  return subStream(master, `candidate/${i}`).nextBigInt() & SEED_MASK;
}

export function generateBatch(grammar: Grammar, master: bigint, n: number, brief: Brief, ctx: ComposeContext, weights: Weights = DEFAULT_WEIGHTS): { ranked: Scored[]; failed: number } {
  const out: Scored[] = [];
  let failed = 0;
  for (let i = 0; i < n; i++) {
    const seed = candidateSeed(master, i);
    try {
      const { doc } = generate(grammar, seed, brief, ctx);
      out.push({ seed, doc, score: score(doc, weights) });
    } catch (e) {
      if (e instanceof GenerationError) failed++;
      else throw e;
    }
  }
  // Stable: ties broken by seed so the ranking is deterministic.
  out.sort((a, b) => b.score.total - a.score.total || (a.seed < b.seed ? -1 : a.seed > b.seed ? 1 : 0));
  return { ranked: out, failed };
}
