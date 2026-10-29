# Poster Studio

A browser front end for the v1 engine, with no server. The Studio runs the
same TypeScript, HarfBuzz and lcms WASM as Node, so a seed in the Studio
produces the same hash as on the command line.

```bash
cd v1
npm run studio          # dev server at http://localhost:5173
npm run studio:build    # static site in studio/dist (deploy anywhere)
```

| Panel | What it does |
|---|---|
| Seed, ⟳ | Type a 12-hex-digit seed, or roll a random one. The URL hash keeps the seed and brief, so links reproduce the poster |
| Brief | Headline, subhead, body, details. Preview updates as you type |
| View | Trim, bleed and safety guides; ink coverage heat map; bleed on or off; **Replay decisions** animates the nodes in the order the generator placed them |
| Export | PDF/X-4 (preflight first); SVG; model JSON; **seed card** PDF (an 85 × 55 mm card with a QR code); **Riso proof** (three-drum separation with simulated misregistration); **Series ×4** (CSS Paged Media HTML); **Tiles 2×2** (four PDF/X-4 panels with 0.5 in overlap) |
| Preflight | Live issues for the current poster |
| Batch tab | Generates 48 candidates from the seed, ranks them by score and shows the best 12. Click one to open it |
| Compare A/B tab | Click the better of two random posters. Choices are kept in this browser; **Export prefs.json**, then run `npm run tune -- prefs.json` to fit scoring weights (Bradley–Terry) |

The preview colours are a soft proof: each CMYK value is converted back
through FOGRA39 to sRGB, so the screen shows what will print, not the
idealised OKLCH colour.
