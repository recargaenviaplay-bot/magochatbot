import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootPackage = JSON.parse(fs.readFileSync(path.resolve(here, "package.json"), "utf8"));
const packageNames = Object.keys({ ...rootPackage.dependencies, ...rootPackage.devDependencies })
  .filter((name) => name !== "vite" && name !== "@vitejs/plugin-react" && name !== "@tailwindcss/vite");
const dependencyAliases = packageNames.map((name) => ({
  find: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(/.*)?$"),
  replacement: path.resolve(here, "node_modules", name) + "$1",
}));

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(here, "src") },
      ...dependencyAliases,
    ],
    dedupe: ["react", "react-dom"],
  },
  server: { fs: { allow: [path.resolve(here, "..")] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    modulePreload: { polyfill: false },
  },
});
