#!/usr/bin/env node
/**
 * Copy a FFmpeg binary into the Tauri bundle staging path:
 *   src-tauri/resources/ffmpeg
 *
 * Usage (from repo root `tts-tauri/`):
 *   node scripts/copy-ffmpeg-to-resources.cjs /absolute/or/relative/path/to/ffmpeg
 *
 * Or set env (no CLI arg):
 *   export AURORABOOK_FFMPEG=/path/to/ffmpeg
 *   node scripts/copy-ffmpeg-to-resources.cjs
 *
 * The file is gitignored; run this before `tauri build` / `tauri dev` when you want a bundled FFmpeg.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const tauriDir = path.join(root, "src-tauri");
const resourcesDir = path.join(tauriDir, "resources");
const dest = path.join(resourcesDir, "ffmpeg");

const srcRaw = (
  process.argv[2] ||
  process.env.AURORABOOK_FFMPEG ||
  process.env.MACOS_APPSTORE_FFMPEG ||
  ""
).trim();

if (!srcRaw) {
  console.error("copy-ffmpeg-to-resources: missing source path.");
  console.error("  node scripts/copy-ffmpeg-to-resources.cjs /path/to/ffmpeg");
  console.error("  or: export AURORABOOK_FFMPEG=/path/to/ffmpeg");
  process.exit(1);
}

const srcPath = path.resolve(srcRaw);
if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) {
  console.error("copy-ffmpeg-to-resources: source is not a file:", srcPath);
  process.exit(1);
}

fs.mkdirSync(resourcesDir, { recursive: true });
fs.copyFileSync(srcPath, dest);

try {
  const mode = fs.statSync(dest).mode & 0o777;
  if ((mode & 0o111) === 0) {
    fs.chmodSync(dest, mode | 0o755);
  }
} catch (e) {
  console.error("copy-ffmpeg-to-resources: chmod failed:", e.message);
  process.exit(1);
}

console.log("copy-ffmpeg-to-resources: wrote", path.relative(root, dest));
