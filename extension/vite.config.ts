import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";

// Emit manifest.json unchanged into dist/.
function manifest(): Plugin {
  return {
    name: "emit-manifest",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.json", source: readFileSync("manifest.json", "utf8") });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [manifest()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: { background: "src/background.ts", popup: "popup.html", options: "options.html" },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]" },
    },
  },
});
