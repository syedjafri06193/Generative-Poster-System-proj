# Stretch goals (§17): what was built

| Feature | Status | Where |
|---|---|---|
| **Series generation** | ✅ Built | `src/stretch/series.ts`. Shared canvas, grid, type and palette from one family seed. The family is recorded in provenance |
| **Animated preview** | ✅ Built | Studio → **Replay decisions** |
| **Large-format tiling** | ✅ Built | `src/stretch/tiling.ts`. Panels with overlap; each is a normal document that passes the PDF/X-4 corpus |
| **Physical seed cards** | ✅ Built | `src/stretch/seedcard.ts`. A test renders the card, scans the QR code with jsQR and regenerates the poster to the same hash |
| **CSS Paged Media output** | ✅ Built | `src/stretch/paged-media.ts`. `@page` with bleed and `marks: crop`. For proofs and web-to-print; it can't carry an output intent |
| **Risograph mode** | ✅ Built (proofing) | `src/stretch/riso.ts`. Per-drum density masters with knockouts, and a multiply-blend proof with misregistration. Ink densities are approximate, so calibrate them against your printer's swatches |
| **Spot colour generation** | ◐ Partial | Riso separation covers two- and three-ink output on screen and as masters. PDF `/Separation` colour spaces aren't written yet |
| **Variable fonts** | ✗ Not built | Needs bundled variable fonts and `hb_font_set_variations`. The shaping cache key would also need to include the axes |
| **Image integration** | ✗ Not built | `imagePolicy: "none"` is reserved in the grammar. Needs a resolution check (≥ 300 ppi at size), CMYK conversion of images, and `/Image` XObjects |
| **Grammar editor UI** | ✗ Not built | The grammar is plain JSON with `validateGrammar()`, which is the foundation such an editor would use |
