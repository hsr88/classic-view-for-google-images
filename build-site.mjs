import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, "dist");

const publicFiles = [
  "index.html",
  "privacy.html",
  "old-google-images-layout.html",
  "classic-google-images.html",
  "chrome-extension.html",
  "premium.css",
  "tokens.css",
  "icon48.png",
  "icon128.png",
  "classic-view-bridges.png",
  "hero-classic-layout.png",
  "hero-layout-controls.png",
  "hero-hover-zoom.png",
  "chrome-web-store-badge.png",
  "carousel.js",
  "robots.txt",
  "sitemap.xml",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await Promise.all(
  publicFiles.map((file) =>
    copyFile(resolve(root, file), resolve(output, file)),
  ),
);

console.log(`Prepared ${publicFiles.length} public files in dist.`);
