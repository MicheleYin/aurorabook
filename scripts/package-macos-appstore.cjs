#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function runOrFail(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const root = path.join(__dirname, "..");
const args = process.argv.slice(2);
const upload = args.includes("--upload");
const sourceArg = args.find((arg) => !arg.startsWith("--"));
const appIdentity = (process.env.APPLE_SIGNING_IDENTITY || "").trim();
const installerIdentity = (
  process.env.APPLE_MACOS_INSTALLER_SIGNING_IDENTITY || ""
).trim();
const teamId = (
  process.env.APPLE_TEAM_ID ||
  process.env.APPLE_DEVELOPMENT_TEAM ||
  ""
).trim();
const apiKeyId = (
  process.env.APPLE_API_KEY_ID ||
  process.env.APPLE_API_KEY ||
  ""
).trim();
const apiIssuer = (process.env.APPLE_API_ISSUER || "").trim();

if (!sourceArg) {
  console.error(
    "Usage: node scripts/package-macos-appstore.cjs <AuroraBook.app|AuroraBook.dmg> [--upload]"
  );
  process.exit(1);
}
const sourcePath = path.resolve(sourceArg);
if (!fs.existsSync(sourcePath)) {
  console.error("Input .app or .dmg not found:", sourcePath);
  process.exit(1);
}
if (!appIdentity || !installerIdentity || !teamId) {
  console.error(
    "Set APPLE_SIGNING_IDENTITY, APPLE_MACOS_INSTALLER_SIGNING_IDENTITY, and APPLE_TEAM_ID."
  );
  process.exit(1);
}
if (upload && (!apiKeyId || !apiIssuer)) {
  console.error(
    "--upload requires APPLE_API_KEY_ID (or APPLE_API_KEY) and APPLE_API_ISSUER."
  );
  process.exit(1);
}

const conf = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8")
);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurorabook-appstore-"));
const mountPath = path.join(tempDir, "mount");
const stagedApp = path.join(tempDir, `${conf.productName}.app`);
fs.mkdirSync(mountPath);
let mounted = false;
process.on("exit", () => {
  if (mounted) spawnSync("hdiutil", ["detach", mountPath, "-quiet"]);
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
if (path.extname(sourcePath).toLowerCase() === ".dmg") {
  runOrFail("hdiutil", [
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
const sourceApp = sourcePath.endsWith(".app")
  ? sourcePath
  : findAppBundle(sourceDir);
if (!sourceApp) {
  console.error("No .app bundle found in:", sourceDir);
  process.exit(1);
}
runOrFail("ditto", [sourceApp, stagedApp]);

const profilePath = path.resolve(
  process.env.MACOS_APPSTORE_PROVISIONPROFILE ||
    "src-tauri/signing/MacAppStore.provisionprofile"
);
if (!fs.existsSync(profilePath)) {
  console.error(
    "Set MACOS_APPSTORE_PROVISIONPROFILE or place the profile at:",
    profilePath
  );
  process.exit(1);
}
fs.copyFileSync(
  profilePath,
  path.join(stagedApp, "Contents", "embedded.provisionprofile")
);

runOrFail("node", [
  path.join(root, "scripts/gen-macos-appstore-entitlements.cjs"),
]);
const appEntitlements = path.join(
  root,
  "src-tauri/Entitlements.macos-appstore.plist"
);
const nestedEntitlements = path.join(
  root,
  "src-tauri/Entitlements.macos-appstore.nested-exec.plist"
);
const nestedBinaries = [
  path.join(
    stagedApp,
    "Contents/Resources/resources/ort-dylibs/libwebgpu_dawn.dylib"
  ),
  path.join(stagedApp, "Contents/Resources/resources/ffmpeg"),
].filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());

for (const binary of nestedBinaries) {
  runOrFail("codesign", [
    "--force",
    "--sign",
    appIdentity,
    "--entitlements",
    nestedEntitlements,
    binary,
  ]);
}
runOrFail("codesign", [
  "--force",
  "--sign",
  appIdentity,
  "--entitlements",
  appEntitlements,
  stagedApp,
]);
runOrFail("codesign", ["--verify", "--deep", "--strict", stagedApp]);

const pkgName = `${String(conf.productName).replace(/[\s/\\()]/g, "")}.pkg`;
const outputPath = path.resolve(
  process.env.MACOS_APPSTORE_PKG_OUT ||
    path.join(path.dirname(sourcePath), pkgName)
);
runOrFail("xcrun", [
  "productbuild",
  "--sign",
  installerIdentity,
  "--component",
  stagedApp,
  "/Applications",
  outputPath,
]);
console.log("package-macos-appstore: wrote", outputPath);

if (upload) {
  runOrFail("xcrun", [
    "altool",
    "--upload-app",
    "--type",
    "macos",
    "--file",
    outputPath,
    "--apiKey",
    apiKeyId,
    "--apiIssuer",
    apiIssuer,
  ]);
}
