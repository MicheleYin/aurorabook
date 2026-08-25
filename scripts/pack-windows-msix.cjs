#!/usr/bin/env node
/**
 * Run `winapp pack` on staged MSIX layout folder(s).
 *
 * For Microsoft Store submission, omit WINAPP_DEV_CERT — unsigned MSIX is fine;
 * Partner Center re-signs after certification.
 *
 * For local sideload testing, set WINAPP_DEV_CERT to a .pfx (see signing/README.md).
 *
 * Usage:
 *   node scripts/pack-windows-msix.cjs --arch=x64
 *   node scripts/pack-windows-msix.cjs --arch=arm64
 *   node scripts/pack-windows-msix.cjs --bundle
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");

function syncStoreAssets() {
  const syncScript = path.join(__dirname, "sync-windows-store-assets.cjs");
  const result = spawnSync(process.execPath, [syncScript], {
    stdio: "inherit",
    cwd: root,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function hasArg(name) {
  return process.argv.includes(name);
}

function parseArchArg() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--arch=")) return arg.slice("--arch=".length).trim().toLowerCase();
  }
  return "";
}

function resolveArchs() {
  if (hasArg("--bundle")) return ["x64", "arm64"];
  const raw = parseArchArg();
  if (raw === "arm64" || raw === "aarch64") return ["arm64"];
  if (raw === "x64" || raw === "x86_64" || raw === "amd64") return ["x64"];
  console.error("pack-windows-msix: pass --arch=x64, --arch=arm64, or --bundle");
  process.exit(1);
}

function findManifest() {
  const candidates = [
    path.join(root, "Package.appxmanifest"),
    path.join(root, "appxmanifest.xml"),
    path.join(root, "src-tauri", "signing", "Package.appxmanifest"),
    path.join(root, "src-tauri", "signing", "appxmanifest.xml"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function runWinapp(args) {
  const result = spawnSync("winapp", args, {
    stdio: "inherit",
    cwd: root,
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error("pack-windows-msix: failed to run winapp:", result.error.message);
    console.error("  Install: winget install microsoft.winappcli --source winget");
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const manifest = findManifest();
if (!manifest) {
  console.error("pack-windows-msix: no Package.appxmanifest / appxmanifest.xml found.");
  console.error("  Run `winapp init` once (see src-tauri/signing/README.md).");
  process.exit(1);
}

const archs = resolveArchs();
const layoutDirs = [];
for (const arch of archs) {
  const dir = path.join(root, "msix-layout", arch);
  if (!fs.existsSync(dir)) {
    console.error("pack-windows-msix: missing staged layout:", path.relative(root, dir));
    console.error("  Run: node scripts/stage-windows-msix-layout.cjs --arch=" + arch);
    process.exit(1);
  }
  layoutDirs.push(dir);
}

const cert = (process.env.WINAPP_DEV_CERT || "").trim();
const certPassword = (process.env.WINAPP_DEV_CERT_PASSWORD || "password").trim();
const version = (() => {
  try {
    const conf = JSON.parse(
      fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")
    );
    const parts = String(conf.version || "0.0.0").split(".");
    while (parts.length < 4) parts.push("0");
    return parts.slice(0, 4).join(".");
  } catch {
    return null;
  }
})();

const args = ["pack", ...layoutDirs, "--manifest", manifest];
if (version) {
  args.push("--output", `AuroraBook_${version}.msix${layoutDirs.length > 1 ? "bundle" : ""}`);
}
if (cert) {
  args.push("--cert", cert, "--cert-password", certPassword);
  console.log("pack-windows-msix: signing with", path.relative(root, cert));
} else {
  console.log("pack-windows-msix: unsigned (OK for Microsoft Store submission)");
}

syncStoreAssets();
runWinapp(args);
