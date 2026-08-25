#!/usr/bin/env node
/**
 * Copy Windows Store tile assets from src-tauri/icons/ into Assets/ and validate sizes.
 *
 * Mapping (Package.appxmanifest → src-tauri/icons/):
 *   StoreLogo.png  ← StoreLogo.png
 *   AppList.png    ← Square44x44Logo.png
 *   MedTile.png    ← Square150x150Logo.png
 *   WideTile.png   ← Wide310x150Logo.png
 *
 * Usage:
 *   node scripts/sync-windows-store-assets.cjs
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const iconsDir = path.join(root, "src-tauri", "icons");
const assetsDir = path.join(root, "Assets");

const ASSET_MAP = [
  { dest: "StoreLogo.png", src: "StoreLogo.png", width: 50, height: 50 },
  { dest: "AppList.png", src: "Square44x44Logo.png", width: 44, height: 44 },
  { dest: "MedTile.png", src: "Square150x150Logo.png", width: 150, height: 150 },
  { dest: "WideTile.png", src: "Wide310x150Logo.png", width: 310, height: 150 },
];

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("not a PNG file");
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

let failed = false;

for (const { dest, src, width, height } of ASSET_MAP) {
  const srcPath = path.join(iconsDir, src);
  const destPath = path.join(assetsDir, dest);

  if (!fs.existsSync(srcPath)) {
    console.error(`sync-windows-store-assets: missing ${path.relative(root, srcPath)}`);
    if (src === "Wide310x150Logo.png") {
      console.error("  Run: node scripts/generate-wide-tile.cjs");
    }
    failed = true;
    continue;
  }

  let dims;
  try {
    dims = readPngDimensions(srcPath);
  } catch (err) {
    console.error(`sync-windows-store-assets: invalid PNG ${path.relative(root, srcPath)}: ${err.message}`);
    failed = true;
    continue;
  }

  if (dims.width !== width || dims.height !== height) {
    console.error(
      `sync-windows-store-assets: wrong size for ${src}: ${dims.width}x${dims.height}, expected ${width}x${height}`
    );
    failed = true;
    continue;
  }

  copyFile(srcPath, destPath);
  console.log(
    `sync-windows-store-assets: ${path.relative(root, destPath)} ← ${src} (${width}x${height})`
  );
}

if (failed) {
  process.exit(1);
}

console.log("sync-windows-store-assets: OK");
