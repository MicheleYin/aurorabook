#!/usr/bin/env node
/**
 * Run a command with MSVC environment loaded via vcvarsall.bat.
 *
 * Usage:
 *   node scripts/with-msvc-env.cjs -- bun run build:windows:store:x64
 *   node scripts/with-msvc-env.cjs --target aarch64-pc-windows-msvc -- node scripts/tauri-cli.cjs build ...
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  findVsInstallRoot,
  vcvarsallPath,
  resolveVcvarsProfile,
  clPathForProfile,
  clOnPath,
  parseRustTargetFromArgs,
  msvcPrereqMessage,
} = require("./resolve-msvc-env.cjs");

function parseArgs(argv) {
  const sep = argv.indexOf("--");
  let rustTarget = "";
  const before = sep >= 0 ? argv.slice(0, sep) : argv;
  const cmd = sep >= 0 ? argv.slice(sep + 1) : [];

  for (let i = 0; i < before.length; i += 1) {
    if (before[i] === "--target" && before[i + 1]) {
      rustTarget = before[i + 1];
      i += 1;
    } else if (before[i].startsWith("--target=")) {
      rustTarget = before[i].slice("--target=".length);
    }
  }

  if (!rustTarget) {
    rustTarget = parseRustTargetFromArgs(cmd);
  }

  if (cmd.length === 0) {
    console.error("with-msvc-env: pass a command after `--`");
    process.exit(1);
  }

  return { rustTarget, cmd };
}

function quoteCmd(part) {
  if (!/\s|[&|<>^"]/.test(part)) return part;
  return `"${part.replace(/"/g, '""')}"`;
}

function main() {
  if (process.platform !== "win32") {
    const { cmd } = parseArgs(process.argv.slice(2));
    const result = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit", shell: false });
    process.exit(result.status === null ? 1 : result.status);
  }

  const { rustTarget, cmd } = parseArgs(process.argv.slice(2));
  const profile = resolveVcvarsProfile(rustTarget);

  if (clOnPath()) {
    const result = spawnSync(cmd[0], cmd.slice(1), {
      stdio: "inherit",
      cwd: path.join(__dirname, ".."),
      shell: cmd[0].endsWith(".cmd") || cmd[0].endsWith(".bat"),
    });
    process.exit(result.status === null ? 1 : result.status);
  }

  const installRoot = findVsInstallRoot();
  const vcvars = installRoot ? vcvarsallPath(installRoot) : null;
  const cl = installRoot ? clPathForProfile(installRoot, profile) : null;

  if (!vcvars || !cl) {
    console.error(msvcPrereqMessage(rustTarget));
    process.exit(1);
  }

  const root = path.join(__dirname, "..");
  const commandLine = cmd.map(quoteCmd).join(" ");
  const tmpBat = path.join(os.tmpdir(), `aurorabook-msvc-${process.pid}.cmd`);
  const batContents = [
    "@echo off",
    `call "${vcvars}" ${profile}`,
    "if errorlevel 1 exit /b 1",
    `cd /d "${root}"`,
    commandLine,
  ].join("\r\n");

  fs.writeFileSync(tmpBat, batContents, "utf8");

  console.log(`with-msvc-env: vcvarsall ${profile} → ${cmd.join(" ")}`);
  const result = spawnSync("cmd.exe", ["/d", "/c", tmpBat], {
    stdio: "inherit",
    cwd: root,
  });

  try {
    fs.unlinkSync(tmpBat);
  } catch {
    // ignore
  }

  process.exit(result.status === null ? 1 : result.status);
}

main();
