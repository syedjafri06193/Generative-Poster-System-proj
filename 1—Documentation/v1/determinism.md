# Determinism

The promise: **the same seed, generator version, grammar version and font set
produce the same poster, byte for byte, on every machine.** The printed
caption (`7f3a-9c21-0e48 · v1.0.0 · poster-grid@1`) and the seed card's QR
code are enough to regenerate the poster.

## How it's kept

| Rule | Where |
|---|---|
| One PRNG, PCG32, checked against the reference vectors | `src/core/prng.ts` |
| Every decision draws from a named sub-stream (`subStream(seed, "palette")`). Adding a decision doesn't shift the others | `subSeed` / `subStream` |
| No platform transcendentals in decision paths. `Math.sin/cos/pow/exp/log/atan2/cbrt` and `**` are approximated differently by different engines | `src/core/detmath.ts` replaces them with exact-operation series |
| Integer geometry in units of 1/1000 pt | `src/core/units.ts` |
| CMYK rounded to 0.1% before it enters the model | `roundCmyk` in `src/color/icc.ts` |
| Colour conversion through lcms (WASM), so every runtime uses the same transform code | `src/color/icc.ts` |
| Shaping through HarfBuzz (WASM), same reason | `src/type/fonts.ts` |
| Resampling after a constraint failure derives from the seed (`resample/N`) | `src/generate.ts` |
| Batch candidates and series members derive from the master or family seed | `score/batch.ts`, `stretch/series.ts` |
| Renderers make no decisions | `render-svg/`, `render-pdf/` |

## How it's checked

- **Lint.** `npm run lint` runs `tools/lint-determinism.mjs`, which fails on banned maths, `**`, `Math.random` or clock reads anywhere outside the renderers. Comments and strings are ignored.
- **Fixtures.** `tests/determinism/fixtures.json` pins the document hash for 24 seeds. The hash covers geometry, glyph IDs and CMYK, not serialised output, so formatting changes can't cause false failures.
- **Browsers.** `npm run test:browser` builds the Studio and checks every fixture hash inside each Playwright browser that's installed. In this environment, Chromium matched Node on 24 of 24 fixtures. CI also installs Firefox and WebKit.
- **Property sweep.** `npm run verify` generates 10,000 seeds and requires every one to satisfy every hard constraint and pass preflight. The last run had 0 failures.
- **Visual goldens.** `tests/visual` catches renderer changes that the hash can't see.

## When a fixture changes

A fixture hash changes only when layout output changes, and that is a breaking change for anyone holding a printed seed. To make one deliberately:

1. Bump `GENERATOR_VERSION` (`src/core/version.ts`) or publish a new grammar version. Never edit an existing grammar file (§6.3).
2. Run `npx tsx scripts/fixtures.ts` to regenerate the fixtures and `UPDATE_GOLDENS=1 npx vitest run tests/visual` to regenerate the goldens.
3. Say so in the changelog.

## Debugging a mismatch

Hash each sub-stream's first draw on both runtimes. The first stream that differs points to the module that introduced platform-dependent behaviour. It's almost always a transcendental the lint missed, such as one in a dependency or one built with `Function`.
