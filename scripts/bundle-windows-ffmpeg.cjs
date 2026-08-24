#!/usr/bin/env node
/**
 * Stage a self-contained FFmpeg binary for Windows Tauri builds:
 *   src-tauri/resources/ffmpeg-bin/ffmpeg.exe
 *
 * Downloads a pinned BtbN static GPL build (includes libmp3lame + AAC/MP4)
 * unless AURORABOOK_FFMPEG / CLI path points at an existing ffmpeg.exe.
 *
 * Pin: FFmpeg n8.1 (matches explicit `-f mp4` muxer needs in ffmpeg_audio.rs).
 *
 * Usage:
 *   node scripts/bundle-windows-ffmpeg.cjs
 *   node scripts/bundle-windows-ffmpeg.cjs /path/to/ffmpeg.exe
 *   AURORABOOK_FFMPEG_ARCH=arm64 node scripts/bundle-windows-ffmpeg.cjs
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { spawnSync } = require("child_process");
const { createWriteStream } = require("fs");
const { pipeline } = require("stream/promises");

const root = path.join(__dirname, "..");
const bundleDir = path.join(root, "src-tauri", "resources", "ffmpeg-bin");
const destFfmpeg = path.join(bundleDir, "ffmpeg.exe");
const cacheDir = path.join(root, ".cache", "ffmpeg-windows");

/** Pinned BtbN release channel (n8.1 static GPL). */
const FFMPEG_RELEASE_TAG = "latest";
const FFMPEG_SERIES = "n8.1";
const FFMPEG_SERIES_SUFFIX = "8.1";

function resolveArch() {
  const fromEnv = (process.env.AURORABOOK_FFMPEG_ARCH || "").trim().toLowerCase();
  if (fromEnv === "arm64" || fromEnv === "aarch64" || fromEnv === "winarm64") {
    return "winarm64";
  }
  if (fromEnv === "x64" || fromEnv === "x86_64" || fromEnv === "amd64" || fromEnv === "win64") {
    return "win64";
  }
  const triple = (process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_CFG_TARGET_ARCH || "")
    .toLowerCase();
  if (triple.includes("aarch64") || triple.includes("arm64")) {
    return "winarm64";
  }
  if (process.arch === "arm64") {
    return "winarm64";
  }
  return "win64";
}

function downloadUrl(arch) {
  // e.g. ffmpeg-n8.1-latest-win64-gpl-8.1.zip
  const name = `ffmpeg-${FFMPEG_SERIES}-latest-${arch}-gpl-${FFMPEG_SERIES_SUFFIX}.zip`;
  return `https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_RELEASE_TAG}/${name}`;
}

function resolveLocalFfmpeg() {
  const fromArg = (process.argv[2] || "").trim();
  const fromEnv = (process.env.AURORABOOK_FFMPEG || "").trim();
  const candidates = [fromArg, fromEnv].filter(Boolean);

  // Only search PATH on a real Windows host. Cross-staging from macOS/Linux must
  // download the pinned BtbN PE binary (or use an explicit AURORABOOK_FFMPEG path).
  if (process.platform === "win32") {
    for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
      candidates.push(path.join(dir, "ffmpeg.exe"));
      candidates.push(path.join(dir, "ffmpeg"));
    }
  }

  const seen = new Set();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function followRedirect(url, redirectsLeft = 8) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib
      .get(url, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume();
          resolve(followRedirect(res.headers.location, redirectsLeft - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        resolve(res);
      })
      .on("error", reject);
  });
}

async function downloadFile(url, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.partial`;
  const res = await followRedirect(url);
  await pipeline(res, createWriteStream(tmp));
  fs.renameSync(tmp, destPath);
}

function extractZip(zipPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  // Prefer system unzip / PowerShell Expand-Archive; fall back to `tar` (Windows 10+).
  if (process.platform === "win32") {
    const ps = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`,
      ],
      { encoding: "utf8" }
    );
    if (ps.status === 0) return;
  }
  const unzip = spawnSync("unzip", ["-o", zipPath, "-d", outDir], { encoding: "utf8" });
  if (unzip.status === 0) return;
  const tar = spawnSync("tar", ["-xf", zipPath, "-C", outDir], { encoding: "utf8" });
  if (tar.status === 0) return;
  throw new Error(
    `Failed to extract ${zipPath}. Install unzip, or use PowerShell Expand-Archive on Windows.`
  );
}

function findFfmpegExe(dir) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile() && ent.name.toLowerCase() === "ffmpeg.exe") {
        return full;
      }
    }
  }
  return null;
}

function stageBinary(sourceExe) {
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.copyFileSync(sourceExe, destFfmpeg);
}

function isCrossArchStage(stagedArch) {
  if (process.platform !== "win32") return true;
  const hostArm64 = process.arch === "arm64";
  const stagingArm64 = stagedArch === "winarm64";
  return hostArm64 !== stagingArm64;
}

function probeOrThrow(ffmpegPath, label, stagedArch) {
  // On non-Windows hosts we can still stage the .exe; probing may fail under Wine/qemu.
  // On Windows, an x64 host cannot execute a staged ARM64 ffmpeg.exe (and vice versa).
  if (process.platform !== "win32" || isCrossArchStage(stagedArch)) {
    if (!fs.existsSync(ffmpegPath) || fs.statSync(ffmpegPath).size === 0) {
      throw new Error(`${label}: staged binary missing or empty at ${ffmpegPath}`);
    }
    console.log(
      `bundle-windows-ffmpeg: skipped -version probe (${process.platform}/${process.arch}, staged ${stagedArch}); wrote ${path.relative(root, ffmpegPath)}`
    );
    return;
  }
  const probe = spawnSync(ffmpegPath, ["-version"], { encoding: "utf8" });
  if (probe.status !== 0 || !/ffmpeg version/i.test(probe.stdout || "")) {
    throw new Error(`${label}: ffmpeg -version failed for ${ffmpegPath}`);
  }
  if (!/libmp3lame/i.test(probe.stdout || "") && !/--enable-libmp3lame/i.test(probe.stdout || "")) {
    // Configuration line usually lists --enable-libmp3lame; some builds only show it via -encoders.
    const enc = spawnSync(ffmpegPath, ["-hide_banner", "-encoders"], { encoding: "utf8" });
    if (!/libmp3lame/i.test(enc.stdout || "")) {
      throw new Error(`${label}: bundled ffmpeg lacks libmp3lame (required for MP3 export)`);
    }
  }
}

async function downloadAndStage(arch) {
  const url = downloadUrl(arch);
  const zipName = path.basename(url);
  const zipPath = path.join(cacheDir, zipName);
  const extractRoot = path.join(cacheDir, `${arch}-extract`);

  fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size === 0) {
    console.log(`bundle-windows-ffmpeg: downloading ${url}`);
    await downloadFile(url, zipPath);
  } else {
    console.log(`bundle-windows-ffmpeg: using cached ${zipPath}`);
  }

  fs.rmSync(extractRoot, { recursive: true, force: true });
  extractZip(zipPath, extractRoot);
  const exe = findFfmpegExe(extractRoot);
  if (!exe) {
    throw new Error(`No ffmpeg.exe found inside ${zipName}`);
  }
  stageBinary(exe);
  probeOrThrow(destFfmpeg, "downloaded build", arch);
}

async function main() {
  const arch = resolveArch();
  const local = resolveLocalFfmpeg();
  if (local) {
    stageBinary(local);
    probeOrThrow(destFfmpeg, "local ffmpeg", arch);
    console.log(
      "bundle-windows-ffmpeg: wrote",
      path.relative(root, destFfmpeg),
      `(from ${local})`
    );
    return;
  }

  await downloadAndStage(arch);
  console.log(
    "bundle-windows-ffmpeg: wrote",
    path.relative(root, destFfmpeg),
    `(BtbN ${FFMPEG_SERIES} ${arch} static GPL)`
  );
}

main().catch((err) => {
  console.error("bundle-windows-ffmpeg:", err.message || err);
  process.exit(1);
});
