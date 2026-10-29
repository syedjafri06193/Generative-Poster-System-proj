import { describe, expect, test } from "vitest";
import { SAMPLE_BRIEF } from "../../src/briefs.js";
import { rectsOverlap } from "../../src/core/units.js";
import { generate, GenerationError } from "../../src/generate.js";
import { violations } from "../../src/grammar/constraints.js";
import { loadGrammar } from "../../src/grammar/registry.js";
import { bleedRect, textNodes } from "../../src/model/document.js";
import { tac } from "../../src/model/press.js";
import { preflight } from "../../src/render-pdf/preflight.js";
import { context } from "../helpers.js";

// The design guide's bar is 10,000 seeds (M6). CI runs that via
// `npm run verify -- 10000`; the unit suite samples a deterministic subset.
const N = Number(process.env.PROPERTY_SEEDS ?? 2000);

describe(`hard constraints over ${N} seeds (§16.4)`, () => {
  test("every generated poster satisfies every hard constraint and passes preflight", async () => {
    const ctx = await context();
    const g = loadGrammar("poster-grid@1");
    let failures = 0;
    for (let i = 0; i < N; i++) {
      const seed = BigInt(i) * 0x9e3779b1n + 17n;
      let doc;
      try {
        doc = generate(g, seed & 0xffff_ffff_ffffn, SAMPLE_BRIEF, ctx).doc;
      } catch (e) {
        if (e instanceof GenerationError) {
          failures++;
          continue;
        }
        throw e;
      }
      expect(violations(doc, g.constraints, { press: ctx.press, profile: ctx.profile, measureRange: g.type.measureChars })).toEqual([]);
      const pf = preflight(doc, ctx.profile);
      expect(pf.issues.filter((x) => x.severity === "error")).toEqual([]);

      // Direct restatements, independent of the constraint code:
      const texts = textNodes(doc);
      for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) expect(rectsOverlap(texts[a]!.bounds, texts[b]!.bounds)).toBe(false);
      for (const n of doc.nodes) {
        const p = n.kind === "shape" ? n.fill : n.fill;
        if (p) expect(tac(p.cmyk)).toBeLessThanOrEqual(ctx.profile.tacLimit);
        const box = bleedRect(doc);
        expect(n.bounds.x >= box.x && n.bounds.y >= box.y && n.bounds.x + n.bounds.w <= box.x + box.w && n.bounds.y + n.bounds.h <= box.y + box.h).toBe(true);
      }
      for (const t of texts) if (t.id !== "provenance") expect((t.baseline - doc.layout.baselineOrigin) % doc.layout.baselineUnit).toBe(0);
    }
    // Resampling must almost always find a valid poster.
    expect(failures / N).toBeLessThan(0.01);
  }, 600_000);
});
