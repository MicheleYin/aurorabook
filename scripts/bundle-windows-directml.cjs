#!/usr/bin/env node
/**
 * Stage a redistributable DirectML.dll for Windows Tauri builds:
 *   src-tauri/resources/ort-dylibs/DirectML.dll
 *
 * All pyke Windows ORT binaries link DirectML (even WebGPU x64 builds). ARM64
 * uses the DirectML EP explicitly. System DirectML.dll is often too old and
 * must be overridden by placing a current DLL next to AuroraBook.exe.
 *
 * Pin: Microsoft.AI.DirectML 1.15.4 (NuGet).
 *
 * Usage:
 *   node scripts/bundle-windows-directml.cjs
 *   AURORABOOK_FFMPEG_ARCH=arm64 node scripts/bundle-windows-directml.cjs
 *   node scripts/bundle-windows-directml.cjs --arch=x64
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { spawnSync } = require("child_process");
const { createWriteStream } = require("fs");
const { pipeline } = require("stream/promises");

const root = path.join(__dirname, "..");
const destDir = path.join(root, "src-tauri", "resources", "ort-dylibs");
const destDll = path.join(destDir, "DirectML.dll");
const cacheDir = path.join(root, ".cache", "directml-windows");

const DIRECTML_VERSION = "1.15.4";

function resolveArch() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--arch=")) {
      const v = arg.slice("--arch=".length).trim().toLowerCase();
      if (v === "arm64" || v === "aarch64" || v === "winarm64") return "arm64";
      if (v === "x64" || v === "x86_64" || v === "amd64" || v === "win64") return "x64";
    }
  }
  const fromEnv = (
    process.env.AURORABOOK_DIRECTML_ARCH ||
    process.env.AURORABOOK_FFMPEG_ARCH ||
    ""
  )
    .trim()
    .toLowerCase();
  if (fromEnv === "arm64" || fromEnv === "aarch64" || fromEnv === "winarm64") {
    return "arm64";
  }
  if (fromEnv === "x64" || fromEnv === "x86_64" || fromEnv === "amd64" || fromEnv === "win64") {
    return "x64";
  }
  const triple = (process.env.TAURI_ENV_TARGET_TRIPLE || "").toLowerCase();
  if (triple.includes("aarch64") || triple.includes("arm64")) return "arm64";
  if (process.arch === "arm64" && process.platform === "win32") return "arm64";
  return "x64";
}

function nugetUrl() {
  const v = DIRECTML_VERSION;
  return `https://api.nuget.org/v3-flatcontainer/microsoft.ai.directml/${v}/microsoft.ai.directml.${v}.nupkg`;
}

function nugetBinPath(arch) {
  // NuGet layout: bin/x64-win/DirectML.dll, bin/arm64-win/DirectML.dll
  return arch === "arm64" ? "bin/arm64-win/DirectML.dll" : "bin/x64-win/DirectML.dll";
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
  throw new Error(`Failed to extract ${zipPath}`);
}

function looksLikePe(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf[0] === 0x4d && buf[1] === 0x5a; // MZ
  } catch {
    return false;
  }
}

async function main() {
  const arch = resolveArch();
  const url = nugetUrl();
  const nupkg = path.join(cacheDir, `Microsoft.AI.DirectML.${DIRECTML_VERSION}.nupkg`);
  const extractRoot = path.join(cacheDir, `${DIRECTML_VERSION}-${arch}-extract`);
  const relDll = nugetBinPath(arch);

  fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(nupkg) || fs.statSync(nupkg).size === 0) {
    console.log(`bundle-windows-directml: downloading ${url}`);
    await downloadFile(url, nupkg);
  } else {
    console.log(`bundle-windows-directml: using cached ${nupkg}`);
  }

  fs.rmSync(extractRoot, { recursive: true, force: true });
  extractZip(nupkg, extractRoot);

  const src = path.join(extractRoot, ...relDll.split("/"));
  if (!fs.existsSync(src)) {
    throw new Error(`DirectML.dll not found at ${relDll} inside NuGet package`);
  }
  if (!looksLikePe(src)) {
    throw new Error(`Extracted DirectML.dll is not a PE binary: ${src}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, destDll);
  console.log(
    "bundle-windows-directml: wrote",
    path.relative(root, destDll),
    `(Microsoft.AI.DirectML ${DIRECTML_VERSION} ${arch})`
  );
}

main().catch((err) => {
  console.error("bundle-windows-directml:", err.message || err);
  process.exit(1);
});
