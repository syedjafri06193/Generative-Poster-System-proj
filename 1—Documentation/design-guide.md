# Generative Poster System — Design & Build Guide

**Project:** Parametric design tool producing seeded, reproducible layouts from a grammar of grids, palettes, and type scales. Exports print-ready SVG and PDF.
**Language:** TypeScript
**Status of this document:** planning + reference

---

## Table of contents

1. [Executive summary and scope](#1-executive-summary-and-scope)
2. [Reality check](#2-reality-check)
3. [The print-ready bar](#3-the-print-ready-bar)
4. [Determinism architecture](#4-determinism-architecture)
5. [The document model](#5-the-document-model)
6. [The grammar](#6-the-grammar)
7. [Grids and layout](#7-grids-and-layout)
8. [Typography](#8-typography)
9. [Color](#9-color)
10. [Scoring and generate-and-filter](#10-scoring-and-generate-and-filter)
11. [The export pipeline](#11-the-export-pipeline)
12. [Tech stack and setup](#12-tech-stack-and-setup)
13. [Repository layout](#13-repository-layout)
14. [Milestone ladder](#14-milestone-ladder)
15. [Reference implementations](#15-reference-implementations)
16. [Testing](#16-testing)
17. [Stretch goals](#17-stretch-goals)
18. [References](#18-references)

---

## 1. Executive summary and scope

### The original statement

> Parametric design tool that produces seeded, reproducible layouts from a grammar of grids, palettes, and type scales. Exports print-ready SVG and PDF.

Four findings reshape this:

1. **"Print-ready SVG" is a category error.** SVG has no CMYK, no spot colors, no output intent, no bleed box, and no overprint. It is a screen format. The print deliverable is **PDF/X-4** (ISO 15930-7), and everything that makes a file print-ready lives in the SVG→PDF gap, not in the SVG. See section 3.
2. **A seed is not a reproducibility guarantee.** JavaScript's `Math.sin`, `Math.pow`, `Math.exp` and friends are explicitly implementation-approximated — V8, JavaScriptCore, and SpiderMonkey can differ in the last bit. If a transcendental result feeds a branch, the same seed produces a different poster on a different browser. And a single linear random stream means adding one `random()` call shifts every downstream decision. See section 4.
3. **Color conversion belongs upstream of the PDF writer, not inside it.** The working approach in every serious print pipeline is: convert to CMYK in your own code, then emit a PDF where every color is *already* CMYK and attach the output intent. Libraries that promise to "convert on export" produce files that fail preflight in specific, hard-to-diagnose ways. See section 11.2.
4. **The single most common PDF/X-4 failure is invisible in the colors.** You can have every fill in DeviceCMYK and a FOGRA39 output intent correctly attached, and still fail validation because the page's **transparency group colorspace defaults to DeviceRGB**. ISO 15930-7 requires it to be consistent with the output intent, and prepress tools reject the file. See section 11.4.

### Revised project statement

> A deterministic parametric poster generator: hierarchically-seeded generation with no platform-dependent arithmetic in decision paths, a grammar over grids/type scales/palettes, a single layout engine emitting an intermediate geometric document model, and two dumb renderers — SVG for screen and a PDF/X-4 writer with upstream CMYK conversion, embedded output intent, bleed and trim boxes, and mechanical conformance validation in CI.

### The defensible niche

Generative tools aren't print-ready and print tools aren't generative. p5.js and Processing target screens. InDesign scripting and `basil.js` target print but need InDesign. Typst and LaTeX are typesetting systems, not design grammars. Generative-art platforms optimize for the browser and the token.

**A tool that produces genuinely press-ready output from a parametric grammar, with a seed you can put on the poster and regenerate from, is a real gap.** That last part — a printed artifact carrying its own reproduction key — is the kind of thing that makes the project memorable.

### Explicit non-goals

- **Not an illustration tool.** No freehand drawing, no node editing. The grammar is the interface.
- **Not a raster pipeline.** Vector output. Raster images are placed, not generated.
- **Not variable data publishing.** One poster at a time, from a seed.
- **Not a font foundry.** You use fonts; you respect their licenses (§8.6).
- **Not PDF/X-1a for v1.** It requires flattening all transparency, which is a separate and unpleasant project. X-4 allows live transparency.

---

## 2. Reality check

### 2.1 Where generative design looks amateur

Worth naming these up front, because they're the difference between "generated" and "designed":

| Symptom | Cause |
|---|---|
| Colors look muddy in print | RGB palette outside CMYK gamut (§9.3) |
| Type feels wrong at every size | Pure geometric scale with no optical correction (§8.2) |
| Text unreadable in long blocks | Measure outside 45–75 characters (§8.3) |
| Margins look uneven though they're equal | No optical alignment / overhang (§8.4) |
| Layout feels arbitrary | No baseline grid (§7.3) |
| Headlines look loose | Display type needs negative tracking (§8.5) |
| Large black areas look washed out | 100K instead of rich black (§3.4) |
| Small text has colored fringes | Rich black used on small text (§3.4) |

Most of these are mechanically checkable, which means they belong in the scoring function (§10) rather than in a style guide nobody reads.

### 2.2 The failure modes

| Failure | Mechanism | Defense |
|---|---|---|
| Same seed, different poster | Transcendental functions differ across engines | Own math for anything feeding a branch (§4.3) |
| Adding a parameter breaks every old seed | Single linear PRNG stream | Hierarchical sub-streams (§4.2) |
| Preview ≠ export | Layout computed twice, in two renderers | One layout engine, dumb renderers (§5) |
| PDF fails preflight | Transparency group colorspace, missing boxes, unembedded fonts | veraPDF in CI (§11.5) |
| Ink doesn't dry / sets off | Total area coverage over limit | TAC check before export (§3.3) |
| Hairlines vanish on press | Line weight below minimum | Minimum stroke enforcement (§3.5) |
| Font can't legally be embedded | EULA restriction | Check the `fsType` bit (§8.6) |
| Colors shift unexpectedly | Out-of-gamut conversion without warning | ΔE reporting on conversion (§9.3) |

---

## 3. The print-ready bar

### 3.1 PDF/X-4 is the target

| Standard | ISO | Transparency | Color | Use |
|---|---|---|---|---|
| PDF/X-1a | 15930-4 | **Must be flattened** | CMYK + spot only, no ICC | Older shops, conservative workflows |
| PDF/X-3 | 15930-6 | Flattened | CMYK, RGB with ICC | Largely superseded |
| **PDF/X-4** | **15930-7** | **Live transparency allowed** | CMYK + spot + ICC-managed | **The modern default** |

PDF/X-4 requirements your writer must satisfy:

- **All fonts embedded** (or text converted to outlines)
- **Output intent** present, with an embedded ICC destination profile
- **TrimBox** defined on every page; **BleedBox** when bleed is used
- **MediaBox ⊇ BleedBox ⊇ TrimBox**
- **No encryption, no JavaScript, no OPI**
- **XMP metadata** declaring PDF/X conformance
- **Transparency blending colorspace consistent with the output intent** ← §11.4
- PDF 1.6 base version

### 3.2 Boxes and bleed

```
┌──────────────────────────────────────┐  MediaBox  (the sheet)
│  ┌────────────────────────────────┐  │
│  │  ┌──────────────────────────┐  │  │  BleedBox  (trim + 3mm)
│  │  │                          │  │  │
│  │  │      ┌────────────┐      │  │  │  TrimBox   (final size)
│  │  │      │            │      │  │  │
│  │  │      │  safety    │      │  │  │  safety margin (5mm in)
│  │  │      │            │      │  │  │
│  │  │      └────────────┘      │  │  │
│  │  │                          │  │  │
│  │  └──────────────────────────┘  │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

| Region | Rule |
|---|---|
| **Bleed** | 3 mm (EU) / 0.125 in (US). Any element touching the trim edge must extend into it. |
| **Safety margin** | 5 mm inside trim. No text or critical content outside it. |
| **Trim** | The final cut size. Cutting has tolerance of a millimetre or two — that's why bleed and safety exist. |

The generator must know all three, and the grammar must place content relative to the trim box while backgrounds extend to bleed.

### 3.3 Total Area Coverage ★

TAC is the sum of C+M+Y+K at any point. Exceed the press limit and ink doesn't dry, sheets set off against each other, and the job gets rejected.

| Stock | Typical TAC limit |
|---|---|
| Coated sheetfed (FOGRA39) | 330% |
| Web offset coated | 300% |
| Uncoated | 240–260% |
| Newsprint | 240% |

**Check every color after conversion, and fail the export if any exceeds the configured limit.** This is a cheap check that prevents an expensive conversation with a printer.

```ts
function totalAreaCoverage(c: CMYK): number {
  return c.c + c.m + c.y + c.k;   // each 0–100
}

function validateTAC(colors: CMYK[], limit: number): Violation[] {
  return colors
    .map((c, i) => ({ i, tac: totalAreaCoverage(c) }))
    .filter(({ tac }) => tac > limit)
    .map(({ i, tac }) => ({ index: i, tac, limit }));
}
```

### 3.4 Black is two different colors ★

This catches everyone once.

**100% K alone** on a large area prints as a washed-out dark grey, because a single ink layer doesn't achieve full density.

**Rich black** adds other inks underneath — a common recipe is 60C 40M 40Y 100K (TAC 240%) — and gives a deep, solid black.

But: **small text must be 100K only.** Press registration isn't perfect, and a four-ink black on 8pt type produces visible colored fringes where the plates misalign. The same misregistration on a large solid field is invisible.

```ts
function resolveBlack(usage: "large_fill" | "text_small" | "text_display",
                      profile: PressProfile): CMYK {
  switch (usage) {
    case "large_fill":
    case "text_display":
      return profile.richBlack;              // e.g. 60/40/40/100
    case "text_small":
      return { c: 0, m: 0, y: 0, k: 100 };   // registration safety
  }
}
```

Make this a property of the document model's fill, not a manual decision — the layout engine knows whether a thing is a headline or body text.

### 3.5 Other press minimums

| Constraint | Value |
|---|---|
| Minimum stroke weight | 0.25 pt (~0.09 mm); below this may drop out |
| Minimum type size for reversed-out text | ~7 pt, and only in a single ink |
| Raster resolution | 300 ppi at final size (1200 ppi for line art) |
| Minimum gap between elements | Enough to survive registration tolerance |

Enforce the stroke minimum in the geometry engine. A generative system that emits 0.05pt hairlines will produce a beautiful screen preview and a poster with missing lines.

---

## 4. Determinism architecture ★

### 4.1 A seed alone is not a reproducible identifier

A seed reproduces a poster only with respect to a **specific generator version**. Change the algorithm, add a parameter, or reorder decisions, and the same seed yields something different.

So the reproducible identifier is a tuple, and it's what goes on the poster:

```ts
interface Provenance {
  seed: string;           // "7f3a-9c21-0e48"
  generatorVersion: string; // "2.4.1"
  grammarVersion: string;   // "poster-grid/3"
  fontSetHash: string;      // fonts affect metrics, so they affect layout
  paletteSetHash: string;
}
```

Print it small in the margin. `7f3a-9c21-0e48 · v2.4.1` is a reproduction key and a nice piece of design honesty.

**Never break an old version.** Keep past generator versions resolvable, so a poster printed last year can be regenerated. That means versioned generator modules, not a mutated one.

### 4.2 Hierarchical seeding ★

With a single linear PRNG stream, everything downstream of an inserted `random()` call shifts. Add one decision to the palette generator and every grid, every type size, every position changes.

Derive independent sub-streams by hashing:

```ts
import { splitmix64 } from "./prng";

/** Deterministic sub-stream derivation. Adding a random() call inside
 *  one subsystem cannot shift any other subsystem's stream. */
function subStream(masterSeed: bigint, path: string): Rng {
  let h = masterSeed;
  for (const ch of path) {
    h = splitmix64(h ^ BigInt(ch.codePointAt(0)!));
  }
  return new Rng(h);
}

const rngGrid    = subStream(master, "grid");
const rngPalette = subStream(master, "palette");
const rngType    = subStream(master, "type/scale");
const rngLayout  = subStream(master, "layout/blocks");
```

Nest the paths for finer isolation — `layout/blocks/3/rotation` gives each element its own stream, so adding a property to element 3 doesn't disturb element 4.

This is the standard technique in procedural generation and it is the difference between a system where seeds stay meaningful and one where every change invalidates the whole back catalogue.

### 4.3 Transcendental functions are not deterministic ★

ECMAScript explicitly permits implementation-approximated results for `Math.sin`, `Math.cos`, `Math.tan`, `Math.pow`, `Math.exp`, `Math.log`, and `Math.atan2`. Different engines — and sometimes different versions of the same engine — differ in the final bit.

For rendering a smooth curve, a one-ULP difference is invisible. **But if that value feeds a comparison, the branch can flip**, and one flipped branch cascades into a completely different layout.

```ts
// DANGEROUS: the comparison can go either way across engines.
if (Math.sin(angle) * radius > threshold) { placeLeft(); } else { placeRight(); }
```

Two rules:

**Rule 1 — no platform math in decision paths.** Anything whose result feeds a comparison, a rounding, or an index must use only IEEE-754-deterministic operations: `+ - * /` and `Math.sqrt` are exact per the spec; `Math.floor`, `Math.round`, `Math.abs` are exact.

**Rule 2 — own your trig.** Where you genuinely need sine, implement a specified polynomial approximation so the result is identical everywhere:

```ts
/** Deterministic sine via a fixed minimax polynomial. Identical on every
 *  engine because it uses only IEEE-754-exact operations. */
export function detSin(x: number): number {
  // range-reduce to [-π, π] using exact arithmetic with a fixed π constant
  const TWO_PI = 6.283185307179586;
  const PI = 3.141592653589793;
  let t = x - TWO_PI * Math.floor((x + PI) / TWO_PI);
  const t2 = t * t;
  // Bhaskara-style / minimax coefficients, fixed and documented
  return t * (1 - t2 * (1 / 6 - t2 * (1 / 120 - t2 / 5040)));
}
```

Accuracy matters less than reproducibility here — a poster doesn't care about the seventh decimal place, but it very much cares about getting the same one twice.

Add a lint rule banning `Math.sin|cos|tan|pow|exp|log` outside an allowlisted rendering module, and a test that asserts a known seed produces a known output hash (§16.1).

### 4.4 The PRNG

`Math.random()` cannot be seeded. Use a small, specified algorithm:

| PRNG | Notes |
|---|---|
| **PCG32** | Excellent statistical quality, small state, well specified. **Recommended.** |
| xoshiro128** | Fast, good quality, 128-bit state |
| sfc32 | Tiny, fast, adequate for visual work |
| Mulberry32 | Simplest; fine for prototyping |

Implement with `BigInt` or explicit `>>> 0` unsigned arithmetic so the integer operations are exact. Pin the implementation and version it — a "fix" to your PRNG is a generator version bump.

---

## 5. The document model ★

### 5.1 Lay out once

The failure mode is obvious in hindsight: the preview renders via the browser's SVG and text layout; the export renders via the PDF writer's text layout. They use different metrics, different shaping, different rounding — and the printed poster differs from what the designer approved.

**Architecture: one layout engine produces an intermediate model. SVG and PDF are both dumb renderers of it.**

```
grammar + seed
      ↓
  generator          ← all decisions happen here
      ↓
  layout engine      ← all geometry and text measurement happens here
      ↓
  Document model     ← pure geometry, resolved color, positioned glyphs
      ↓         ↓
 SVG renderer   PDF/X writer     ← neither makes layout decisions
```

If a renderer has to decide anything about position, size, or line breaking, the architecture is wrong.

### 5.2 The model

```ts
interface Document {
  provenance: Provenance;
  trim: Size;            // in internal units
  bleed: number;
  colorSpace: "cmyk";    // resolved before this point
  outputIntent: string;  // "FOGRA39"
  nodes: Node[];
}

type Node = ShapeNode | GlyphRunNode | ImageNode | GroupNode;

interface ShapeNode {
  kind: "shape";
  path: PathCommand[];   // absolute coordinates only
  fill?: Paint;
  stroke?: { paint: Paint; width: number };  // width ≥ press minimum
  opacity?: number;
}

interface GlyphRunNode {
  kind: "glyphRun";
  fontRef: string;
  sizeUnits: number;
  /** Fully positioned glyphs. No line breaking, no shaping left to do. */
  glyphs: Array<{ glyphId: number; x: number; y: number }>;
  /** Outlines, resolved at layout time, so both renderers agree exactly. */
  outlines?: PathCommand[];
  fill: Paint;
  /** For §3.4 black resolution and accessibility metadata. */
  role: "display" | "body" | "caption";
  text: string;          // retained for PDF ActualText and searchability
}

interface Paint {
  cmyk: CMYK;
  spot?: { name: string; tint: number };
  overprint?: boolean;
}
```

Three properties make this work:

**Absolute coordinates only.** No transforms to compose, no nested coordinate systems for a renderer to get wrong.

**Glyphs positioned, not text to be laid out.** Line breaking and shaping happened in the layout engine. The renderers place glyphs at coordinates.

**Color already resolved to CMYK.** Section 11.2 explains why this must happen upstream.

### 5.3 Internal units

Pick one internal unit and convert only at the edges.

Print math is in points (1 pt = 1/72 in = 0.352778 mm) and millimetres. Floating-point accumulation across thousands of positions produces drift.

**Recommendation: integer units of 1/1000 pt.** All geometry is integer arithmetic — exactly reproducible, no accumulation drift, and 0.001 pt is far below any press tolerance. Convert to points at PDF emission and to user units at SVG emission.

```ts
const UNITS_PER_PT = 1000;
const MM_PER_PT = 0.3527777777777778;

const mm = (v: number) => Math.round((v / MM_PER_PT) * UNITS_PER_PT);
const pt = (v: number) => Math.round(v * UNITS_PER_PT);

// A2 poster
const A2 = { w: mm(420), h: mm(594) };
```

This also removes a whole class of determinism bugs, because integer arithmetic is exact everywhere.

---

## 6. The grammar

### 6.1 Constraints, not randomness

The interesting part of the project is that it's a *grammar*, not a random number generator with a canvas. A grammar is a set of production rules plus constraints, and the generator samples from what the rules allow.

```ts
interface Grammar {
  name: string;
  version: number;

  canvas: { sizes: Size[]; bleed: number };

  grid: {
    systems: GridSystem[];              // modular | column | broken
    columns: Range;                     // e.g. 3-12
    gutterRatio: Range;
    marginRatio: Range;
    baselineUnit: Range;
  };

  type: {
    families: FontSpec[];
    scaleRatios: number[];              // 1.2, 1.25, 1.333, 1.5, 1.618
    stepsAboveBase: Range;
    measureChars: Range;                // 45-75 for body
    maxLevels: number;                  // hierarchy depth
  };

  palette: {
    strategies: PaletteStrategy[];      // mono | analogous | complementary | triadic
    lightnessRange: Range;              // in OKLCH L
    chromaRange: Range;
    colorCount: Range;
    requireGamutSafe: true;
  };

  composition: {
    templates: CompositionRule[];
    minWhitespaceRatio: number;
    allowRotation: boolean;
    imagePolicy: "none" | "optional" | "required";
  };

  constraints: Constraint[];            // hard rules, always enforced
}
```

### 6.2 Hard constraints versus soft preferences

**Hard constraints** are inviolable. The generator rejects and resamples rather than emitting a violation.

```ts
const HARD: Constraint[] = [
  { id: "measure", check: d => bodyMeasure(d) >= 45 && bodyMeasure(d) <= 75 },
  { id: "safety-margin", check: d => allTextInside(d, d.trim, mm(5)) },
  { id: "min-stroke", check: d => minStroke(d) >= pt(0.25) },
  { id: "tac", check: d => maxTAC(d) <= pressProfile.tacLimit },
  { id: "no-collision", check: d => !hasOverlappingText(d) },
  { id: "contrast", check: d => minTextContrast(d) >= 4.5 },
];
```

**Soft preferences** feed the scoring function (§10) and shape which candidates surface, without rejecting anything.

The distinction matters: a hard constraint that's really a preference makes the system unable to produce interesting results; a preference that should be hard produces unusable posters.

### 6.3 Grammars are versioned artifacts

A grammar is data, versioned alongside the generator. Changing `scaleRatios` changes every poster that grammar ever produced. So grammars are immutable once published, and edits create a new version — the same discipline as pinning a rule set in any system where old outputs must stay reproducible.

---

## 7. Grids and layout

### 7.1 Systems

| System | Description | Good for |
|---|---|---|
| **Column** | N equal columns with gutters | Text-heavy posters |
| **Modular** | Columns × rows → modules | Complex, image-and-text |
| **Hierarchical** | Irregular regions from content | Expressive, harder to generate well |
| **Broken** | A base grid with deliberate violations | Contemporary; needs the base to be legible first |

The broken grid is the one worth being careful with: it only reads as intentional if the underlying grid is strong enough to be perceived. A violated grid that was never visible just looks like a mistake.

### 7.2 Margins from the grid

Derive margins from the grid unit rather than choosing them independently. Classic proportional systems (Van de Graaf, the 2:3:4:6 relationship) exist because they produce margins that feel resolved.

```ts
function margins(size: Size, unit: number, ratio: MarginRatio): Margins {
  // Asymmetric margins read as more considered than equal ones.
  const top = unit * ratio.top;
  return {
    top,
    inner: top * 1.0,
    outer: top * 1.5,
    bottom: top * 2.0,   // optical centering: more space below
  };
}
```

The bottom-heavier margin is the optical centering point from §7.4 — geometric centering looks low, so the visual centre sits above the geometric one.

### 7.3 The baseline grid ★

Aligning every text baseline to a common rhythm is the single most effective mechanical intervention for making a layout look professional.

```ts
function snapToBaseline(y: number, baselineUnit: number, origin: number): number {
  return origin + Math.round((y - origin) / baselineUnit) * baselineUnit;
}
```

For this to work, **leading must be an integer multiple of the baseline unit.** So the type scale and the baseline unit have to be designed together — pick the baseline unit first, then constrain leading values to multiples of it.

```ts
function leadingOnGrid(fontSize: number, targetRatio: number, unit: number): number {
  const target = fontSize * targetRatio;
  return Math.max(unit, Math.round(target / unit) * unit);
}
```

This is also a cheap scoring signal: the fraction of baselines that land on the grid is a direct measure of typographic discipline.

### 7.4 Optical centering

The geometric centre looks too low. The optical centre sits roughly 5% above it — which is why picture framing and classical page design have always used a larger bottom margin.

```ts
const opticalCenterY = (h: number) => h * 0.45;
```

### 7.5 Whitespace as a measured quantity

Whitespace isn't leftover; it's a compositional element. Measure it:

```ts
interface WhitespaceMetrics {
  ratio: number;            // empty area / total
  largestVoid: Rect;        // biggest empty rectangle
  distribution: number;     // variance of emptiness across a coarse cell grid
  edgeBreathing: number;    // min distance from content to trim
}
```

Even distribution isn't always the goal — a large deliberate void against dense content is a strong composition. But *unintentionally* uneven distribution is the signature of a random layout, and the variance metric distinguishes them when combined with the largest-void measure.

---

## 8. Typography

### 8.1 Real metrics, measured once

You cannot lay out text without the font's actual metrics, and the metrics used for preview must be the metrics used for export — otherwise §5.1's problem returns.

Read metrics directly from the font tables with `fontkit` or `opentype.js`: units per em, ascender, descender, cap height, x-height, glyph advances, and kerning pairs.

For correct kerning, ligatures, and any non-Latin script, shape with **HarfBuzz** (`harfbuzzjs`, a WASM build). Naively summing advance widths gets Latin approximately right and Arabic or Devanagari completely wrong.

### 8.2 Modular scales, with correction

```ts
function modularScale(base: number, ratio: number, step: number): number {
  return base * Math.pow(ratio, step);   // rendering-only; see §4.3
}
```

| Ratio | Name |
|---|---|
| 1.125 | Major second |
| 1.200 | Minor third |
| 1.250 | Major third |
| 1.333 | Perfect fourth |
| 1.414 | Augmented fourth |
| 1.500 | Perfect fifth |
| 1.618 | Golden |

Two corrections a naive implementation misses:

**Round to sensible sizes.** A pure scale gives 11.239pt. Round to a quarter point, and to the baseline grid where leading is concerned.

**Large ratios collapse the middle.** At 1.618 with a 16pt base you get 16, 26, 42, 68 — nothing usable between body and headline. Either use a smaller ratio, or use a two-ratio system: tight for text sizes, loose for display.

### 8.3 Measure is a hard constraint

45–75 characters per line for continuous text; 66 is the classic target. Outside that range, reading breaks down — too short and the eye jumps too often, too long and it loses the line return.

```ts
function measureChars(columnWidth: number, fontSize: number, avgCharWidth: number): number {
  return columnWidth / (fontSize * avgCharWidth);
}
```

Estimate average character width from the font's actual advances over a representative sample, not from a constant. It varies substantially between a condensed grotesk and a wide serif.

**And leading must grow with measure.** A 75-character line needs more leading than a 50-character one to hold the line return. A system that uses a fixed 1.5 ratio regardless of measure produces text that's too tight when wide and too loose when narrow.

### 8.4 Optical alignment ★

This is the detail that separates typeset from placed.

Punctuation and round letterforms need to **hang outside the margin** to look aligned. A left-aligned paragraph starting with a quotation mark looks indented unless the quote overhangs. A capital O looks inset unless it overshoots slightly.

```ts
const OVERHANG: Record<string, number> = {
  '"': 0.35, "'": 0.35, "“": 0.35, "”": 0.35, "‘": 0.35, "’": 0.35,
  ",": 0.25, ".": 0.25, "-": 0.30, "–": 0.30, "—": 0.30,
  "A": 0.02, "T": 0.02, "V": 0.03, "W": 0.03, "Y": 0.03,
  "O": 0.01, "C": 0.01, "G": 0.01, "Q": 0.01,
};

function opticalOffset(ch: string, fontSize: number): number {
  return -(OVERHANG[ch] ?? 0) * fontSize;
}
```

Almost nothing automates this, which is exactly why generative typography reads as slightly off even when everything else is right. It's maybe forty lines of code and it's one of the highest-leverage things in the project.

### 8.5 Tracking by size

Display type needs tightening; small type needs opening. A single tracking value across all sizes is wrong at both ends.

```ts
function opticalTracking(fontSize: number): number {
  // Returns tracking in em units.
  if (fontSize >= pt(48)) return -0.02;
  if (fontSize >= pt(24)) return -0.01;
  if (fontSize <= pt(9))  return  0.02;
  return 0;
}
```

If the font has an `opsz` variable axis, use it — that's the typographically correct mechanism, and tracking is the approximation you use when it isn't available.

### 8.6 Font licensing and the `fsType` bit ★

Embedding a font in a PDF requires the license to permit it. Many commercial fonts restrict or prohibit it, and — importantly — **converting text to outlines is also considered embedding under most EULAs.** "I outlined it" is not a workaround.

The font declares its intent in the `OS/2` table's `fsType` field, and you can check it:

```ts
const FS_TYPE = {
  INSTALLABLE:   0x0000,
  RESTRICTED:    0x0002,   // no embedding at all
  PREVIEW_PRINT: 0x0004,   // embed for viewing/printing, not editing
  EDITABLE:      0x0008,
  NO_SUBSET:     0x0100,
  BITMAP_ONLY:   0x0200,
};

function canEmbed(font: Font): { ok: boolean; reason?: string } {
  const t = font.fsType ?? 0;
  if (t & FS_TYPE.RESTRICTED) {
    return { ok: false, reason: "font's fsType forbids embedding" };
  }
  return { ok: true };
}
```

`fsType` is the font's machine-readable statement of intent, not a legal determination — check the actual EULA for anything commercial. But refusing to export when the bit says no is the right default, and it will catch the obvious cases.

**Outlines versus embedded live text:** outlines guarantee fidelity with no substitution risk and no font dependency at the printer, at the cost of file size and searchability. For posters, outlines are usually correct. Retain the source text as PDF `ActualText` so the content remains extractable and accessible.

---

## 9. Color

### 9.1 Work in OKLCH

HSL is a trap. Yellow at L=50% and blue at L=50% have wildly different perceived lightness, so an HSL palette with "constant lightness" isn't. Every generative palette built on HSL inherits this.

**OKLCH is perceptually uniform**: equal L means equal perceived lightness, and equal C means equal perceived chroma. A palette generated with constant L actually looks like one.

```ts
import { oklch, converter, differenceEuclidean } from "culori";

function analogous(baseHue: number, count: number, L: number, C: number) {
  const spread = 30;
  return Array.from({ length: count }, (_, i) => ({
    mode: "oklch" as const,
    l: L,
    c: C,
    h: (baseHue + (i - (count - 1) / 2) * spread + 360) % 360,
  }));
}
```

### 9.2 Palette strategies

| Strategy | Construction |
|---|---|
| Monochrome | One hue, vary L and C |
| Analogous | Adjacent hues, ±30° |
| Complementary | Base and +180° |
| Split complementary | Base, +150°, +210° |
| Triadic | 0°, 120°, 240° |
| Tetradic | 0°, 90°, 180°, 270° |

Constrain L and C ranges in the grammar so the palette holds together. Then enforce a minimum perceptual distance between any two colors, or you'll generate palettes where two entries are indistinguishable.

### 9.3 Gamut and conversion ★

**Many saturated RGB colors do not exist in CMYK.** Bright oranges, pure greens, and vivid blues are the usual casualties. A palette that sings on screen goes muddy on paper, and this is the single biggest surprise for anyone moving from screen to print.

Convert through an ICC profile with Little CMS (`lcms2` via WASM), and **measure how far each color moved**:

```ts
interface ConversionReport {
  source: Oklch;
  cmyk: CMYK;
  roundTrip: Oklch;      // CMYK back to OKLCH via the same profile
  deltaE: number;        // perceptual distance moved
  inGamut: boolean;
  tac: number;
}

function assess(c: Oklch, profile: IccProfile): ConversionReport {
  const cmyk = toCmyk(c, profile, { intent: "relative_colorimetric" });
  const back = fromCmyk(cmyk, profile);
  const dE = deltaEOK(c, back);
  return { source: c, cmyk, roundTrip: back, deltaE: dE,
           inGamut: dE < 2, tac: totalAreaCoverage(cmyk) };
}
```

Rules of thumb for ΔE: below 1 is imperceptible, 1–2 is noticeable on close inspection, above 5 is obviously a different color.

**Make gamut safety a hard grammar constraint** (`requireGamutSafe: true` in §6.1). Generate the palette in OKLCH, test it against the press profile, and resample anything that moves more than a few ΔE. This means every poster the system produces looks the same on screen and on paper — which is a genuinely valuable property and something most generative tools don't offer.

**Rendering intent:** relative colorimetric with black point compensation for most design work; perceptual for photographic content where preserving relationships matters more than exact values.

### 9.4 Spot colors

If the brief allows two-color printing, spot colors give you vividness CMYK can't reach and are often cheaper. PDF/X-4 supports them as Separation color spaces with a tint transform into the alternate space.

Worth supporting in the document model (`Paint.spot` in §5.2) even if v1 doesn't generate them — retrofitting a color model is painful.

---

## 10. Scoring and generate-and-filter

### 10.1 Generate many, show few

Random parameters produce mostly mediocre output. The practical approach is to generate a large candidate set, score it, and surface the top handful.

```ts
function generateBatch(grammar: Grammar, masterSeed: bigint, n: number): Scored[] {
  const out: Scored[] = [];
  for (let i = 0; i < n; i++) {
    const seed = subStream(masterSeed, `candidate/${i}`).nextBigInt();
    const doc = generate(grammar, seed);
    if (!satisfiesHardConstraints(doc, grammar)) continue;   // §6.2
    out.push({ doc, seed, score: score(doc) });
  }
  return out.sort((a, b) => b.score.total - a.score.total);
}
```

Generating 500 candidates and showing 12 is a completely different experience from generating one and hitting refresh.

### 10.2 Mechanical aesthetic heuristics

You can't score "good design," but several proxies are real and computable:

```ts
interface Score {
  baselineAdherence: number;   // fraction of baselines on grid (§7.3)
  whitespaceBalance: number;   // from §7.5 distribution variance
  alignmentConsistency: number;// count of distinct alignment edges — fewer is better
  hierarchyClarity: number;    // size ratios between levels are distinct enough
  contrastRange: number;       // spread of L values in use
  opticalBalance: number;      // center of visual mass vs optical center (§7.4)
  densityVariation: number;    // ink coverage variance across the canvas
  total: number;               // weighted
}
```

**Alignment consistency deserves emphasis.** Count the distinct x-positions where elements align. A layout with four alignment edges reads as composed; one with seventeen reads as scattered. It's a single number and it correlates strongly with whether a layout looks designed.

### 10.3 Tune the weights against human judgement

The weights are the aesthetic. Get them from data rather than intuition:

1. Generate a few hundred candidates
2. Present pairs and record which is preferred
3. Fit weights that maximize agreement with the preferences

A few hundred pairwise comparisons is an afternoon and produces a scoring function that reflects an actual sensibility rather than guesses. Treat the fitted weights as a versioned artifact alongside the grammar.

---

## 11. The export pipeline

### 11.1 SVG is the screen format

Be explicit in the docs: SVG is for preview, web, and further editing. It has no CMYK, no spot colors, no output intent, no bleed box, no overprint. Calling it print-ready is the category error from §1.

That said, SVG export should be good: clean structure, sensible IDs, real grouping, and — since colors are already CMYK in the model — an sRGB rendering of them for display, with the CMYK values preserved in a data attribute so nothing is lost on a round trip.

### 11.2 Convert color upstream, not in the writer ★

The pattern that works in every serious print pipeline: **all color conversion happens before the PDF writer runs.** By the time a page object is constructed, every fill is already DeviceCMYK. The writer's only color job is attaching the output intent.

The alternative — letting a library or Ghostscript "convert on export" — produces files that fail preflight in ways that are hard to diagnose, because the conversion happens inside a black box with its own assumptions about intent and black generation.

This is also why §5.2's `Paint` carries resolved CMYK: the document model is already in press color space.

### 11.3 PDF/X-4 structure

```ts
interface PdfXOptions {
  standard: "PDF/X-4";
  outputIntent: { profile: Uint8Array; identifier: string; info: string };
  trimBox: Rect;
  bleedBox: Rect;
  mediaBox: Rect;
  embedFonts: boolean;
  outlineText: boolean;
  title: string;
  xmp: XmpMetadata;
}
```

The writer must emit:

- `/OutputIntents` array with one entry, `/S /GTS_PDFX`, and `/DestOutputProfile` pointing at the embedded ICC stream
- `/TrimBox` and `/BleedBox` on every page
- XMP with `pdfxid:GTS_PDFXVersion` set to `PDF/X-4`
- Font programs embedded, or glyph outlines as paths
- No `/Encrypt`, no `/JavaScript`, no `/OPI`

### 11.4 The transparency group trap ★

**This is the failure that catches people who did everything else right.**

You can have every fill in DeviceCMYK, a FOGRA39 profile correctly embedded as the output intent, and correct boxes — and still fail PDF/X-4 validation, because the page's transparency group colorspace defaults to DeviceRGB.

ISO 15930-7 requires the transparency blending colorspace to be consistent with the output intent. DeviceRGB blending with a CMYK output intent is a violation, and prepress tools flag it. It's invisible if you only look at colors, because the colors genuinely are CMYK.

The fix is to set `/Group << /S /Transparency /CS /DeviceCMYK >>` on every page **and on every Form XObject that has a group**:

```ts
function setBlendingColorspace(pdf: PdfDocument): void {
  for (const page of pdf.pages) {
    if (page.has("/Group")) {
      page.get("/Group").set("/CS", Name("DeviceCMYK"));
    }
  }
  // Form XObjects with their own groups need it too — easy to miss.
  for (const obj of pdf.objects) {
    if (obj.isStream() && obj.get("/Subtype") === "Form" && obj.has("/Group")) {
      obj.get("/Group").set("/CS", Name("DeviceCMYK"));
    }
  }
}
```

If you're writing the PDF yourself, set it at construction. If you're post-processing a library's output, this is a patch step — and it should be a named, tested function rather than a line buried somewhere, because it will be the first thing to check when a printer rejects a file.

### 11.5 Validate mechanically ★

"Print-ready" is a claim that must be verified by a tool, not asserted by the developer.

**veraPDF** is the open-source validator for PDF/A and PDF/X conformance, actively maintained, available as a CLI and a Java library. Run it in CI on every export fixture.

```bash
verapdf --flavour 4 --format text output.pdf
```

Layer two levels of checking, because they catch different things:

**Preflight checks** — your own, fast, catching what shops actually reject files over:

```ts
interface PreflightReport {
  boxesPresent: boolean;          // TrimBox, BleedBox on every page
  boxNesting: boolean;            // MediaBox ⊇ BleedBox ⊇ TrimBox
  allFontsEmbedded: boolean;
  colorSpacesOnly: string[];      // must be ⊆ {DeviceCMYK, Separation}
  outputIntentPresent: boolean;
  maxTAC: number;
  minStrokeWidth: number;
  minRasterPpi: number;
  pdfVersion: string;
}
```

**Formal validation** — veraPDF, catching the structural conformance issues (like §11.4) that homegrown checks miss.

Running the six-check preflight is not the same as validating conformance. Do both, and gate the build on both.

### 11.6 Proofing

A screen preview is not a proof. Two things worth building:

**Soft proof** — render the CMYK values back through the profile to sRGB for on-screen display, so the preview shows what will print rather than the original RGB.

**Ink coverage map** — a heatmap of TAC across the poster. Makes the §3.3 problem visible before export rather than as an error afterward.

---

## 12. Tech stack and setup

| Layer | Choice | Why |
|---|---|---|
| **Language** | TypeScript | UI-heavy tool, one language throughout, and determinism is achievable with discipline |
| **Fonts — metrics/outlines** | `fontkit` or `opentype.js` | Real metrics, glyph outlines, `fsType` |
| **Fonts — shaping** | `harfbuzzjs` (WASM) | Correct kerning, ligatures, non-Latin |
| **Color** | `culori` | OKLCH, conversions, ΔE |
| **ICC** | `lcms2` via WASM | Profile-based CMYK conversion |
| **PDF** | Hand-written writer, or `pdf-lib` + a patch step | See below |
| **Validation** | **veraPDF** in CI | Mechanical conformance |
| **PRNG** | Own PCG32 | Pinned and versioned |
| **UI** | React + SVG preview | |
| **Testing** | Vitest + a snapshot-hash harness | |

**On the PDF writer.** A generative poster's PDF content is simple: paths, fills, and glyph outlines. Writing a minimal, purpose-built PDF/X-4 writer is genuinely reasonable — maybe 1,500 lines — and gives you exact control over the structures in §11.3 and §11.4 rather than fighting a general-purpose library's assumptions. `pdf-lib` plus a documented patch step is the faster path to a first working export; plan to replace it if you hit conformance friction.

Ghostscript can convert to PDF/X-3 with output-intent embedding and is worth knowing about, but per §11.2 you don't want it doing your color conversion, and its PDF/X-4 story is less clean than building the file correctly in the first place.

**ICC profiles:** get FOGRA39 (European coated) and GRACoL (US coated) from the ECI and IDEAlliance respectively. They're free. Check the redistribution terms before bundling them.

---

## 13. Repository layout

```
Generative-Poster-System/
├── README.md
├── docs/
│   ├── design.md               ← this document
│   ├── print-spec.md           ← ★ size, bleed, profile, TAC, standard
│   ├── grammar-reference.md
│   └── determinism.md          ← ★ the §4 rules, for contributors
├── packages/
│   ├── core/
│   │   ├── prng/               ← PCG32, pinned and versioned
│   │   ├── detmath/            ← ★ deterministic trig (§4.3)
│   │   ├── units.ts            ← integer 1/1000 pt (§5.3)
│   │   └── provenance.ts
│   ├── model/                  ← the Document model (§5.2)
│   ├── grammar/
│   │   ├── schema.ts
│   │   ├── constraints.ts
│   │   └── grammars/           ← versioned, immutable once published
│   ├── layout/                 ← ★ the ONLY place geometry is decided
│   │   ├── grid.ts
│   │   ├── baseline.ts
│   │   ├── compose.ts
│   │   └── collide.ts
│   ├── type/
│   │   ├── metrics.ts
│   │   ├── shape.ts            ← harfbuzz
│   │   ├── scale.ts
│   │   ├── optical.ts          ← ★ overhang and tracking (§8.4, §8.5)
│   │   └── licensing.ts        ← fsType check
│   ├── color/
│   │   ├── oklch.ts
│   │   ├── palette.ts
│   │   ├── icc.ts              ← lcms2
│   │   └── gamut.ts            ← ΔE + TAC reporting
│   ├── score/
│   ├── render-svg/             ← dumb renderer
│   └── render-pdf/
│       ├── writer.ts
│       ├── outputintent.ts
│       ├── transparency.ts     ← ★ §11.4
│       └── preflight.ts
├── apps/studio/                ← the UI
├── profiles/                   ← FOGRA39, GRACoL
└── tests/
    ├── determinism/            ← ★ seed → hash fixtures
    ├── conformance/            ← veraPDF fixtures
    └── golden/
```

---

## 14. Milestone ladder

### M0 — Print specification ★ **before any code**
**Est. 3–4 days**

Write `docs/print-spec.md`: sizes, bleed, safety margin, target standard, ICC profile, TAC limit, rich black recipe, minimum stroke, minimum type size.

Call an actual printer and ask what they want. Twenty minutes on the phone will save weeks, and the answer differs by shop.

**Done when:** a printer has confirmed the spec.

---

### M1 — Deterministic core ★
**Est. 1 week**

PCG32, hierarchical sub-streams, deterministic trig, integer units, provenance tuple. Plus the lint rule banning platform `Math.*` outside rendering and the seed→hash test harness.

**Done when:** the same seed produces an identical document hash in Node, Chrome, Firefox, and Safari.

---

### M2 — Document model and SVG renderer
**Est. 1 week**

The model, a dumb SVG renderer, and a hand-built test document.

**Done when:** the renderer contains no layout decisions — verifiable by reading it.

---

### M3 — Grid and layout engine
**Est. 2 weeks**

Grid systems, margins, baseline snapping, collision detection, whitespace metrics.

**Done when:** baseline adherence is measurable and above 95% on generated layouts.

---

### M4 — Type engine ★
**Est. 2.5 weeks**

Font loading and metrics, HarfBuzz shaping, modular scales with rounding, measure constraints, leading on grid, optical overhang, size-dependent tracking, `fsType` checking.

**The optical overhang work is small and disproportionately valuable.** It's the difference between placed text and typeset text.

---

### M5 — Color engine
**Est. 1.5 weeks**

OKLCH palettes, strategies, ICC conversion with lcms2, gamut assessment with ΔE, TAC checking, rich-black resolution by role.

**Done when:** a generated palette round-trips through FOGRA39 with ΔE below 3 on every color, and TAC never exceeds the limit.

---

### M6 — The grammar
**Est. 1.5 weeks**

Schema, hard constraints with resampling, versioned grammar files, one complete poster grammar.

**Done when:** every generated poster satisfies every hard constraint, verified over 10,000 seeds.

---

### M7 — PDF/X-4 writer ★
**Est. 2.5 weeks**

The writer, output intent, boxes, font embedding or outlining, transparency group colorspace, XMP.

**Done when:** an exported file opens correctly in Acrobat with the PDF/X indicator showing.

---

### M8 — Conformance validation ★
**Est. 1 week**

Preflight checks, veraPDF in CI, fixture corpus covering the edge cases.

**"Print-ready" is a claim that must be mechanically verified.** Until this milestone, the project doesn't get to make it.

**Done when:** CI fails on any export that doesn't pass veraPDF PDF/X-4 validation.

---

### M9 — Scoring and batch generation
**Est. 1.5 weeks**

Heuristics, generate-and-filter, pairwise weight tuning.

---

### M10 — Studio UI
**Est. 3 weeks**

Parameter controls, live preview, batch grid, soft proof, ink coverage map, seed entry and export.

---

### M11 — A real print run
**Est. ongoing**

**Actually print a poster.** At size, on the intended stock, at a real shop.

Nothing in this document substitutes for holding the output. You will discover something — a color that's flatter than expected, type that's lighter at size, a hairline that vanished — that no amount of soft proofing predicted.

---

## 15. Reference implementations

### 15.1 PCG32

```ts
export class Rng {
  private state: bigint;
  private readonly inc: bigint;

  constructor(seed: bigint, seq: bigint = 1n) {
    this.state = 0n;
    this.inc = ((seq << 1n) | 1n) & 0xFFFFFFFFFFFFFFFFn;
    this.next();
    this.state = (this.state + seed) & 0xFFFFFFFFFFFFFFFFn;
    this.next();
  }

  /** uint32. Only exact integer ops — identical on every platform. */
  next(): number {
    const old = this.state;
    this.state = (old * 6364136223846793005n + this.inc) & 0xFFFFFFFFFFFFFFFFn;
    const xorshifted = Number(((old >> 18n) ^ old) >> 27n & 0xFFFFFFFFn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0;
  }

  float(): number { return this.next() / 0x100000000; }
  int(min: number, max: number): number {
    return min + (this.next() % (max - min + 1));
  }
  pick<T>(xs: readonly T[]): T { return xs[this.next() % xs.length]; }
}
```

### 15.2 Measure and leading together

```ts
function bodyTextParams(
  columnWidth: number, font: FontMetrics, baselineUnit: number,
  targetMeasure = 66
): { fontSize: number; leading: number; measure: number } {

  const avgAdvance = font.averageAdvanceEm;            // measured, not guessed
  let fontSize = columnWidth / (targetMeasure * avgAdvance);
  fontSize = Math.round(fontSize * 4) / 4;             // quarter-point

  const measure = columnWidth / (fontSize * avgAdvance);

  // Leading grows with measure — a wide column needs a stronger line return.
  const ratio = 1.35 + (measure - 45) * 0.006;         // ~1.35 at 45ch, ~1.53 at 75ch
  const leading = leadingOnGrid(fontSize, ratio, baselineUnit);

  return { fontSize, leading, measure };
}
```

### 15.3 Preflight

```ts
export function preflight(doc: Document, press: PressProfile): PreflightIssue[] {
  const issues: PreflightIssue[] = [];

  const tac = maxTAC(doc);
  if (tac > press.tacLimit) {
    issues.push({ severity: "error", code: "TAC_EXCEEDED",
      message: `Max TAC ${tac}% exceeds limit ${press.tacLimit}%` });
  }

  const thin = doc.nodes.filter(n => n.kind === "shape" && n.stroke
                                  && n.stroke.width < press.minStroke);
  if (thin.length) {
    issues.push({ severity: "error", code: "HAIRLINE",
      message: `${thin.length} stroke(s) below ${press.minStroke / 1000}pt` });
  }

  for (const n of doc.nodes) {
    if (n.kind === "glyphRun" && n.role !== "display"
        && n.sizeUnits < pt(12) && isRichBlack(n.fill.cmyk)) {
      issues.push({ severity: "error", code: "RICH_BLACK_SMALL_TEXT",
        message: "Small text must be 100K only — registration risk" });
    }
  }

  if (!allTextInside(doc, doc.trim, press.safetyMargin)) {
    issues.push({ severity: "warning", code: "OUTSIDE_SAFETY",
      message: "Text outside the safety margin may be trimmed" });
  }
  return issues;
}
```

---

## 16. Testing

### 16.1 Determinism fixtures ★

```ts
const FIXTURES = [
  { seed: "7f3a9c210e48", grammar: "poster-grid@3", hash: "a4f2…" },
  // …a few dozen
];

test.each(FIXTURES)("seed $seed reproduces exactly", ({ seed, grammar, hash }) => {
  const doc = generate(loadGrammar(grammar), BigInt("0x" + seed));
  expect(hashDocument(doc)).toBe(hash);
});
```

Hash the geometry — coordinates, glyph IDs, CMYK values — not the serialized output, so formatting changes don't produce false failures.

**Run this on every platform in CI**: Node, and headless Chrome, Firefox, and WebKit. It's the only thing that will catch a transcendental sneaking into a decision path.

### 16.2 The lint rule

```js
// eslint: no platform math outside the allowlisted rendering module
"no-restricted-properties": ["error",
  ...["sin","cos","tan","pow","exp","log","atan2"].map(p => ({
    object: "Math", property: p,
    message: "Platform Math is not bit-identical across engines. " +
             "Use @poster/detmath. See docs/determinism.md §4.3.",
  })),
]
```

The error message pointing at the doc is the part that makes the rule teach rather than annoy.

### 16.3 Conformance fixtures

A corpus covering: text-only, transparency, spot color, images, maximum TAC, minimum stroke, all page sizes. Every one must pass veraPDF PDF/X-4 validation in CI.

### 16.4 Property tests

- Every generated document satisfies every hard constraint, over thousands of seeds
- Every baseline lands on the grid
- No two text nodes overlap
- Every color is in gamut and under the TAC limit
- All geometry lies within the media box
- `hash(generate(s)) === hash(generate(s))` — trivially, but it catches accidental global state

### 16.5 Visual regression

Render fixture posters to PNG and compare against approved images. Catches changes that don't alter the document hash — a renderer bug, a font update, a color pipeline change.

---

## 17. Stretch goals

| Feature | Effort | Value |
|---|---|---|
| **Variable fonts** | Medium | Weight and width as continuous parameters; `opsz` for correct optical sizing |
| **Spot color generation** | Medium | Two-color posters; often cheaper and more vivid than CMYK |
| **Grammar editor UI** | Large | Non-programmers author grammars |
| **Image integration** | Medium | Placed images with automatic crop, palette extraction, and resolution checking |
| **Series generation** | Medium | N related posters from one seed family — very strong for exhibitions |
| **Animated preview** | Small | Watch the generator make decisions. Excellent for demos and debugging. |
| **Risograph mode** | Medium | Spot-color separations as individual layers, with misregistration simulation |
| **Large-format tiling** | Small | Billboards printed in panels with overlap |
| **CSS Paged Media output** | Medium | A third renderer for web-to-print |
| **Physical seed cards** | Small | Print the provenance tuple as a scannable code. The poster reproduces itself. |

That last one is worth taking seriously. A printed artifact carrying its own regeneration key closes a nice conceptual loop, and it's a small amount of work on top of §4.1.

---

## 18. References

### Print production

| Source | For |
|---|---|
| **ISO 15930-7** (PDF/X-4) | The conformance target |
| ISO 15930-4 (PDF/X-1a) | If a shop insists on the older standard |
| **veraPDF** documentation and validation profiles | Mechanical conformance checking |
| ISO 32000-1 §7.3.6 (Page Group) | The transparency group structure behind §11.4 |
| ECI (FOGRA profiles), IDEAlliance (GRACoL) | Free ICC profiles |
| Little CMS (`lcms2`) documentation | ICC conversion, rendering intents |

### Typography

- **Bringhurst**, *The Elements of Typographic Style* — measure, scale, and the proportional systems in §7.2
- **Müller-Brockmann**, *Grid Systems in Graphic Design* — the grid vocabulary this grammar encodes
- **Hochuli**, *Detail in Typography* — optical alignment, spacing, the §8.4 material
- **Tschichold**, *The Form of the Book* — classical margin proportions
- OpenType specification, `OS/2` table — the `fsType` field in §8.6
- HarfBuzz documentation — shaping

### Color

- **Björn Ottosson**, "A perceptual color space for image processing" — the OKLab/OKLCH derivation
- `culori` documentation — conversions and difference metrics
- CIE ΔE2000 and ΔEOK — perceptual difference

### Generative design

- **Vera Molnár**, **Muriel Cooper**, **Karl Gerstner** (*Designing Programmes*) — the intellectual lineage, and Gerstner in particular is essentially a grammar-based design system from 1964
- **Bohnacker et al.**, *Generative Design* — techniques
- Procedural generation literature on hierarchical seeding (§4.2)

---

## Appendix A — Decision record

| Decision | Rationale |
|---|---|
| **PDF/X-4 is the print deliverable; SVG is the screen format** | SVG has no CMYK, spot colors, output intent, bleed box, or overprint. "Print-ready SVG" is a category error. |
| PDF/X-4 over X-1a | X-1a requires flattening all transparency, which is a separate project |
| **Color converted upstream of the PDF writer** | Every serious print pipeline does this. Libraries converting "on export" fail preflight in hard-to-diagnose ways. |
| **Transparency group colorspace set to DeviceCMYK explicitly** | The most common invisible PDF/X-4 failure — all colors CMYK, output intent correct, still rejected |
| **veraPDF in CI, plus own preflight** | Preflight catches what shops reject files over; formal validation catches structural conformance. They're different. |
| TAC checked and enforced before export | Over-limit ink doesn't dry and the job gets rejected |
| Rich black for large fills, 100K for small text | Single-ink black looks washed on large areas; four-ink black on small type shows registration fringes |
| Minimum stroke enforced in the geometry engine | A 0.05pt hairline previews beautifully and vanishes on press |
| **Provenance is (seed, generator version, grammar version, font hash)** | A seed alone is meaningless — the same seed on a changed generator yields a different poster |
| Past generator versions kept resolvable | A poster printed last year must still regenerate |
| **Hierarchical sub-streams, not one linear PRNG** | Inserting one random() call in a linear stream shifts every downstream decision and invalidates the back catalogue |
| **No platform `Math.sin/cos/pow/exp/log` in decision paths** | ECMAScript permits implementation-approximated results; a last-bit difference can flip a branch and cascade |
| Own deterministic trig, lint-enforced | Reproducibility matters more than the seventh decimal place |
| Integer units of 1/1000 pt | Exact arithmetic everywhere, no accumulation drift, far below press tolerance |
| **One layout engine; SVG and PDF are dumb renderers** | Laying out twice means the printed poster differs from the approved preview |
| Glyphs positioned at layout time, not text to be laid out | Removes any chance of the two renderers shaping differently |
| **OKLCH as the working color space** | HSL lightness is perceptually meaningless — L=50% yellow and blue look nothing alike |
| Gamut safety as a hard grammar constraint, with ΔE reported | Saturated RGB goes muddy in CMYK; enforcing it means screen and paper match |
| **Measure (45–75ch) as a hard constraint, leading growing with measure** | Fixed leading ratios are too tight when wide and too loose when narrow |
| Optical overhang implemented | Forty lines of code, and the main reason generative typography reads as slightly off |
| Size-dependent tracking, or `opsz` where available | One tracking value is wrong at both ends of the scale |
| **`fsType` checked before embedding or outlining** | Outlining is also embedding under most EULAs; the bit is the font's machine-readable intent |
| Text outlined by default, `ActualText` retained | Fidelity with no substitution risk, while staying extractable |
| Hard constraints resample; soft preferences feed scoring | A preference treated as hard kills variety; a constraint treated as soft ships unusable posters |
| Grammars versioned and immutable once published | Changing a grammar changes every poster it ever produced |
| **Generate many, score, show few** | Random parameters are mostly mediocre; 500→12 is a different product |
| Scoring weights fitted from pairwise human preference | The weights are the aesthetic; get them from data, not intuition |
| **Print one for real before declaring done** | Soft proofing does not predict everything |

---

## Appendix B — Quick reference card

```
PRINT TARGET
  PDF/X-4 = ISO 15930-7   (live transparency OK, ICC managed)
  required: fonts embedded · output intent + embedded ICC
            TrimBox + BleedBox every page
            MediaBox ⊇ BleedBox ⊇ TrimBox
            XMP pdfxid · no encryption/JS/OPI · PDF 1.6
  ★ transparency group /CS must match the output intent
    (DeviceRGB group + CMYK intent = silent, common failure)
  validate with veraPDF --flavour 4 — in CI, not by hand

GEOMETRY
  bleed     3 mm (EU) / 0.125 in (US)
  safety    5 mm inside trim
  1 pt = 1/72 in = 0.352778 mm
  internal unit: integer 1/1000 pt  → exact arithmetic

INK
  TAC limits   coated 330% · web 300% · uncoated 240–260%
  rich black   60/40/40/100 (TAC 240) for LARGE fills + display
  small text   100K ONLY — registration fringing otherwise
  min stroke   0.25 pt (~0.09 mm)
  raster       300 ppi at final size

DETERMINISM
  provenance = (seed, generatorVersion, grammarVersion, fontHash)
  hierarchical sub-streams: subStream(master, "layout/blocks/3/rotation")
    → adding a random() call in one subsystem can't shift another
  ★ Math.sin/cos/tan/pow/exp/log are NOT bit-identical across engines
    exact: + − × ÷ sqrt floor round abs
    never let an approximated value feed a branch
  PRNG: PCG32, pinned, versioned. Math.random() is unseedable.
  test: same seed → same document hash, on Node + all 3 browsers

PIPELINE (lay out once)
  grammar + seed → generator → layout engine → Document model
                                                  ↓         ↓
                                            SVG renderer  PDF/X writer
  renderers make ZERO layout decisions

TYPE
  measure 45–75 ch (target 66) — HARD constraint
  leading grows with measure: ~1.35 at 45ch → ~1.53 at 75ch
  leading must be an integer multiple of the baseline unit
  optical overhang: quotes .35em · commas/periods .25em · O/C ~.01em
  tracking: ≥48pt −0.02em · ≥24pt −0.01em · ≤9pt +0.02em
  check fsType before embedding — outlining counts as embedding

COLOR
  work in OKLCH, never HSL (L=50% yellow ≠ L=50% blue)
  convert to CMYK UPSTREAM of the PDF writer, via lcms2 + FOGRA39
  ΔE < 1 imperceptible · 1–2 noticeable · > 5 a different color
  gamut safety = hard constraint; resample out-of-gamut palettes
```
