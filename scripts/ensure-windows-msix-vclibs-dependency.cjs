#!/usr/bin/env node
/**
 * Ensure Package.appxmanifest declares Microsoft.VCLibs.140.00.UWPDesktop.
 *
 * MSIX desktop apps link MSVCP140.dll at build time but cannot load the
 * machine-wide VC++ redistributable from System32 unless this framework
 * dependency is declared. Without it, AuroraBook fails at launch with
 * "MSVCP140.dll was not found" (often misread as MSVP140.dll).
 *
 * Usage (called automatically by pack-windows-msix.cjs):
 *   node scripts/ensure-windows-msix-vclibs-dependency.cjs --manifest Package.appxmanifest
 */
const fs = require("fs");
const path = require("path");

const VCLIBS_NAME = "Microsoft.VCLibs.140.00.UWPDesktop";
const VCLIBS_MIN_VERSION = "14.0.33728.0";
const VCLIBS_PUBLISHER =
  "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US";

function parseManifestArg() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--manifest=")) return arg.slice("--manifest=".length).trim();
  }
  return "";
}

function findManifest(root) {
  const fromArg = parseManifestArg();
  if (fromArg) {
    const resolved = path.isAbsolute(fromArg) ? fromArg : path.join(root, fromArg);
    if (fs.existsSync(resolved)) return resolved;
    console.error("ensure-windows-msix-vclibs-dependency: manifest not found:", fromArg);
    process.exit(1);
  }
  const candidates = [
    path.join(root, "Package.appxmanifest"),
    path.join(root, "appxmanifest.xml"),
    path.join(root, "src-tauri", "signing", "Package.appxmanifest"),
    path.join(root, "src-tauri", "signing", "appxmanifest.xml"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  console.error("ensure-windows-msix-vclibs-dependency: no Package.appxmanifest found.");
  process.exit(1);
}

function hasVclibsDependency(xml) {
  return xml.includes(VCLIBS_NAME);
}

function insertVclibsDependency(xml) {
  const dependencyLine = `    <PackageDependency Name="${VCLIBS_NAME}" MinVersion="${VCLIBS_MIN_VERSION}" Publisher="${VCLIBS_PUBLISHER}" />`;

  if (/<Dependencies>[\s\S]*?<\/Dependencies>/.test(xml)) {
    if (hasVclibsDependency(xml)) return xml;

    // Schema requires TargetDeviceFamily before PackageDependency.
    const targetFamily = /<TargetDeviceFamily[^>]*\/>/.exec(xml);
    if (targetFamily) {
      return xml.replace(targetFamily[0], `${targetFamily[0]}\n${dependencyLine}`);
    }

    return xml.replace(/(<Dependencies>\s*\n)/, `$1${dependencyLine}\n`);
  }

  const block = `  <Dependencies>\n    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.18362.0" MaxVersionTested="10.0.26200.0" />\n${dependencyLine}\n  </Dependencies>`;

  return xml.replace(/(\s*<Resources>)/, `\n${block}\n$1`);
}

const root = path.join(__dirname, "..");
const manifestPath = findManifest(root);
const original = fs.readFileSync(manifestPath, "utf8");

if (hasVclibsDependency(original)) {
  console.log(
    "ensure-windows-msix-vclibs-dependency:",
    path.relative(root, manifestPath),
    "already declares",
    VCLIBS_NAME
  );
  process.exit(0);
}

const updated = insertVclibsDependency(original);
fs.writeFileSync(manifestPath, updated, "utf8");
console.log(
  "ensure-windows-msix-vclibs-dependency: added",
  VCLIBS_NAME,
  "to",
  path.relative(root, manifestPath)
);
