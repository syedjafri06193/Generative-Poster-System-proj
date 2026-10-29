import { SAMPLE_BRIEF } from "../src/briefs.js";
import { formatSeed, parseSeed, SEED_MASK } from "../src/core/prng.js";
import { generate, hashDocument } from "../src/generate.js";
import { GRAMMARS } from "../src/grammar/registry.js";
import type { Brief } from "../src/grammar/schema.js";
import type { PosterDocument } from "../src/model/document.js";
import { preflight } from "../src/render-pdf/preflight.js";
import { writePdfX4 } from "../src/render-pdf/writer.js";
import { renderSvg } from "../src/render-svg/svg.js";
import { generateBatch } from "../src/score/batch.js";
import { loadBrowserContext } from "./browser.js";
import { renderPagedHtml } from "../src/stretch/paged-media.js";
import { RISO_INKS, separate } from "../src/stretch/riso.js";
import { seedCard } from "../src/stretch/seedcard.js";
import { generateSeries } from "../src/stretch/series.js";
import { tile } from "../src/stretch/tiling.js";
import { pt } from "../src/core/units.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (s: string) => ($("status").textContent = s);
status("Loading fonts and press profile…");
const ctx = await loadBrowserContext();

const grammarSel = $<HTMLSelectElement>("grammar");
for (const id of GRAMMARS.keys()) grammarSel.add(new Option(id, id));
const fields = ["seed", "headline", "subhead", "body", "details"] as const;
const input = (id: (typeof fields)[number]) => $<HTMLInputElement | HTMLTextAreaElement>(id);

const params = new URLSearchParams(location.hash.slice(1));
input("seed").value = params.get("seed") ?? "7f3a-9c21-0e48";
input("headline").value = params.get("headline") ?? SAMPLE_BRIEF.headline;
input("subhead").value = params.get("subhead") ?? SAMPLE_BRIEF.subhead ?? "";
input("body").value = params.get("body") ?? SAMPLE_BRIEF.body;
input("details").value = params.get("details") ?? SAMPLE_BRIEF.details.join("\n");

const brief = (): Brief => ({
  headline: input("headline").value.trim() || "Untitled",
  subhead: input("subhead").value.trim() || undefined,
  body: input("body").value.trim(),
  details: input("details").value.split("\n").map((s) => s.trim()).filter(Boolean),
});
const grammar = () => GRAMMARS.get(grammarSel.value)!;
const svgOpts = () => ({ guides: $<HTMLInputElement>("guides").checked, bleed: $<HTMLInputElement>("bleed").checked, inkCoverage: $<HTMLInputElement>("ink").checked ? { limit: ctx.profile.tacLimit } : undefined });
const randomSeed = () => { const a = new Uint32Array(2); crypto.getRandomValues(a); return ((BigInt(a[0]!) << 32n) | BigInt(a[1]!)) & SEED_MASK; };

let current: PosterDocument | null = null;

function render() {
  let seed: bigint;
  try { seed = parseSeed(input("seed").value); } catch { status("Seed must be 12 hex digits, like 7f3a-9c21-0e48"); return; }
  const t0 = performance.now();
  try {
    const { doc, attempt } = generate(grammar(), seed, brief(), ctx);
    current = doc;
    $("preview").innerHTML = renderSvg(doc, svgOpts());
    const pf = preflight(doc, ctx.profile);
    $("issues").innerHTML = pf.issues.length ? pf.issues.map((i) => `<li class="${i.severity}">${i.code}: ${i.message.replace(/</g, "&lt;")}</li>`).join("") : "<li>All checks pass · max TAC " + pf.maxTAC + "%</li>";
    status(`${doc.provenance.seed} · ${doc.trim.w / 1000 | 0}×${doc.trim.h / 1000 | 0} pt · attempt ${attempt + 1} · ${(performance.now() - t0).toFixed(0)} ms · ${hashDocument(doc).slice(0, 12)}`);
    const h = new URLSearchParams({ seed: input("seed").value, ...Object.fromEntries(fields.slice(1).map((f) => [f, input(f).value])) });
    history.replaceState(null, "", "#" + h);
  } catch (e) { current = null; status(String((e as Error).message)); }
}

let timer = 0;
for (const f of fields) input(f).addEventListener("input", () => { clearTimeout(timer); timer = window.setTimeout(render, 250); });
for (const id of ["guides", "ink", "bleed", "grammar"]) $(id).addEventListener("change", render);
$("random").onclick = () => { input("seed").value = formatSeed(randomSeed()); render(); };

const download = (data: BlobPart, name: string, type: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("pdf").onclick = () => {
  if (!current) return;
  const pf = preflight(current, ctx.profile);
  if (!pf.ok && !confirm(`Preflight found ${pf.issues.length} issue(s). Export anyway?`)) return;
  download(writePdfX4(current, { icc: ctx.icc, profile: ctx.profile, title: brief().headline }), `poster-${current.provenance.seed}.pdf`, "application/pdf");
};
$("svg").onclick = () => current && download(renderSvg(current), `poster-${current.provenance.seed}.svg`, "image/svg+xml");
$("json").onclick = () => current && download(JSON.stringify(current, (_, v) => (typeof v === "bigint" ? String(v) : v), 2), `poster-${current.provenance.seed}.json`, "application/json");

$("card").onclick = () => current && download(writePdfX4(seedCard(current, ctx), { icc: ctx.icc, profile: ctx.profile, title: `Seed card ${current.provenance.seed}` }), `seed-card-${current.provenance.seed}.pdf`, "application/pdf");
$("riso").onclick = () => {
  if (!current) return;
  const { proofSvg } = separate(current, [RISO_INKS.blue!, RISO_INKS.fluorescentPink!, RISO_INKS.black!], ctx.press);
  $("preview").innerHTML = proofSvg(0.8, 7);
  status("Risograph proof: blue + fluorescent pink + black, with simulated misregistration. Edit any field to return.");
};
$("series").onclick = () => {
  const b = brief();
  const briefs = ["I", "II", "III", "IV"].map((n) => ({ ...b, headline: `${b.headline} ${n}` }));
  download(renderPagedHtml(generateSeries(grammar(), parseSeed(input("seed").value), briefs, ctx), b.headline), "series.html", "text/html");
};
$("tiles").onclick = () => {
  if (!current) return;
  for (const t of tile(current, { cols: 2, rows: 2, overlap: pt(36) }))
    download(writePdfX4(t.doc, { icc: ctx.icc, profile: ctx.profile }), `tile-${t.col + 1}-${t.row + 1}.pdf`, "application/pdf");
};

// Animated preview (§17): replay the document's nodes in decision order.
$("replay").onclick = async () => {
  if (!current) return;
  const doc = current;
  for (let i = 1; i <= doc.nodes.length; i++) {
    if (current !== doc) return;
    const n = doc.nodes[i - 1]!;
    $("preview").innerHTML = renderSvg({ ...doc, nodes: doc.nodes.slice(0, i) }, svgOpts());
    status(`${i}/${doc.nodes.length} · ${n.kind === "shape" ? n.role : n.role + " text"} “${n.id}”${n.kind === "glyphRun" ? ` ${(n.sizeUnits / 1000).toFixed(1)} pt` : ""}`);
    await new Promise((r) => setTimeout(r, 350));
  }
};

// Tabs
document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => (b.onclick = () => {
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
  for (const id of ["single", "batch", "compare"]) $(id).hidden = id !== b.dataset.tab;
  if (b.dataset.tab === "compare") nextPair();
}));

// Batch: generate many, show the best (§10.1)
$("runbatch").onclick = async () => {
  status("Generating 48 candidates…");
  await new Promise((r) => setTimeout(r, 20));
  const master = parseSeed(input("seed").value);
  const t0 = performance.now();
  const { ranked, failed } = generateBatch(grammar(), master, 48, brief(), ctx);
  $("grid").innerHTML = "";
  for (const r of ranked.slice(0, 12)) {
    const fig = document.createElement("figure");
    fig.innerHTML = renderSvg(r.doc, { bleed: false }) + `<figcaption>${formatSeed(r.seed)} · ${r.score.total.toFixed(3)}</figcaption>`;
    fig.onclick = () => { input("seed").value = formatSeed(r.seed); (document.querySelector('[data-tab="single"]') as HTMLButtonElement).click(); render(); };
    $("grid").append(fig);
  }
  status(`${ranked.length} generated, ${failed} failed, ${(performance.now() - t0).toFixed(0)} ms — click one to open it`);
};

// Pairwise preferences (§10.3)
const prefs: { preferred: string; rejected: string }[] = (() => { try { return JSON.parse(localStorage.getItem("poster-prefs") ?? "[]"); } catch { return []; } })();
const savePrefs = () => { try { localStorage.setItem("poster-prefs", JSON.stringify(prefs)); } catch { /* private mode */ } $("prefcount").textContent = `${prefs.length} recorded`; };
savePrefs();
function nextPair() {
  const seeds = [randomSeed(), randomSeed()];
  $("ab").innerHTML = "";
  for (const [i, s] of seeds.entries()) {
    const fig = document.createElement("figure");
    fig.style.margin = "0"; fig.style.cursor = "pointer";
    try { fig.innerHTML = renderSvg(generate(grammar(), s, brief(), ctx).doc, { bleed: false }); } catch { return nextPair(); }
    fig.onclick = () => { prefs.push({ preferred: formatSeed(s), rejected: formatSeed(seeds[1 - i]!) }); savePrefs(); nextPair(); };
    $("ab").append(fig);
  }
}
$("prefs").onclick = () => download(JSON.stringify(prefs, null, 2), "prefs.json", "application/json");

render();

// Cross-runtime determinism hook (tests/browser/determinism.mjs): same seed → same hash as Node.
(window as unknown as { posterHash: (s: string) => string }).posterHash = (s) => hashDocument(generate(GRAMMARS.get("poster-grid@1")!, parseSeed(s), SAMPLE_BRIEF, ctx).doc);
