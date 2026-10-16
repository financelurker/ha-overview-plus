// Keeps the image URLs in README.md cache-proof.
//
// README images are linked with absolute raw.githubusercontent.com URLs (HACS renders
// the README inside Home Assistant, where relative paths do not work). Those URLs are
// cached by browsers, GitHub and HACS, so a changed image would keep showing the old
// version. Each URL therefore carries `?v=<hash of the file>`: when an image changes,
// its URL changes too.
//
//   node scripts/readme-images.mjs          update README.md
//   node scripts/readme-images.mjs --check  fail if README.md is not up to date (CI)

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const README = "README.md";
const URL_RE = /(https:\/\/raw\.githubusercontent\.com\/financelurker\/ha-overview-plus\/main\/)(docs\/images\/[\w.-]+\.(?:png|jpe?g|gif|svg|webp))(\?v=[0-9a-f]+)?/g;

const text = readFileSync(README, "utf8");
const missing = new Set();
const updated = text.replace(URL_RE, (_m, base, path) => {
  if (!existsSync(path)) {
    missing.add(path);
    return `${base}${path}`;
  }
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 10);
  return `${base}${path}?v=${hash}`;
});

if (missing.size) {
  console.error(`README.md links images that do not exist: ${[...missing].join(", ")}`);
  process.exit(1);
}
if (process.argv.includes("--check")) {
  if (updated !== text) {
    console.error("README.md image URLs are out of date – run: npm run docs:images");
    process.exit(1);
  }
  console.log("README.md image URLs are up to date.");
} else {
  writeFileSync(README, updated);
  console.log(updated === text ? "README.md image URLs were up to date." : "README.md image URLs updated.");
}
