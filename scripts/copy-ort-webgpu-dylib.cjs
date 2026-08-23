#!/usr/bin/env node
/**
 * Copy Dawn / WebGPU helper libs into:
 *   1) src-tauri/resources/ort-dylibs/  (Tauri bundle resources)
 *   2) next to the built Windows exe under CARGO_TARGET_DIR (NSIS sibling pickup)
 *
 * Also used as `beforeBundleCommand` on Windows so the *real* DLL from ort's
 * copy-dylibs overwrites any build.rs placeholder before packaging.
 *
 * macOS: libwebgpu_dawn.dylib (+ LC_RPATH in src-tauri/.cargo/config.toml)
 * Windows x86_64: webgpu_dawn.dll (+ dxil.dll / dxcompiler.dll when present)
 * Windows ARM64: DirectML (no Dawn) — no-op
 *
 * Critical on Windows: webgpu_dawn.dll is a load-time dependency of the ORT
 * WebGPU build. It must sit next to AuroraBook.exe (not only under resources/).
 * We copy it beside the built exe here; the NSIS POSTINSTALL hook also promotes
 * it from resources/ort-dylibs/ to the install root (resource maps to the
 * install root break tauri_build on Windows).
 */
const fs = require("fs");
const path = require("path");
const { resolveCargoTargetDir } = require("./resolve-cargo-target-dir.cjs");

const p = process.env.TAURI_ENV_PLATFORM || "";
if (p === "ios" || p === "android") {
  process.exit(0);
}

const root = path.join(__dirname, "..");
const tauriDir = path.join(root, "src-tauri");
const destDir = path.join(tauriDir, "resources", "ort-dylibs");

const targetRoot = resolveCargoTargetDir(root);
const triple = (process.env.TAURI_ENV_TARGET_TRIPLE || "").toLowerCase();
const isWinArm =
  triple.includes("aarch64-pc-windows") ||
  (process.platform === "win32" && process.arch === "arm64" && !triple);
const isWindows =
  p === "windows" ||
  process.platform === "win32" ||
  triple.includes("windows");
const isMac =
  p === "darwin" ||
  process.platform === "darwin" ||
  triple.includes("apple-darwin");

if (isWinArm) {
  console.log("copy-ort-webgpu-dylib: Windows ARM64 uses DirectML — skipping Dawn copy");
  process.exit(0);
}

if (!isMac && !isWindows) {
  // Cross-staging Windows from Linux/macOS CI when TAURI_ENV_PLATFORM=windows.
  if ((process.env.AURORABOOK_COPY_ORT_PLATFORM || "").toLowerCase() !== "windows") {
    process.exit(0);
  }
}

const names = isMac
  ? ["libwebgpu_dawn.dylib"]
  : ["webgpu_dawn.dll", "dxil.dll", "dxcompiler.dll"];

const candidatesFor = (name) => [
  path.join(destDir, name),
  path.join(targetRoot, "release", name),
  path.join(targetRoot, "debug", name),
  path.join(targetRoot, "aarch64-apple-darwin", "release", name),
  path.join(targetRoot, "x86_64-apple-darwin", "release", name),
  path.join(targetRoot, "x86_64-pc-windows-msvc", "release", name),
  path.join(targetRoot, "x86_64-pc-windows-msvc", "debug", name),
  path.join(targetRoot, "i686-pc-windows-msvc", "release", name),
];

/** Directories that may contain the app executable — copy Dawn beside it for Windows. */
function exeSiblingDirs() {
  if (isMac) return [];
  return [
    path.join(targetRoot, "release"),
    path.join(targetRoot, "debug"),
    path.join(targetRoot, "x86_64-pc-windows-msvc", "release"),
    path.join(targetRoot, "x86_64-pc-windows-msvc", "debug"),
  ].filter((dir) => {
    try {
      return (
        fs.existsSync(path.join(dir, "aurorabook.exe")) ||
        fs.existsSync(path.join(dir, "AuroraBook.exe"))
      );
    } catch {
      return false;
    }
  });
}

fs.mkdirSync(destDir, { recursive: true });

function shouldReplaceDll(dest, src) {
  if (!fs.existsSync(dest)) return true;
  if (path.resolve(dest) === path.resolve(src)) return false;
  const st = fs.lstatSync(dest);
  if (st.isSymbolicLink()) return true;
  return st.size <= 64;
}

function copyDllBesideExe(src, sibling) {
  if (path.resolve(src) === path.resolve(sibling)) return;
  if (!shouldReplaceDll(sibling, src)) return;
  if (fs.existsSync(sibling)) {
    fs.unlinkSync(sibling);
  }
  fs.copyFileSync(src, sibling);
}

let copied = 0;
const siblingDirs = exeSiblingDirs();

for (const name of names) {
  let src = null;
  for (const c of candidatesFor(name)) {
    if (fs.existsSync(c) && fs.statSync(c).size > 64) {
      src = c;
      break;
    }
  }
  if (!src) {
    if (name === names[0]) {
      console.error(
        "copy-ort-webgpu-dylib:",
        name,
        "not found under",
        targetRoot,
        "(build the app with ort `webgpu` feature first)."
      );
      process.exit(1);
    }
    continue;
  }

  const dest = path.join(destDir, name);
  if (shouldReplaceDll(dest, src)) {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.copyFileSync(src, dest);
  }
  console.log("copy-ort-webgpu-dylib:", path.relative(root, src), "->", path.relative(root, dest));
  copied += 1;

  for (const dir of siblingDirs) {
    const sibling = path.join(dir, name);
    copyDllBesideExe(src, sibling);
    if (fs.existsSync(sibling) && fs.statSync(sibling).size > 64) {
      console.log(
        "copy-ort-webgpu-dylib: also",
        path.relative(root, sibling),
        "(beside exe)"
      );
    }
  }
}

if (copied === 0) {
  process.exit(1);
}
