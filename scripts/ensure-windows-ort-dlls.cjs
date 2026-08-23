#!/usr/bin/env node
/**
 * Ensure Windows ORT helper DLLs are staged for bundling:
 *   - DirectML.dll (all Windows arches; redistributable from NuGet)
 *   - webgpu_dawn.dll (+ dxil/dxcompiler when present) on x86_64 only
 *
 * Used as `beforeBundleCommand` (after cargo) so Dawn from ort copy-dylibs exists.
 * Safe to run before cargo as well: pass nothing and Dawn is skipped if missing,
 * or pass `--require-dawn` to fail hard (beforeBundleCommand).
 *
 * Usage:
 *   node scripts/ensure-windows-ort-dlls.cjs
 *   node scripts/ensure-windows-ort-dlls.cjs --arch=arm64
 *   node scripts/ensure-windows-ort-dlls.cjs --arch=x64 --require-dawn
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { resolveCargoTargetDir } = require("./resolve-cargo-target-dir.cjs");

const root = path.join(__dirname, "..");

function parseArchArg() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--arch=")) return arg.slice("--arch=".length).trim().toLowerCase();
  }
  return (
    process.env.AURORABOOK_DIRECTML_ARCH ||
    process.env.AURORABOOK_FFMPEG_ARCH ||
    ""
  )
    .trim()
    .toLowerCase();
}

function resolveArch() {
  const raw = parseArchArg();
  if (raw === "arm64" || raw === "aarch64" || raw === "winarm64") return "arm64";
  if (raw === "x64" || raw === "x86_64" || raw === "amd64" || raw === "win64") return "x64";
  const triple = (process.env.TAURI_ENV_TARGET_TRIPLE || "").toLowerCase();
  if (triple.includes("aarch64") || triple.includes("arm64")) return "arm64";
  if (process.platform === "win32" && process.arch === "arm64") return "arm64";
  return "x64";
}

function run(script, extraArgs = []) {
  const result = spawnSync(process.execPath, [script, ...extraArgs], {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
  return result.status === null ? 1 : result.status;
}

const requireDawn =
  process.argv.includes("--require-dawn") ||
  process.env.AURORABOOK_REQUIRE_DAWN === "1";

const arch = resolveArch();
process.env.AURORABOOK_DIRECTML_ARCH = arch;
process.env.AURORABOOK_FFMPEG_ARCH = arch === "arm64" ? "arm64" : "x64";

{
  const status = run(path.join(__dirname, "bundle-windows-directml.cjs"), [
    `--arch=${arch}`,
  ]);
  if (status !== 0) process.exit(status);
}

// Also place DirectML.dll beside the built exe when present (NSIS sibling / load-time).
const targetRoot = resolveCargoTargetDir(root);
const dmlSrc = path.join(root, "src-tauri", "resources", "ort-dylibs", "DirectML.dll");
const siblingCandidates = [
  path.join(targetRoot, "release"),
  path.join(targetRoot, "x86_64-pc-windows-msvc", "release"),
  path.join(targetRoot, "aarch64-pc-windows-msvc", "release"),
];
if (fs.existsSync(dmlSrc) && fs.statSync(dmlSrc).size > 64) {
  for (const dir of siblingCandidates) {
    const exe = path.join(dir, "aurorabook.exe");
    const exe2 = path.join(dir, "AuroraBook.exe");
    if (fs.existsSync(exe) || fs.existsSync(exe2)) {
      const dest = path.join(dir, "DirectML.dll");
      const needsCopy =
        !fs.existsSync(dest) ||
        fs.lstatSync(dest).isSymbolicLink() ||
        fs.statSync(dest).size <= 64;
      if (needsCopy) {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        fs.copyFileSync(dmlSrc, dest);
        console.log("ensure-windows-ort-dlls: also", path.relative(root, dest), "(beside exe)");
      }
    }
  }
}

if (arch !== "arm64") {
  const status = run(path.join(__dirname, "copy-ort-webgpu-dylib.cjs"));
  if (status !== 0) {
    if (requireDawn) {
      process.exit(status);
    }
    console.log(
      "ensure-windows-ort-dlls: Dawn not available yet (ok before cargo build); will refresh in beforeBundleCommand"
    );
  }
} else {
  console.log("ensure-windows-ort-dlls: ARM64 — DirectML only (skip Dawn)");
}
