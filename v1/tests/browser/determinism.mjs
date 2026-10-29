#!/usr/bin/env node
// Cross-browser determinism (§4.2, §15.1): build the Studio, load it in every
// Playwright browser installed, and check each fixture seed hashes exactly as
// it does in Node. Usage: node tests/browser/determinism.mjs  (after `npm run studio:build`)
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { createRequire } from "node:module";
const { chromium, firefox, webkit } = createRequire(import.meta.url)("playwright");

const root = new URL("../../", import.meta.url).pathname;
const dist = join(root, "studio/dist");
const fixtures = JSON.parse(readFileSync(join(root, "tests/determinism/fixtures.json"), "utf8"));
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".otf": "font/otf", ".icc": "application/vnd.iccprofile" };
const server = createServer((req, res) => {
  const p = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" }).end(readFileSync(p));
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;

let failures = 0, ran = 0;
for (const [name, type] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  let browser;
  try { browser = await type.launch(); } catch { console.log(`${name}: not installed, skipped`); continue; }
  ran++;
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`${name} page error: ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => typeof window.posterHash === "function", null, { timeout: 60000 });
  let bad = 0;
  for (const f of fixtures.fixtures ?? fixtures) {
    const h = await page.evaluate((s) => window.posterHash(s), f.seed);
    if (h !== f.hash) { bad++; console.log(`${name}: ${f.seed} ${h} ≠ ${f.hash}`); }
  }
  console.log(`${name}: ${(fixtures.fixtures ?? fixtures).length - bad}/${(fixtures.fixtures ?? fixtures).length} fixture hashes match Node`);
  failures += bad;
  await browser.close();
}
server.close();
process.exit(failures || !ran ? 1 : 0);
