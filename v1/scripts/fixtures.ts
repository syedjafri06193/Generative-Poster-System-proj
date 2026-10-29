/**
 * Regenerate tests/determinism/fixtures.json. Run only when a generator
 * version bump is intended: changed hashes mean every existing poster's seed
 * now produces a different poster.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_BRIEF } from "../src/briefs.js";
import { formatSeed, subStream, SEED_MASK } from "../src/core/prng.js";
import { GENERATOR_VERSION } from "../src/core/version.js";
import { generate, hashDocument } from "../src/generate.js";
import { loadGrammar } from "../src/grammar/registry.js";
import { loadContext, ROOT } from "../src/node.js";

const ctx = await loadContext();
const grammar = "poster-grid@1";
const seeds = ["7f3a-9c21-0e48", "0000-0000-0001", "ffff-ffff-ffff"];
const r = subStream(0x5eedn, "fixtures");
while (seeds.length < 24) seeds.push(formatSeed(r.nextBigInt() & SEED_MASK));
const fixtures = seeds.map((seed) => {
  const { doc } = generate(loadGrammar(grammar), BigInt("0x" + seed.replace(/-/g, "")), SAMPLE_BRIEF, ctx);
  return { seed, grammar, hash: hashDocument(doc) };
});
writeFileSync(join(ROOT, "tests/determinism/fixtures.json"), JSON.stringify({ generatorVersion: GENERATOR_VERSION, fixtures }, null, 2) + "\n");
console.log(`${fixtures.length} fixtures written`);
