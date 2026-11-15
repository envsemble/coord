import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import modelTools from "./scripts/vite-model-plugin.cjs";

const root = path.dirname(fileURLToPath(import.meta.url));
// envUI's component styles load its Geist font from the installed package,
// which may be hoisted or a linked local checkout outside this directory.
const envUI = fs.realpathSync(
  path.dirname(
    createRequire(import.meta.url).resolve("@envsemble/envui/package.json"),
  ),
);
export default defineConfig({
  root: path.join(root, "development"),
  publicDir: path.join(root, "assets"),
  cacheDir: path.join(root, "node_modules/.vite"),
  plugins: [react(), modelTools.modelPlugin({ root })],
  // A linked local envUI checkout must share this package's React.
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [root, envUI] },
  },
});
