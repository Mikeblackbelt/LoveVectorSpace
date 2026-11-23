import { defineConfig } from "vite";

// Content scripts cannot be ES modules, so build them separately as one IIFE.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    lib: { entry: "src/content/main.ts", formats: ["iife"], name: "lvsContent", fileName: () => "content.js" },
  },
});
