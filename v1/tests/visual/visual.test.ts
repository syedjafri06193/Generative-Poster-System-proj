/**
 * Visual regression (§16.5): fixture posters rendered to PNG and compared to
 * approved images. Catches renderer, font or colour-pipeline changes that the
 * document hash can't see. Approve new images with UPDATE_GOLDENS=1.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import { SAMPLE_BRIEF } from "../../src/briefs.js";
import { parseSeed } from "../../src/core/prng.js";
import { generate } from "../../src/generate.js";
import { loadGrammar } from "../../src/grammar/registry.js";
import { ROOT } from "../../src/node.js";
import { renderSvg } from "../../src/render-svg/svg.js";
import { context } from "../helpers.js";

const SEEDS = ["7f3a-9c21-0e48", "0000-0000-0001", "0000-0000-0007", "1234-5678-9abc", "cafe-f00d-0042", "dead-beef-0001"];
const DIR = join(ROOT, "tests/visual/golden");
const update = process.env.UPDATE_GOLDENS === "1";

describe("visual regression", () => {
  test.each(SEEDS)("%s matches its approved render", async (seed) => {
    const ctx = await context();
    const { doc } = generate(loadGrammar("poster-grid@1"), parseSeed(seed), SAMPLE_BRIEF, ctx);
    const png = new Resvg(renderSvg(doc), { fitTo: { mode: "width", value: 400 } }).render();
    const file = join(DIR, `${seed}.png`);
    if (update || !existsSync(file)) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(file, png.asPng());
      return;
    }
    const golden = PNG.sync.read(readFileSync(file));
    expect([png.width, png.height]).toEqual([golden.width, golden.height]);
    const diff = pixelmatch(new Uint8Array(png.pixels), golden.data, null, png.width, png.height, { threshold: 0.1 });
    // Allow anti-aliasing noise only: under 0.1% of pixels.
    expect(diff / (png.width * png.height)).toBeLessThan(0.001);
  });
});
