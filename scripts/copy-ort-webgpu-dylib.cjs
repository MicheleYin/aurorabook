#!/usr/bin/env node
/**
 * Optional: manually copy `libwebgpu_dawn.dylib` into `src-tauri/resources/ort-dylibs/`.
 * Release `tauri build` normally gets this from `build.rs` before `tauri-build` validates resources.
 * `ort` links the main binary with `@rpath/libwebgpu_dawn.dylib`; dev works because copy-dylibs
 * places the dylib next to the binary in target/. Release bundles only ship the executable unless
 * we add this copy + LC_RPATH (see src-tauri/.cargo/config.toml).
 */
const fs = require("fs");
const path = require("path");

const p = process.env.TAURI_ENV_PLATFORM || "";
if (p === "ios" || p === "android") {
  process.exit(0);
}
if (p && p !== "darwin") {
  process.exit(0);
}
if (!p && process.platform !== "darwin") {
  process.exit(0);
}

const root = path.join(__dirname, "..");
const tauriDir = path.join(root, "src-tauri");
const destDir = path.join(tauriDir, "resources", "ort-dylibs");
const dest = path.join(destDir, "libwebgpu_dawn.dylib");

function resolveCargoTargetDir() {
  const fromEnv = (process.env.CARGO_TARGET_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  // Match src-tauri/.cargo/config.toml target-dir → repo-root .cargo-target
  return path.resolve(tauriDir, "..", ".cargo-target");
}

const targetRoot = resolveCargoTargetDir();
const candidates = [
  path.join(targetRoot, "release", "libwebgpu_dawn.dylib"),
  path.join(targetRoot, "aarch64-apple-darwin", "release", "libwebgpu_dawn.dylib"),
  path.join(targetRoot, "x86_64-apple-darwin", "release", "libwebgpu_dawn.dylib"),
];

let src = null;
for (const p of candidates) {
  if (fs.existsSync(p)) {
    src = p;
    break;
  }
}

if (!src) {
  console.error(
    "copy-ort-webgpu-dylib: libwebgpu_dawn.dylib not found under",
    targetRoot,
    "(build the app with ort `webgpu` feature first)."
  );
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log("copy-ort-webgpu-dylib:", path.relative(root, src), "->", path.relative(root, dest));
