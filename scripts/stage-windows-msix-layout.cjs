#!/usr/bin/env node
/**
 * Stage a loose MSIX layout folder for `winapp pack`.
 *
 * Copies the release exe, load-time ORT DLLs beside it, and bundled resources.
 * Mirrors what the NSIS POSTINSTALL hook promotes to the install root.
 *
 * Usage:
 *   node scripts/stage-windows-msix-layout.cjs --arch=x64
 *   node scripts/stage-windows-msix-layout.cjs --arch=arm64
 *
 * Output:
 *   msix-layout/x64/   (or msix-layout/arm64/)
 */
const fs = require("fs");
const path = require("path");
const { resolveCargoTargetDir } = require("./resolve-cargo-target-dir.cjs");

const root = path.join(__dirname, "..");

function parseArchArg() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--arch=")) return arg.slice("--arch=".length).trim().toLowerCase();
  }
  return "";
}

function resolveArch() {
  const raw = parseArchArg();
  if (raw === "arm64" || raw === "aarch64") return "arm64";
  if (raw === "x64" || raw === "x86_64" || raw === "amd64") return "x64";
  console.error("stage-windows-msix-layout: pass --arch=x64 or --arch=arm64");
  process.exit(1);
}

function rimraf(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) copyFile(from, to);
  }
}

const arch = resolveArch();
const rustTarget =
  arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
const releaseDir = path.join(resolveCargoTargetDir(root), rustTarget, "release");

const exeCandidates = ["AuroraBook.exe", "aurorabook.exe"];
let exeSrc = null;
for (const name of exeCandidates) {
  const candidate = path.join(releaseDir, name);
  if (fs.existsSync(candidate)) {
    exeSrc = candidate;
    break;
  }
}
if (!exeSrc) {
  console.error("stage-windows-msix-layout: release exe not found under", releaseDir);
  console.error("  Run a Windows release build first (e.g. bun run build:windows:store:x64).");
  process.exit(1);
}

const layoutRoot = path.join(root, "msix-layout", arch);
rimraf(layoutRoot);
fs.mkdirSync(layoutRoot, { recursive: true });

const exeName = path.basename(exeSrc);
copyFile(exeSrc, path.join(layoutRoot, exeName));
console.log("stage-windows-msix-layout:", path.relative(root, path.join(layoutRoot, exeName)));

const ortDylibs = path.join(root, "src-tauri", "resources", "ort-dylibs");
const siblingDlls =
  arch === "arm64"
    ? ["DirectML.dll"]
    : ["DirectML.dll", "webgpu_dawn.dll", "dxil.dll", "dxcompiler.dll"];

for (const dll of siblingDlls) {
  let src = path.join(releaseDir, dll);
  if (!fs.existsSync(src) || fs.statSync(src).size <= 64) {
    src = path.join(ortDylibs, dll);
  }
  if (fs.existsSync(src) && fs.statSync(src).size > 64) {
    copyFile(src, path.join(layoutRoot, dll));
    console.log("stage-windows-msix-layout:", dll, "(beside exe)");
  } else if (arch === "x64" && dll === "webgpu_dawn.dll") {
    console.error("stage-windows-msix-layout: missing webgpu_dawn.dll — x64 Store builds need Dawn.");
    process.exit(1);
  } else if (dll === "DirectML.dll") {
    console.error("stage-windows-msix-layout: missing DirectML.dll.");
    process.exit(1);
  }
}

const resourcesSrc = path.join(root, "src-tauri", "resources");
copyDir(resourcesSrc, path.join(layoutRoot, "resources"));
console.log("stage-windows-msix-layout: resources/");

console.log("stage-windows-msix-layout: wrote", path.relative(root, layoutRoot));
