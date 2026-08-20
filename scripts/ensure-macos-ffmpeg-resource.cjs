#!/usr/bin/env node
/**
 * Ensure macOS builds have a bundled FFmpeg directory at:
 *   src-tauri/resources/ffmpeg-bin/
 *
 * Re-bundles when missing or when the staged binary fails `ffmpeg -version`.
 * iOS builds must not call this script.
 *
 * Manual override:
 *   bun run sync:ffmpeg -- /path/to/ffmpeg
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const bundleDir = path.join(root, "src-tauri", "resources", "ffmpeg-bin");
const destFfmpeg = path.join(bundleDir, "ffmpeg");

function ffmpegRuns(ffmpegPath) {
  if (!fs.existsSync(ffmpegPath) || !fs.statSync(ffmpegPath).isFile()) {
    return false;
  }
  const probe = spawnSync(ffmpegPath, ["-version"], { encoding: "utf8" });
  return probe.status === 0 && /ffmpeg version/i.test(probe.stdout || "");
}

if (ffmpegRuns(destFfmpeg)) {
  console.log("ensure-macos-ffmpeg-resource:", path.relative(root, destFfmpeg), "ok");
  process.exit(0);
}

const bundleScript = path.join(__dirname, "bundle-macos-ffmpeg.cjs");
const result = spawnSync(process.execPath, [bundleScript], {
  stdio: "inherit",
  cwd: root,
});
process.exit(result.status === null ? 1 : result.status);
