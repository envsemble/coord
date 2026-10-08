import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import modelTools from "./scripts/vite-model-plugin.cjs";

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.join(root, "development"),
  publicDir: path.join(root, "assets"),
  cacheDir: path.join(root, "node_modules/.vite"),
  plugins: [react(), modelTools.modelPlugin({ root })],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [root] },
  },
});
