#!/usr/bin/env node
/**
 * After `bun run build:macos:appstore`, builds a signed .pkg for App Store Connect upload
 * using xcrun productbuild (Mac Installer certificate).
 *
 * Requires:
 *   APPLE_MACOS_INSTALLER_SIGNING_IDENTITY — Mac *Installer* identity for productbuild .pkg, e.g.
 *     "3rd Party Mac Developer Installer: Your Name (XXXXXXXXXX)"
 *   APPLE_SIGNING_IDENTITY — Required when nested binaries are bundled (signs nested binaries + re-signs .app), e.g.
 *     "3rd Party Mac Developer Application: Your Name (XXXXXXXXXX)"
 *
 * Bundled nested binaries (for example `libwebgpu_dawn.dylib`, `ffmpeg`) must satisfy the app’s code
 * requirement (ITMS-90238); we sign each with `Entitlements.macos-appstore.nested-exec.plist` then
 * re-sign the .app with `Entitlements.macos-appstore.plist`.
 *
 * Optional:
 *   SKIP_MACOS_APPSTORE_PKG=1 — skip this step (e.g. you only need the .app)
 *   MACOS_APPSTORE_PKG_OUT — output .pkg path (default: next to the .app in bundle/macos/)
 *   CARGO_TARGET_DIR — where Cargo wrote the build (default: repo /.cargo-target per src-tauri/.cargo/config.toml)
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function runOrFail(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.status !== 0) {
    process.exit(result.status === null ? 1 : result.status);
  }
}

if (String(process.env.SKIP_MACOS_APPSTORE_PKG || "").trim() === "1") {
  console.log("sign-macos-appstore-pkg: SKIP_MACOS_APPSTORE_PKG=1, skipping .pkg signing.");
  process.exit(0);
}

const root = path.join(__dirname, "..");
const tauriDir = path.join(root, "src-tauri");
const confPath = path.join(tauriDir, "tauri.conf.json");

/** Matches `src-tauri/.cargo/config.toml` target-dir (repo `/.cargo-target`). Override with CARGO_TARGET_DIR. */
function resolveCargoTargetDir() {
  const fromEnv = (process.env.CARGO_TARGET_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(tauriDir, "..", "..", ".cargo-target");
}

const identity = (process.env.APPLE_MACOS_INSTALLER_SIGNING_IDENTITY || "").trim();
if (!identity) {
  console.error(
    "sign-macos-appstore-pkg: set APPLE_MACOS_INSTALLER_SIGNING_IDENTITY to your Mac Installer identity."
  );
  console.error('  Example: "3rd Party Mac Developer Installer: Your Name (TEAMID)"');
  console.error("  List identities: security find-identity -v");
  process.exit(1);
}

let productName;
try {
  const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
  productName = conf.productName;
} catch (e) {
  console.error("sign-macos-appstore-pkg: could not read productName from tauri.conf.json:", e.message);
  process.exit(1);
}
if (!productName) {
  console.error("sign-macos-appstore-pkg: tauri.conf.json missing productName.");
  process.exit(1);
}

const bundleSubpath = ["aarch64-apple-darwin", "release", "bundle", "macos"];

function bundleDirForTargetRoot(targetRoot) {
  return path.join(targetRoot, ...bundleSubpath);
}

let cargoTargetDir = resolveCargoTargetDir();
let bundleDir = bundleDirForTargetRoot(cargoTargetDir);
let appPath = path.join(bundleDir, `${productName}.app`);

if (!fs.existsSync(appPath)) {
  const legacyBundle = bundleDirForTargetRoot(path.join(tauriDir, "target"));
  const legacyApp = path.join(legacyBundle, `${productName}.app`);
  if (fs.existsSync(legacyApp)) {
    bundleDir = legacyBundle;
    appPath = legacyApp;
    console.warn(
      "sign-macos-appstore-pkg: using legacy src-tauri/target bundle (prefer .cargo-target per .cargo/config.toml)."
    );
  } else {
    console.error("sign-macos-appstore-pkg: app bundle not found:", appPath);
    console.error("  Also checked:", legacyApp);
    console.error("  CARGO_TARGET_DIR:", cargoTargetDir);
    console.error("  Run build:macos:appstore first (without SKIP_MACOS_APPSTORE_PKG during build).");
    process.exit(1);
  }
}

// ITMS-90238: bundled nested Mach-O binaries must be signed with app cert + nested entitlements.
const nestedBinaryCandidates = [
  path.join(appPath, "Contents", "Resources", "resources", "ort-dylibs", "libwebgpu_dawn.dylib"),
  path.join(appPath, "Contents", "Resources", "ort-dylibs", "libwebgpu_dawn.dylib"),
  path.join(appPath, "Contents", "Resources", "resources", "ffmpeg-bin", "ffmpeg"),
  path.join(appPath, "Contents", "Resources", "ffmpeg-bin", "ffmpeg"),
  path.join(appPath, "Contents", "Resources", "resources", "ffmpeg"),
  path.join(appPath, "Contents", "Resources", "ffmpeg"),
];

function collectFfmpegLibDylibs(appBundlePath) {
  const libDirs = [
    path.join(appBundlePath, "Contents", "Resources", "resources", "ffmpeg-bin", "lib"),
    path.join(appBundlePath, "Contents", "Resources", "ffmpeg-bin", "lib"),
  ];
  const out = [];
  for (const libDir of libDirs) {
    if (!fs.existsSync(libDir) || !fs.statSync(libDir).isDirectory()) continue;
    for (const entry of fs.readdirSync(libDir)) {
      const full = path.join(libDir, entry);
      if (entry.endsWith(".dylib") && fs.statSync(full).isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

const nestedBinaryPaths = [
  ...nestedBinaryCandidates.filter((p) => fs.existsSync(p) && fs.statSync(p).isFile()),
  ...collectFfmpegLibDylibs(appPath),
];

if (nestedBinaryPaths.length > 0) {
  const appSigningIdentity = (process.env.APPLE_SIGNING_IDENTITY || "").trim();
  if (!appSigningIdentity) {
    console.error(
      "sign-macos-appstore-pkg: nested binaries are present; set APPLE_SIGNING_IDENTITY (Mac App Store Application) to sign them and re-sign the .app."
    );
    console.error('  Example: "3rd Party Mac Developer Application: Your Name (TEAMID)"');
    process.exit(1);
  }

  const appStoreEntitlementsPath = path.join(tauriDir, "Entitlements.macos-appstore.plist");
  const nestedExecEntitlementsPath = path.join(tauriDir, "Entitlements.macos-appstore.nested-exec.plist");
  if (!fs.existsSync(appStoreEntitlementsPath)) {
    console.error(
      "sign-macos-appstore-pkg: missing app entitlements file:",
      appStoreEntitlementsPath
    );
    process.exit(1);
  }
  if (!fs.existsSync(nestedExecEntitlementsPath)) {
    console.error(
      "sign-macos-appstore-pkg: missing nested entitlements file:",
      nestedExecEntitlementsPath
    );
    process.exit(1);
  }

  // Nested binaries should only inherit sandbox entitlement; avoid hardened-runtime flags (ITMS-90885).
  for (const nestedPath of nestedBinaryPaths) {
    console.log("sign-macos-appstore-pkg: signing nested binary", path.relative(root, nestedPath));
    runOrFail(
      "codesign",
      [
        "--force",
        "--sign",
        appSigningIdentity,
        "--entitlements",
        nestedExecEntitlementsPath,
        nestedPath,
      ],
      { cwd: root }
    );
  }

  console.log("sign-macos-appstore-pkg: re-signing app bundle after nested signing");
  runOrFail(
    "codesign",
    [
      "--force",
      "--sign",
      appSigningIdentity,
      "--entitlements",
      appStoreEntitlementsPath,
      appPath,
    ],
    { cwd: root }
  );
} else {
  console.warn(
    "sign-macos-appstore-pkg: no nested binary found under",
    nestedBinaryCandidates.map((p) => path.relative(root, p)).join(" or ")
  );
}

const outPkg =
  (process.env.MACOS_APPSTORE_PKG_OUT || "").trim() ||
  path.join(bundleDir, `${productName.replace(/[\s/\\\(\)]/g, "")}.pkg`);

runOrFail(
  "xcrun",
  ["productbuild", "--sign", identity, "--component", appPath, "/Applications", outPkg],
  { cwd: root }
);

console.log("sign-macos-appstore-pkg: wrote", path.relative(root, outPkg));
