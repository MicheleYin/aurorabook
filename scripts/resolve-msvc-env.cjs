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

function clPathForProfile(installRoot, profile) {
  const msvcRoot = path.join(installRoot, "VC", "Tools", "MSVC");
  if (!fs.existsSync(msvcRoot)) return null;
  const versions = fs
    .readdirSync(msvcRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  const rel =
    profile === "arm64"
      ? path.join("bin", "HostArm64", "arm64", "cl.exe")
      : profile === "x64_arm64"
        ? path.join("bin", "Hostx64", "arm64", "cl.exe")
        : path.join("bin", "Hostx64", "x64", "cl.exe");
  for (const ver of versions) {
    const candidate = path.join(msvcRoot, ver, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
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
  clPathForProfile,
  clOnPath,
  parseRustTargetFromArgs,
  msvcPrereqMessage,
};
