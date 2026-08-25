#!/usr/bin/env node
/**
 * Generate the Windows Store wide tile (310×150) by centering the 150×150 icon
 * on a white canvas. Writes src-tauri/icons/Wide310x150Logo.png.
 *
 * Usage:
 *   node scripts/generate-wide-tile.cjs
 *   node scripts/generate-wide-tile.cjs --source src-tauri/icons/Square150x150Logo.png
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const iconsDir = path.join(root, "src-tauri", "icons");
const defaultSource = path.join(iconsDir, "Square150x150Logo.png");
const output = path.join(iconsDir, "Wide310x150Logo.png");

function parseSourceArg() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--source=")) {
      return path.resolve(root, arg.slice("--source=".length));
    }
  }
  return defaultSource;
}

function generateWithPowerShell(sourcePath, outputPath) {
  const ps = `
Add-Type -AssemblyName System.Drawing
$sourcePath = ${JSON.stringify(sourcePath.replace(/\\/g, "\\\\"))}
$outputPath = ${JSON.stringify(outputPath.replace(/\\/g, "\\\\"))}
$canvasW = 310
$canvasH = 150
$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
  $bitmap = New-Object System.Drawing.Bitmap $canvasW, $canvasH
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $x = [int](($canvasW - $source.Width) / 2)
    $y = [int](($canvasH - $source.Height) / 2)
    $graphics.DrawImage($source, $x, $y, $source.Width, $source.Height)
  } finally {
    $graphics.Dispose()
  }
  $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
} finally {
  $source.Dispose()
}
Write-Output "OK"
`.trim();

  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
    { encoding: "utf8", cwd: root }
  );

  if (result.status !== 0 || !result.stdout.includes("OK")) {
    console.error("generate-wide-tile: PowerShell failed");
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
    process.exit(1);
  }
}

function generateWithImageMagick(sourcePath, outputPath) {
  const result = spawnSync(
    "magick",
    [
      "-size",
      "310x150",
      "xc:white",
      sourcePath,
      "-gravity",
      "center",
      "-composite",
      outputPath,
    ],
    { stdio: "inherit", cwd: root }
  );
  if (result.status !== 0) {
    console.error("generate-wide-tile: ImageMagick (magick) failed");
    process.exit(1);
  }
}

function generateWithConvert(sourcePath, outputPath) {
  const result = spawnSync(
    "convert",
    [
      "-size",
      "310x150",
      "xc:white",
      sourcePath,
      "-gravity",
      "center",
      "-composite",
      outputPath,
    ],
    { stdio: "inherit", cwd: root }
  );
  if (result.status !== 0) {
    console.error("generate-wide-tile: ImageMagick (convert) failed");
    process.exit(1);
  }
}

function commandExists(name) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [name], {
    encoding: "utf8",
    shell: true,
  });
  return result.status === 0;
}

const sourcePath = parseSourceArg();
if (!fs.existsSync(sourcePath)) {
  console.error("generate-wide-tile: source not found:", path.relative(root, sourcePath));
  console.error("  Generate square icons first (Square150x150Logo.png) or pass --source=...");
  process.exit(1);
}

fs.mkdirSync(iconsDir, { recursive: true });

if (process.platform === "win32") {
  generateWithPowerShell(sourcePath, output);
} else if (commandExists("magick")) {
  generateWithImageMagick(sourcePath, output);
} else if (commandExists("convert")) {
  generateWithConvert(sourcePath, output);
} else {
  console.error("generate-wide-tile: no supported image tool found.");
  console.error("  On Windows, System.Drawing is used automatically.");
  console.error("  On macOS/Linux, install ImageMagick (magick or convert).");
  process.exit(1);
}

console.log("generate-wide-tile:", path.relative(root, output));
