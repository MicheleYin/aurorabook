#!/usr/bin/env node
/**
 * Ensure Windows builds have a bundled FFmpeg at:
 *   src-tauri/resources/ffmpeg-bin/ffmpeg.exe
 *
 * Re-bundles when missing. Prefer a real download/stage via bundle-windows-ffmpeg.cjs.
 *
 * Usage:
 *   node scripts/ensure-windows-ffmpeg-resource.cjs
 *   node scripts/ensure-windows-ffmpeg-resource.cjs --arch=arm64
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const bundleDir = path.join(root, "src-tauri", "resources", "ffmpeg-bin");
const destFfmpeg = path.join(bundleDir, "ffmpeg.exe");

function parseArchArg() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--arch=")) {
      return arg.slice("--arch=".length).trim();
    }
  }
  return "";
}

function hasStagedBinary() {
  try {
    return (
      fs.existsSync(destFfmpeg) &&
      fs.statSync(destFfmpeg).isFile() &&
      fs.statSync(destFfmpeg).size > 0
    );
  } catch {
    return false;
  }
}

function ffmpegRuns() {
  if (!hasStagedBinary()) return false;
  if (process.platform !== "win32") {
    // Cross-building from macOS/Linux: presence is enough; PE won't run natively.
    return true;
  }
  const probe = spawnSync(destFfmpeg, ["-version"], { encoding: "utf8" });
  return probe.status === 0 && /ffmpeg version/i.test(probe.stdout || "");
}

const archArg = parseArchArg();
const env = { ...process.env };
if (archArg) {
  env.AURORABOOK_FFMPEG_ARCH = archArg;
}

if (ffmpegRuns() && !archArg) {
  console.log("ensure-windows-ffmpeg-resource:", path.relative(root, destFfmpeg), "ok");
  process.exit(0);
}

const bundleScript = path.join(__dirname, "bundle-windows-ffmpeg.cjs");
const result = spawnSync(process.execPath, [bundleScript], {
  stdio: "inherit",
  cwd: root,
  env,
});
process.exit(result.status === null ? 1 : result.status);
