#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const args = process.argv.slice(2);
const sourceArg = args[0];

function fail(message) {
  console.error(`package-macos-appstore: ${message}`);
  process.exit(1);
}

function run(command, commandArgs, env = process.env) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    cwd: root,
    env,
  });
  if (result.error) fail(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!sourceArg || args.length !== 1) {
  fail("Usage: bun run package:macos:appstore -- <AuroraBook.app|.dmg>");
}

const sourcePath = path.resolve(sourceArg);
const sourceExtension = path.extname(sourcePath).toLowerCase();
if (sourceExtension !== ".app" && sourceExtension !== ".dmg") {
  fail("input must be an .app bundle or .dmg image");
}
if (!fs.existsSync(sourcePath)) fail(`input not found: ${sourcePath}`);

const appIdentity = (process.env.APPLE_SIGNING_IDENTITY || "").trim();
const installerIdentity = (
  process.env.APPLE_MACOS_INSTALLER_SIGNING_IDENTITY || ""
).trim();
const teamId = (
  process.env.APPLE_TEAM_ID ||
  process.env.APPLE_DEVELOPMENT_TEAM ||
  ""
).trim();
if (!/^[A-Z0-9]{10}$/i.test(teamId)) {
  fail("set APPLE_TEAM_ID to your 10-character Apple Developer Team ID");
}
if (!appIdentity || !installerIdentity) {
  fail("set APPLE_SIGNING_IDENTITY and APPLE_MACOS_INSTALLER_SIGNING_IDENTITY");
}

const config = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8")
);
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "aurorabook-appstore-package-")
);
const mountPath = path.join(tempDir, "mount");
const stagedApp = path.join(tempDir, `${config.productName}.app`);
fs.mkdirSync(mountPath);
let mounted = false;

process.on("exit", () => {
  if (mounted) spawnSync("/usr/bin/hdiutil", ["detach", mountPath, "-quiet"]);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function findAppBundle(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) return candidate;
    if (entry.isDirectory()) {
      const found = findAppBundle(candidate);
      if (found) return found;
    }
  }
  return null;
}

let sourceDir = sourcePath;
if (sourceExtension === ".dmg") {
  run("/usr/bin/hdiutil", [
    "attach",
    sourcePath,
    "-readonly",
    "-nobrowse",
    "-mountpoint",
    mountPath,
  ]);
  mounted = true;
  sourceDir = mountPath;
}

const sourceApp =
  sourceExtension === ".app" ? sourcePath : findAppBundle(sourceDir);
if (!sourceApp || !fs.statSync(sourceApp).isDirectory()) {
  fail(`no .app bundle found in ${sourceDir}`);
}

const appInfoPath = path.join(sourceApp, "Contents", "Info.plist");
const bundleIdResult = spawnSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleIdentifier", appInfoPath],
  { encoding: "utf8" }
);
if (bundleIdResult.status !== 0)
  fail(`could not read bundle ID from ${appInfoPath}`);
if (bundleIdResult.stdout.trim() !== config.identifier) {
  fail(
    `bundle ID mismatch: expected ${config.identifier}, got ${bundleIdResult.stdout.trim() || "(empty)"}`
  );
}

fs.cpSync(sourceApp, stagedApp, { recursive: true });
run("/usr/bin/xattr", ["-cr", stagedApp]);
run(process.execPath, [
  path.join(root, "scripts/ensure-macos-appstore-provisionprofile.cjs"),
]);
const profilePath = path.join(
  root,
  "src-tauri/signing/MacAppStore.provisionprofile"
);
fs.copyFileSync(
  profilePath,
  path.join(stagedApp, "Contents", "embedded.provisionprofile")
);
run(process.execPath, [
  path.join(root, "scripts/gen-macos-appstore-entitlements.cjs"),
]);

const defaultOutput = path.join(
  path.dirname(sourcePath),
  `${String(config.productName).replace(/[\\/]/g, "-")}.pkg`
);
const outputPath = path.resolve(
  (process.env.MACOS_APPSTORE_PKG_OUT || "").trim() || defaultOutput
);
if (path.extname(outputPath).toLowerCase() !== ".pkg") {
  fail("MACOS_APPSTORE_PKG_OUT must end in .pkg");
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const signerEnv = {
  ...process.env,
  MACOS_APPSTORE_APP_PATH: stagedApp,
  MACOS_APPSTORE_PKG_OUT: outputPath,
};
run(
  process.execPath,
  [path.join(root, "scripts/sign-macos-appstore-pkg.cjs")],
  signerEnv
);
console.log("package-macos-appstore: wrote", outputPath);
