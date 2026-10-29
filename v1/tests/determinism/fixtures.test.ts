import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { SAMPLE_BRIEF } from "../../src/briefs.js";
import { parseSeed } from "../../src/core/prng.js";
import { GENERATOR_VERSION } from "../../src/core/version.js";
import { generate, hashDocument } from "../../src/generate.js";
import { loadGrammar } from "../../src/grammar/registry.js";
import { ROOT } from "../../src/node.js";
import { context } from "../helpers.js";

const file = JSON.parse(readFileSync(join(ROOT, "tests/determinism/fixtures.json"), "utf8")) as {
  generatorVersion: string;
  fixtures: Array<{ seed: string; grammar: string; hash: string }>;
};

describe("seed → document hash fixtures (§16.1)", () => {
  test("fixtures belong to this generator version", () => {
    // If this fails you changed output without bumping GENERATOR_VERSION
    // (or bumped it without regenerating fixtures on purpose).
    expect(file.generatorVersion).toBe(GENERATOR_VERSION);
  });

  test.each(file.fixtures)("seed $seed reproduces exactly", async ({ seed, grammar, hash }) => {
    const ctx = await context();
    const { doc } = generate(loadGrammar(grammar), parseSeed(seed), SAMPLE_BRIEF, ctx);
    expect(hashDocument(doc)).toBe(hash);
  });

  test("generation has no hidden global state", async () => {
    const ctx = await context();
    const g = loadGrammar("poster-grid@1");
    const a = hashDocument(generate(g, 42n, SAMPLE_BRIEF, ctx).doc);
    generate(g, 43n, SAMPLE_BRIEF, ctx); // interleave another seed
    const b = hashDocument(generate(g, 42n, SAMPLE_BRIEF, ctx).doc);
    expect(a).toBe(b);
  });
});
