#!/usr/bin/env node
/**
 * Stage a self-contained FFmpeg bundle into src-tauri/resources/ffmpeg-bin/.
 *
 * Routes to the platform bundler:
 *   macOS  → bundle-macos-ffmpeg.cjs
 *   Windows → bundle-windows-ffmpeg.cjs
 *
 * Usage (from repo root):
 *   node scripts/copy-ffmpeg-to-resources.cjs /absolute/or/relative/path/to/ffmpeg
 *   export AURORABOOK_FFMPEG=/path/to/ffmpeg
 *   node scripts/copy-ffmpeg-to-resources.cjs
 */
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");

function resolveBundleScript() {
  const forced = (process.env.AURORABOOK_FFMPEG_PLATFORM || "").trim().toLowerCase();
  if (forced === "windows" || forced === "win32" || forced === "win") {
    return path.join(__dirname, "bundle-windows-ffmpeg.cjs");
  }
  if (forced === "macos" || forced === "darwin" || forced === "mac") {
    return path.join(__dirname, "bundle-macos-ffmpeg.cjs");
  }
  if (process.platform === "win32") {
    return path.join(__dirname, "bundle-windows-ffmpeg.cjs");
  }
  if (process.platform === "darwin") {
    return path.join(__dirname, "bundle-macos-ffmpeg.cjs");
  }
  // Cross-build helpers: allow Windows staging from Linux/macOS CI.
  if ((process.env.TAURI_ENV_PLATFORM || "").toLowerCase() === "windows") {
    return path.join(__dirname, "bundle-windows-ffmpeg.cjs");
  }
  console.error(
    "copy-ffmpeg-to-resources: unsupported host platform",
    process.platform,
    "(set AURORABOOK_FFMPEG_PLATFORM=windows|macos)"
  );
  process.exit(1);
}

const bundleScript = resolveBundleScript();
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
  env: process.env,
});
process.exit(result.status === null ? 1 : result.status);
