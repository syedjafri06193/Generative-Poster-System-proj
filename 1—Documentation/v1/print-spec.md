# Print specification (M0)

What every file from v1 is built to. The values live in code in
[`v1/src/model/press.ts`](../../v1/src/model/press.ts), and preflight and the
hard constraints read them from there, so this page and the output can't
disagree.

> **Status: one item open.** The design guide's M0 is done only when a
> printer has confirmed this spec. That's a phone call, and only you can
> make it. The values below are the common defaults for sheet-fed offset on
> coated stock. Ask your printer about each row marked ☐ and change
> `press.ts` if their answer differs.

| | Value | Why | Confirm |
|---|---|---|---|
| Standard | PDF/X-4 (ISO 15930-7), PDF 1.6 | Live transparency, ICC-based colour, accepted by every modern RIP | ☐ |
| Output intent | FOGRA39 (ISO 12647-2:2004, coated paper), `FOGRA39L_coated.icc` embedded | The European default for coated sheet-fed offset | ☐ |
| Sizes | A1, A2, A3, A4, 18×24 in, 11×17 in (the grammar uses A2, A3, 18×24 in) | | ☐ |
| Bleed | 3 mm on every edge | Standard in Europe; US shops often ask for 0.125 in (3.175 mm) | ☐ |
| Safety margin | 5 mm inside the trim | No text closer to the cut than this | ☐ |
| Total area coverage | ≤ 330% | FOGRA39's limit; some uncoated work needs 300% or lower | ☐ |
| Rich black | C60 M40 Y40 K100 (240%), for fills and display type ≥ 12 pt | A deeper black than K alone, under the TAC limit | ☐ |
| Small-text black | K100 only, below 12 pt | Several inks on fine type fringe when registration drifts | ☐ |
| Minimum stroke | 0.25 pt | Thinner lines may not hold on press | ☐ |
| Minimum multi-ink text | 7 pt (`minReversedText`) | Below this, text must be single-ink | ☐ |
| Gamut tolerance | ΔE(OKLab ×100) ≤ 3 between the intended and printed colour | Colours that move further are pulled in by reducing chroma | — |
| Fonts | Outlined to paths and tagged with `/ActualText` | Nothing to embed, so no licence or subsetting problems at the RIP | ☐ |
| Trapping | `/Trapped /False` | The shop's RIP traps | ☐ |

## Questions to ask the printer

1. Do you accept PDF/X-4, or do you need PDF/X-1a? X-1a would mean flattening transparency, which v1 doesn't do.
2. Which characterised condition? FOGRA39, FOGRA51 (PSO Coated v3), GRACoL 2013 or SWOP. Adding one is one `PRESS_PROFILES` entry plus its ICC file.
3. Bleed, and do you want crop marks in the file? The writer emits none and relies on TrimBox. Most shops prefer that.
4. What TAC limit applies on the stock you're quoting?
5. Do you trap, and do you want overprint set on black?

## How conformance is checked

- **Before writing**, `preflight()` runs on the document model. It checks TAC, hairlines, rich black in small type, multi-ink small type, the safety margin, bleed reach and objects beyond the bleed.
- **After writing**, each file in the conformance corpus (`v1/tests/conformance`) is read back by two independent tools:
  - `qpdf --check` for structure;
  - [`tools/pdfx_check.py`](../../v1/tools/pdfx_check.py) for the PDF/X-4 rules: output intent and profile class, Info and XMP version keys, box nesting, the transparency group's colour space, RGB operators, embedded fonts, encryption and JavaScript.
- **Not done here:** certified validation. veraPDF validates PDF/A, not PDF/X. A certified PDF/X-4 check needs callas pdfToolbox, Acrobat Pro Preflight (the "PDF/X-4 compliance" profile) or your printer's own preflight. Before a real print run, run the file through one of these once. The checks above are designed to catch the same failures, but they aren't certified.
- **Known limitation:** because text is outlined, `pdftotext` can't extract it. Acrobat and other readers that honour `/ActualText` do get the text back for search and copy.
