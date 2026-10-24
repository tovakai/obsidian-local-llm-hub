import esbuild from "esbuild";
import { mkdir, copyFile, writeFile } from "node:fs/promises";

await mkdir("mobile-dist", { recursive: true });
await esbuild.build({
  entryPoints: ["src/mobile/main.ts"],
  outfile: "mobile-dist/main.js",
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2020",
  external: ["obsidian"],
  minify: true,
  logLevel: "info",
});
await copyFile("src/mobile/styles.css", "mobile-dist/styles.css");
await writeFile("mobile-dist/manifest.json", JSON.stringify({
  id: "mabel-mobile",
  name: "Mabel Mobile",
  version: "0.2.0",
  minAppVersion: "1.13.0",
  description: "A mobile companion for a private remote Ollama assistant.",
  author: "tovakai",
  isDesktopOnly: false,
}, null, 2) + "\n");
