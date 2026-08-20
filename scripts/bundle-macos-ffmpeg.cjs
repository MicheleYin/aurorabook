#!/usr/bin/env node
/**
 * Stage a self-contained FFmpeg bundle for macOS Tauri builds:
 *   src-tauri/resources/ffmpeg-bin/ffmpeg
 *   src-tauri/resources/ffmpeg-bin/lib/*.dylib
 *
 * Copies the ffmpeg binary plus non-system dylib dependencies and rewrites load
 * paths to @loader_path so export works on machines without Homebrew.
 *
 * Usage:
 *   node scripts/bundle-macos-ffmpeg.cjs
 *   node scripts/bundle-macos-ffmpeg.cjs /path/to/ffmpeg
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const bundleDir = path.join(root, "src-tauri", "resources", "ffmpeg-bin");
const libDir = path.join(bundleDir, "lib");
const destFfmpeg = path.join(bundleDir, "ffmpeg");

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function resolveFfmpegSource() {
  const fromArg = (process.argv[2] || "").trim();
  const fromEnv = (
    process.env.AURORABOOK_FFMPEG ||
    process.env.MACOS_APPSTORE_FFMPEG ||
    ""
  ).trim();
  const candidates = [
    fromArg,
    fromEnv,
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ].filter(Boolean);

  for (const dir of (process.env.PATH || "").split(":").filter(Boolean)) {
    candidates.push(path.join(dir, "ffmpeg"));
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
      // ignore unreadable paths
    }
  }
  return null;
}

function dylibDeps(binaryPath) {
  const lines = run("otool", ["-L", binaryPath]).split("\n");
  const deps = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes(":")) continue;
    const depPath = trimmed.split(/\s+/)[0];
    if (!depPath.endsWith(".dylib")) continue;
    if (depPath.startsWith("/usr/lib/") || depPath.startsWith("/System/")) continue;
    if (depPath.startsWith("@")) continue;
    deps.push(depPath);
  }
  return deps;
}

function copyBinary(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, fs.readFileSync(src));
  ensureExecutable(dest);
}

function ensureExecutable(filePath) {
  const mode = fs.statSync(filePath).mode & 0o777;
  fs.chmodSync(filePath, mode | 0o755);
}

function collectDylibs(entryPath, collected) {
  for (const dep of dylibDeps(entryPath)) {
    if (collected.has(dep)) continue;
    collected.add(dep);
    collectDylibs(dep, collected);
  }
}

function adhocSignBundle() {
  if (!fs.existsSync(libDir)) return;
  for (const entry of fs.readdirSync(libDir)) {
    if (!entry.endsWith(".dylib")) continue;
    run("codesign", ["-s", "-", "-f", path.join(libDir, entry)]);
  }
  run("codesign", ["-s", "-", "-f", destFfmpeg]);
}

function bundleFfmpeg(source) {
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(libDir, { recursive: true });
  copyBinary(source, destFfmpeg);

  const deps = new Set();
  collectDylibs(source, deps);

  const destBySource = new Map();
  for (const depPath of deps) {
    const dest = path.join(libDir, path.basename(depPath));
    copyBinary(depPath, dest);
    destBySource.set(depPath, dest);
  }

  for (const [depPath, dest] of destBySource) {
    run("install_name_tool", ["-id", `@loader_path/${path.basename(dest)}`, dest]);
    for (const nested of dylibDeps(dest)) {
      const nestedDest = destBySource.get(nested);
      if (!nestedDest) continue;
      run("install_name_tool", [
        "-change",
        nested,
        `@loader_path/${path.basename(nestedDest)}`,
        dest,
      ]);
    }
  }

  for (const depPath of dylibDeps(destFfmpeg)) {
    const dest = destBySource.get(depPath);
    if (!dest) continue;
    run("install_name_tool", [
      "-change",
      depPath,
      `@loader_path/lib/${path.basename(dest)}`,
      destFfmpeg,
    ]);
  }

  adhocSignBundle();

  const probe = spawnSync(destFfmpeg, ["-version"], { encoding: "utf8" });
  if (probe.status !== 0 || !/ffmpeg version/i.test(probe.stdout || "")) {
    throw new Error(
      `Bundled ffmpeg at ${destFfmpeg} failed \`-version\`. Source: ${source}`
    );
  }
}

function main() {
  const source = resolveFfmpegSource();
  if (!source) {
    console.error("bundle-macos-ffmpeg: could not find ffmpeg.");
    console.error("Install with Homebrew (`brew install ffmpeg`) or set AURORABOOK_FFMPEG.");
    process.exit(1);
  }

  bundleFfmpeg(source);
  console.log(
    "bundle-macos-ffmpeg: wrote",
    path.relative(root, destFfmpeg),
    `(from ${source})`
  );
}

main();
