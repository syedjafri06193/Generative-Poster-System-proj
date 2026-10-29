import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";

const root = join(import.meta.dirname, "..");
// The Emscripten loaders find their .wasm next to the chunk that imports them.
const copyAssets = {
  name: "copy-assets",
  writeBundle() {
    const out = join(root, "studio/dist");
    mkdirSync(join(out, "assets"), { recursive: true });
    copyFileSync(join(root, "node_modules/harfbuzzjs/dist/harfbuzz.wasm"), join(out, "assets/harfbuzz.wasm"));
    copyFileSync(join(root, "node_modules/lcms-wasm/dist/lcms.wasm"), join(out, "assets/lcms.wasm"));
    cpSync(join(root, "fonts"), join(out, "fonts"), { recursive: true });
    cpSync(join(root, "profiles"), join(out, "profiles"), { recursive: true });
  },
};

export default defineConfig({
  root: join(root, "studio"),
  base: "./",
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  optimizeDeps: { exclude: ["harfbuzzjs", "lcms-wasm"] },
  server: { fs: { allow: [root] } },
  plugins: [copyAssets],
});
