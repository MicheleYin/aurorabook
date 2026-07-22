#!/usr/bin/env node
/**
 * Ensure App Store macOS build has a bundled FFmpeg binary at:
 *   src-tauri/resources/ffmpeg
 *
 * Behavior:
 * - If destination already exists and is a file, keep it and ensure executable permissions.
 * - Else copy from MACOS_APPSTORE_FFMPEG or AURORABOOK_FFMPEG (required when destination is missing).
 *
 * For a manual copy (overwrites), run: bun run sync:ffmpeg -- /path/to/ffmpeg
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const tauriDir = path.join(root, "src-tauri");
const resourcesDir = path.join(tauriDir, "resources");
const dest = path.join(resourcesDir, "ffmpeg");

function ensureExecutable(filePath) {
  try {
    const mode = fs.statSync(filePath).mode & 0o777;
    if ((mode & 0o111) === 0) {
      fs.chmodSync(filePath, mode | 0o755);
    }
  } catch (e) {
    console.error("ensure-macos-ffmpeg-resource: failed to chmod +x:", e.message);
    process.exit(1);
  }
}

if (fs.existsSync(dest)) {
  const stat = fs.statSync(dest);
  if (!stat.isFile()) {
    console.error("ensure-macos-ffmpeg-resource: expected a file at", path.relative(root, dest));
    process.exit(1);
  }
  ensureExecutable(dest);
  console.log("ensure-macos-ffmpeg-resource:", path.relative(root, dest), "ok");
  process.exit(0);
}

const src = (process.env.MACOS_APPSTORE_FFMPEG || process.env.AURORABOOK_FFMPEG || "").trim();
if (!src) {
  console.error("ensure-macos-ffmpeg-resource: missing FFmpeg binary.");
  console.error("Provide one of:");
  console.error("  1) Existing file:", path.relative(root, dest));
  console.error("  2) Environment variable:");
  console.error("     export MACOS_APPSTORE_FFMPEG=/absolute/path/to/ffmpeg");
  console.error("     or export AURORABOOK_FFMPEG=/absolute/path/to/ffmpeg");
  console.error("  3) Or run first: bun run sync:ffmpeg -- /path/to/ffmpeg");
  console.error("Then run: bun run build:macos:appstore");
  process.exit(1);
}

const srcPath = path.resolve(src);
if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) {
  console.error("ensure-macos-ffmpeg-resource: MACOS_APPSTORE_FFMPEG not found:", srcPath);
  process.exit(1);
}

fs.mkdirSync(resourcesDir, { recursive: true });
fs.copyFileSync(srcPath, dest);
ensureExecutable(dest);
console.log("ensure-macos-ffmpeg-resource: copied to", path.relative(root, dest));
