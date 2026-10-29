#!/usr/bin/env node
// Determinism lint (design guide §4.2): engine code may not call
// implementation-approximated maths or nondeterministic sources. Rendering
// code (render-*) and Node entry points are exempt. Exit 1 on any hit.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const BANNED = [
  [/Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|expm1|log|log2|log10|log1p|cbrt|sinh|cosh|tanh|hypot)\b/, "use src/core/detmath.ts"],
  [/\*\*/, "`**` is implementation-approximated; multiply or use detPowInt"],
  [/Math\.random\b/, "use the seeded Rng"],
  [/Date\.now\b|new Date\(\)|performance\.now\b/, "time must not influence the document"],
];
const EXEMPT = /(^|\/)(render-svg|render-pdf|types)\/|(^|\/)node\.ts$/;
const root = new URL("../src/", import.meta.url).pathname;
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && files.push(p); } })(root);
let hits = 0;
for (const file of files) {
  const rel = relative(root, file);
  if (EXEMPT.test(rel)) continue;
  // Blank out comments and string literals, keeping line numbers.
  const src = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, " "));
  src.split("\n").forEach((code, i) => {
    for (const [re, why] of BANNED) if (re.test(code)) { hits++; console.log(`src/${rel}:${i + 1}: ${code.trim()}  — ${why}`); }
  });
}
if (hits) { console.log(`${hits} determinism violation(s)`); process.exit(1); }
console.log(`determinism lint: ${files.length} files clean`);
