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
const archiveArg = args.find((arg) => !arg.startsWith("--"));
const archivePath = path.resolve(
  archiveArg || "src-tauri/gen/apple/build/aurorabook_iOS.xcarchive"
);
const apiKeyId = (
  process.env.APPLE_API_KEY_ID ||
  process.env.APPLE_API_KEY ||
  ""
).trim();
const apiIssuer = (process.env.APPLE_API_ISSUER || "").trim();
const apiKeyPath = (process.env.APPLE_API_KEY_PATH || "").trim();
const teamId = (
  process.env.APPLE_TEAM_ID ||
  process.env.APPLE_DEVELOPMENT_TEAM ||
  ""
).trim();

if (!fs.existsSync(archivePath) || !archivePath.endsWith(".xcarchive")) {
  console.error(
    "Usage: node scripts/sign-ios-appstore.cjs <archive.xcarchive> [--upload]"
  );
  process.exit(1);
}
if (!apiKeyId || !apiIssuer || !apiKeyPath || !fs.existsSync(apiKeyPath)) {
  console.error(
    "Set APPLE_API_KEY_ID, APPLE_API_ISSUER, and APPLE_API_KEY_PATH to an App Store Connect API key."
  );
  process.exit(1);
}
if (!teamId) {
  console.error(
    "Set APPLE_TEAM_ID to the Apple Developer team that owns this app."
  );
  process.exit(1);
}

const exportDir = path.resolve(
  process.env.IOS_APPSTORE_EXPORT_DIR ||
    path.join(path.dirname(archivePath), "ios-appstore-export")
);
const optionsPath = path.join(
  os.tmpdir(),
  `aurorabook-export-${process.pid}.plist`
);
const options = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>signingStyle</key><string>automatic</string>
<key>teamID</key><string>${teamId}</string>
<key>uploadSymbols</key><true/>
</dict></plist>
`;

fs.rmSync(exportDir, { recursive: true, force: true });
fs.mkdirSync(exportDir, { recursive: true });
fs.writeFileSync(optionsPath, options);
try {
  runOrFail("xcodebuild", [
    "-exportArchive",
    "-archivePath",
    archivePath,
    "-exportOptionsPlist",
    optionsPath,
    "-exportPath",
    exportDir,
    "-allowProvisioningUpdates",
    "-authenticationKeyPath",
    path.resolve(apiKeyPath),
    "-authenticationKeyID",
    apiKeyId,
    "-authenticationKeyIssuerID",
    apiIssuer,
  ]);
} finally {
  fs.rmSync(optionsPath, { force: true });
}

const ipaPath = fs
  .readdirSync(exportDir)
  .filter((name) => name.endsWith(".ipa"))
  .map((name) => path.join(exportDir, name))[0];
if (!ipaPath) {
  console.error("No .ipa was exported by Xcode from:", archivePath);
  process.exit(1);
}
console.log("sign-ios-appstore: exported", ipaPath);

if (upload) {
  runOrFail("xcrun", [
    "altool",
    "--upload-app",
    "--type",
    "ios",
    "--file",
    ipaPath,
    "--apiKey",
    apiKeyId,
    "--apiIssuer",
    apiIssuer,
  ]);
}
