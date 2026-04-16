#!/usr/bin/env node
/**
 * After `bun run build:macos:appstore`, builds a signed .pkg for App Store Connect upload
 * using xcrun productbuild (Mac Installer certificate).
 *
 * Nested `resources/ffmpeg` is re-signed with Entitlements.macos-appstore.nested-exec.plist only
 * (inherit sandbox from parent; no application-identifier) so TestFlight accepts ITMS-90885.
 *
 * Requires:
 *   APPLE_MACOS_INSTALLER_SIGNING_IDENTITY — full name from Keychain, e.g.
 *     "3rd Party Mac Developer Installer: Your Name (XXXXXXXXXX)"
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

const appSigningIdentity = (process.env.APPLE_SIGNING_IDENTITY || "").trim();
if (!appSigningIdentity) {
  console.error(
    "sign-macos-appstore-pkg: set APPLE_SIGNING_IDENTITY so bundled executables can be signed with sandbox entitlements."
  );
  console.error('  Example: "3rd Party Mac Developer Application: Your Name (TEAMID)"');
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

// App Store validation requires nested executables to carry sandbox entitlements.
const ffmpegPath = path.join(
  appPath,
  "Contents",
  "Resources",
  "resources",
  "ffmpeg"
);
if (fs.existsSync(ffmpegPath)) {
  const appStoreEntitlementsPath = path.join(tauriDir, "Entitlements.macos-appstore.plist");
  const nestedExecEntitlementsPath = path.join(
    tauriDir,
    "Entitlements.macos-appstore.nested-exec.plist"
  );
  if (!fs.existsSync(appStoreEntitlementsPath)) {
    console.error(
      "sign-macos-appstore-pkg: missing app entitlements file:",
      appStoreEntitlementsPath
    );
    process.exit(1);
  }
  if (!fs.existsSync(nestedExecEntitlementsPath)) {
    console.error(
      "sign-macos-appstore-pkg: missing nested executable entitlements file:",
      nestedExecEntitlementsPath
    );
    process.exit(1);
  }

  // Clear any signature that picked up app-style entitlements (fixes ITMS-90885 on TestFlight).
  spawnSync("codesign", ["--remove-signature", ffmpegPath], {
    stdio: "ignore",
    cwd: root,
  });

  console.log("sign-macos-appstore-pkg: signing nested executable", path.relative(root, ffmpegPath));
  runOrFail(
    "codesign",
    [
      "--force",
      "--sign",
      appSigningIdentity,
      "--entitlements",
      nestedExecEntitlementsPath,
      "--options",
      "runtime",
      "--timestamp",
      ffmpegPath,
    ],
    { cwd: root }
  );

  runOrFail("codesign", ["--verify", "--verbose", ffmpegPath], { cwd: root });

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
    "sign-macos-appstore-pkg: bundled ffmpeg not found; skipping nested executable signing at",
    ffmpegPath
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
