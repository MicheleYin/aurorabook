#!/usr/bin/env node
/**
 * Stage a self-contained FFmpeg bundle for macOS:
 *   src-tauri/resources/ffmpeg-bin/
 *
 * Usage (from repo root `tts-tauri/`):
 *   node scripts/copy-ffmpeg-to-resources.cjs /absolute/or/relative/path/to/ffmpeg
 *
 * Or set env (no CLI arg):
 *   export AURORABOOK_FFMPEG=/path/to/ffmpeg
 *   node scripts/copy-ffmpeg-to-resources.cjs
 */
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const bundleScript = path.join(__dirname, "bundle-macos-ffmpeg.cjs");

const srcRaw = (
  process.argv[2] ||
  process.env.AURORABOOK_FFMPEG ||
  process.env.MACOS_APPSTORE_FFMPEG ||
  ""
).trim();

const args = [bundleScript];
if (srcRaw) {
  args.push(srcRaw);
}

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  cwd: root,
});
process.exit(result.status === null ? 1 : result.status);
