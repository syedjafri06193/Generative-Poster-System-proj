# Grammar reference

A grammar is a JSON file in `v1/src/grammar/grammars/`, registered in
`registry.ts`, and frozen once published. To change one, publish a new
version file (`poster-grid-2.json`), because printed seeds refer to
`name@version` (§6.3). `validateGrammar()` runs at load time.

The fields below are the ones `poster-grid@1` uses.

## `canvas`

| Field | Type | Meaning |
|---|---|---|
| `sizes` | `string[]` | Keys of `PAPER`: `A1 A2 A3 A4 18x24in 11x17in` |
| `press` | `string` | A `PRESS_PROFILES` key, e.g. `fogra39-coated` |

## `grid`

| Field | Type | Meaning |
|---|---|---|
| `systems` | `("column"\|"modular"\|"broken")[]` | `broken` lets ornament bars run into the bleed |
| `columns` | `[min, max]` | Column count |
| `rows` | `[min, max]` | Rows for modular grids |
| `gutterBaselines` | `[min, max]` | Gutter, in baseline units |
| `marginBaselines` | `[min, max]` | Top margin, in baseline units. Others are proportional (§7.2) |
| `baselinePt` | `[min, max]` | Baseline unit, in points |

## `type`

| Field | Type | Meaning |
|---|---|---|
| `families` | `{display, body, caption}[]` | Font refs from `FONT_SPECS` |
| `textRatios` | `number[]` | Modular-scale ratio for text sizes |
| `displayRatios` | `number[]` | Ratio for display sizes above the text scale |
| `maxLevels` | `number` | Hierarchy depth |
| `measureChars` | `[min, max]` | Body measure in characters. A **hard** constraint |
| `bodyLeading` | `[min, max]` | Leading ratio. The result snaps to the baseline grid |
| `headlineMaxLines` | `number` | |

## `palette`

| Field | Type | Meaning |
|---|---|---|
| `strategies` | `string[]` | `monochrome analogous complementary split-complementary triadic tetradic` |
| `lightnessRange`, `chromaRange` | `[min, max]` | OKLCH ranges for accents |
| `colorCount` | `[min, max]` | Number of accents |
| `grounds` | `("light"\|"dark"\|"black")[]` | Weighted by repetition. `black` prints as rich black |
| `minDistance` | `number` | Minimum OKLab ΔE ×100 between palette entries |
| `requireGamutSafe` | `true` | Colours are pulled in by reducing chroma until they print within ΔE 3 |

## `composition`

| Field | Type | Meaning |
|---|---|---|
| `templates` | `string[]` | `headline-top headline-bottom split-field column-stack` |
| `ornaments` | `string[]` | `bars discs blocks rules none` |
| `minWhitespaceRatio` | `number` | |
| `allowRotation` | `false` | Reserved |
| `imagePolicy` | `"none"` | Reserved for image integration (not built) |

## `constraints` and `maxAttempts`

These are the hard constraints from `constraints.ts`: `measure safety-margin
min-stroke tac no-collision contrast baseline-grid inside-media`. A candidate
that violates any of them is resampled from `subSeed(seed, "resample/N")`, up
to `maxAttempts` times. After that, generation throws `GenerationError`. This
happens on 0 of 10,000 seeds for `poster-grid@1`.

## Series

`generateSeries(grammar, familySeed, briefs, ctx)` takes these streams from
the family seed: canvas, grid, grid system, type scale and palette
(`SERIES_SHARED` in `compose.ts`). Layout and ornaments vary per member.
