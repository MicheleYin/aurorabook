#!/usr/bin/env node
/**
 * Resolve Visual Studio vcvarsall.bat and the profile for a Rust Windows target.
 *
 * Returns null when VS C++ tools are not installed.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function vswherePath() {
  const pf86 = process.env["ProgramFiles(x86)"];
  if (!pf86) return null;
  const candidate = path.join(pf86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  return fs.existsSync(candidate) ? candidate : null;
}

function findVsInstallRoot() {
  const vswhere = vswherePath();
  if (!vswhere) return null;
  const result = spawnSync(
    vswhere,
    [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) return null;
  const root = (result.stdout || "").trim();
  return root && fs.existsSync(root) ? root : null;
}

function vcvarsallPath(installRoot) {
  const candidate = path.join(installRoot, "VC", "Auxiliary", "Build", "vcvarsall.bat");
  return fs.existsSync(candidate) ? candidate : null;
}

/** @returns {"x64"|"arm64"|"x64_arm64"} */
function resolveVcvarsProfile(rustTarget) {
  const triple = (rustTarget || "").toLowerCase();
  const hostArm64 = process.arch === "arm64";
  const targetArm64 = triple.includes("aarch64") || triple.includes("arm64");

  if (hostArm64) {
    return targetArm64 ? "arm64" : "x64";
  }
  return targetArm64 ? "x64_arm64" : "x64";
}

function msvcVersions(installRoot) {
  const msvcRoot = path.join(installRoot, "VC", "Tools", "MSVC");
  if (!fs.existsSync(msvcRoot)) return [];
  return fs
    .readdirSync(msvcRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
}

function hasArm64Toolchain(installRoot, version) {
  const base = path.join(installRoot, "VC", "Tools", "MSVC", version);
  const lib = path.join(base, "lib", "arm64", "legacy_stdio_definitions.lib");
  const link = path.join(base, "bin", "Hostx64", "arm64", "link.exe");
  const hostArmLink = path.join(base, "bin", "HostArm64", "arm64", "link.exe");
  return (
    fs.existsSync(lib) && (fs.existsSync(link) || fs.existsSync(hostArmLink))
  );
}

function findMsvcVersionWithArm64Tools(installRoot) {
  for (const ver of msvcVersions(installRoot)) {
    if (hasArm64Toolchain(installRoot, ver)) return ver;
  }
  return null;
}

/** vcvarsall profile for the host shell (not always equal to resolveVcvarsProfile). */
function resolveVcvarsBatchProfile(rustTarget) {
  const profile = resolveVcvarsProfile(rustTarget);
  // Cross-compiling ARM64 from x64: keep x64 host tools on PATH/LIB first so
  // build scripts link with x64 link.exe + x64 libs; ARM64 lib dirs are appended separately.
  return profile === "x64_arm64" ? "x64" : profile;
}

function windowsSdkVersions() {
  const pf86 = process.env["ProgramFiles(x86)"];
  if (!pf86) return [];
  const kitsRoot = path.join(pf86, "Windows Kits", "10", "lib");
  if (!fs.existsSync(kitsRoot)) return [];
  return fs
    .readdirSync(kitsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^10\./.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();
}

/** Extra LIB entries required to link aarch64-pc-windows-msvc with an x64 host vcvars env. */
function arm64CrossCompileLibPaths(installRoot) {
  const arm64Ver = findMsvcVersionWithArm64Tools(installRoot);
  if (!arm64Ver) return [];
  const paths = [
    path.join(installRoot, "VC", "Tools", "MSVC", arm64Ver, "lib", "arm64"),
  ];
  for (const sdkVer of windowsSdkVersions()) {
    const pf86 = process.env["ProgramFiles(x86)"];
    const ucrt = path.join(pf86, "Windows Kits", "10", "lib", sdkVer, "ucrt", "arm64");
    const um = path.join(pf86, "Windows Kits", "10", "lib", sdkVer, "um", "arm64");
    if (fs.existsSync(ucrt)) paths.push(ucrt);
    if (fs.existsSync(um)) paths.push(um);
    if (paths.length > 1) break;
  }
  return paths.filter((p) => fs.existsSync(p));
}

function arm64CrossLinkPath(installRoot) {
  const arm64Ver = findMsvcVersionWithArm64Tools(installRoot);
  if (!arm64Ver) return null;
  const candidate = path.join(
    installRoot,
    "VC",
    "Tools",
    "MSVC",
    arm64Ver,
    "bin",
    "Hostx64",
    "arm64",
    "link.exe"
  );
  return fs.existsSync(candidate) ? candidate : null;
}

function clPathForProfile(installRoot, profile) {
  const msvcRoot = path.join(installRoot, "VC", "Tools", "MSVC");
  if (!fs.existsSync(msvcRoot)) return null;
  const rel =
    profile === "arm64"
      ? path.join("bin", "HostArm64", "arm64", "cl.exe")
      : profile === "x64_arm64"
        ? path.join("bin", "Hostx64", "arm64", "cl.exe")
        : path.join("bin", "Hostx64", "x64", "cl.exe");

  const needsArm64 = profile === "x64_arm64" || profile === "arm64";
  const preferred = needsArm64 ? findMsvcVersionWithArm64Tools(installRoot) : null;
  const versions = preferred
    ? [preferred, ...msvcVersions(installRoot).filter((v) => v !== preferred)]
    : msvcVersions(installRoot);

  for (const ver of versions) {
    const candidate = path.join(msvcRoot, ver, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function needsVcvarsForTarget(rustTarget) {
  const profile = resolveVcvarsProfile(rustTarget);
  return profile === "x64_arm64" || profile === "arm64";
}

function clOnPath() {
  if (process.platform !== "win32") return true;
  const result = spawnSync("where", ["cl"], { encoding: "utf8", shell: true });
  return result.status === 0 && (result.stdout || "").toLowerCase().includes("cl.exe");
}

function parseRustTargetFromArgs(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--target" && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith("--target=")) return argv[i].slice("--target=".length);
  }
  return "";
}

function msvcPrereqMessage(rustTarget) {
  const profile = resolveVcvarsProfile(rustTarget);
  const installRoot = findVsInstallRoot();
  const lines = [
    "MSVC C++ build tools are required for this Windows build but cl.exe is unavailable.",
  ];

  if (!installRoot) {
    lines.push(
      "",
      "Install Visual Studio 2022 Build Tools with:",
      "  - Desktop development with C++",
      profile === "x64_arm64"
        ? "  - MSVC v143 - VS 2022 C++ ARM64/ARM64EC build tools (for ARM64 cross-compile)"
        : ""
    );
    lines.push(
      "",
      "Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/",
      "Then reopen the terminal or run builds via scripts/with-msvc-env.cjs."
    );
    return lines.filter(Boolean).join("\n");
  }

  if (profile === "x64_arm64") {
    const arm64Cl = clPathForProfile(installRoot, "x64_arm64");
    if (!arm64Cl) {
      lines.push(
        "",
        "Visual Studio is installed, but ARM64 MSVC tools are missing.",
        "Open Visual Studio Installer → Modify Build Tools → Individual components, enable:",
        "  MSVC v143 - VS 2022 C++ ARM64/ARM64EC build tools (or latest ARM64 build tools)",
        "",
        "Then retry:",
        "  bun run build:windows:store:arm64"
      );
      return lines.join("\n");
    }
    const latest = msvcVersions(installRoot)[0];
    const arm64Ver = findMsvcVersionWithArm64Tools(installRoot);
    if (latest && arm64Ver && latest !== arm64Ver) {
      lines.push(
        "",
        `Note: newest MSVC toolset (${latest}) lacks ARM64 libs; builds will use ${arm64Ver} for ARM64 linking.`,
        "To avoid the mismatch, install ARM64 build tools for the latest MSVC version in Visual Studio Installer."
      );
    }
  }

  lines.push(
    "",
    "Visual Studio is installed but this shell lacks the MSVC environment.",
    "Either open \"x64 Native Tools Command Prompt for VS 2022\", or run:",
    "  node scripts/with-msvc-env.cjs -- bun run build:windows:store:x64"
  );
  return lines.join("\n");
}

module.exports = {
  findVsInstallRoot,
  vcvarsallPath,
  resolveVcvarsProfile,
  resolveVcvarsBatchProfile,
  msvcVersions,
  hasArm64Toolchain,
  findMsvcVersionWithArm64Tools,
  arm64CrossCompileLibPaths,
  arm64CrossLinkPath,
  clPathForProfile,
  clOnPath,
  needsVcvarsForTarget,
  parseRustTargetFromArgs,
  msvcPrereqMessage,
};
