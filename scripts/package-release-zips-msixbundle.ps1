param(
  [string]$X64Zip,

  [string]$Arm64Zip,

  [string]$OutputDirectory,

  [switch]$Force,

  [switch]$Help
)

$ErrorActionPreference = 'Stop'

if ($Help) {
  Write-Host 'Usage: .\scripts\package-release-zips-msixbundle.ps1 -X64Zip <x64.zip> -Arm64Zip <arm64.zip> [-OutputDirectory <folder>] [-Force]'
  Write-Host 'Creates architecture-specific .msix packages and one combined .msixbundle.'
  exit 0
}

if ([string]::IsNullOrWhiteSpace($X64Zip)) {
  $X64Zip = Read-Host 'Path to the x64 GitHub Actions ZIP'
}
if ([string]::IsNullOrWhiteSpace($Arm64Zip)) {
  $Arm64Zip = Read-Host 'Path to the ARM64 GitHub Actions ZIP'
}

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$x64ZipPath = (Resolve-Path -LiteralPath $X64Zip).Path
$arm64ZipPath = (Resolve-Path -LiteralPath $Arm64Zip).Path
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $outputPath = $root
} else {
  $outputPath = [IO.Path]::GetFullPath($OutputDirectory)
}

foreach ($zipPath in @($x64ZipPath, $arm64ZipPath)) {
  if ([IO.Path]::GetExtension($zipPath) -ine '.zip') {
    throw "Expected a ZIP file: $zipPath"
  }
}
if ($x64ZipPath -eq $arm64ZipPath) {
  throw 'Pass separate ZIP files for x64 and ARM64.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js was not found on PATH.'
}

$config = Get-Content -LiteralPath (Join-Path $root 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$versionParts = @(([string]$config.version).Split('.'))
while ($versionParts.Count -lt 4) { $versionParts += '0' }
$version = ($versionParts | Select-Object -First 4) -join '.'
$outputNames = @(
  "AuroraBook_${version}_x64.msix",
  "AuroraBook_${version}_arm64.msix",
  "AuroraBook_${version}.msixbundle"
)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
foreach ($name in $outputNames) {
  $destination = Join-Path $outputPath $name
  if ((Test-Path -LiteralPath $destination) -and -not $Force) {
    throw "Output already exists: $destination (pass -Force to replace it)."
  }
}

$workRoot = Join-Path ([IO.Path]::GetTempPath()) ('aurorabook-msix-' + [guid]::NewGuid().ToString('N'))
$packer = Join-Path $PSScriptRoot 'pack-windows-msix.cjs'

function Get-Installer([string]$ArchivePath, [string]$Arch, [string]$ExtractPath) {
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractPath
  if ($Arch -eq 'x64') {
    $pattern = '(?i)(x64|x86_64|amd64).*setup\.exe$'
  } else {
    $pattern = '(?i)(arm64|aarch64).*setup\.exe$'
  }
  $matches = @(Get-ChildItem -LiteralPath $ExtractPath -Filter '*setup.exe' -File -Recurse | Where-Object { $_.Name -match $pattern })
  if ($matches.Count -ne 1) {
    throw "Expected one $Arch NSIS setup executable in '$ArchivePath'; found $($matches.Count)."
  }
  return $matches[0]
}

function Stage-InstalledApp([string]$ArchivePath, [string]$Arch) {
  $extractPath = Join-Path $workRoot "source-$Arch"
  $installPath = Join-Path $workRoot "install-$Arch"
  $layoutPath = Join-Path $root "msix-layout\$Arch"
  New-Item -ItemType Directory -Path $extractPath, $installPath -Force | Out-Null

  $installer = Get-Installer -ArchivePath $ArchivePath -Arch $Arch -ExtractPath $extractPath
  $installArgument = "/D=`"$installPath`""
  $process = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', $installArgument) -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "The $Arch installer failed with exit code $($process.ExitCode)."
  }

  $installedExe = Get-ChildItem -LiteralPath $installPath -Filter 'aurorabook.exe' -File -Recurse | Select-Object -First 1
  if ($null -eq $installedExe) {
    throw "The $Arch installer did not install aurorabook.exe."
  }
  if ($installedExe.DirectoryName -ne $installPath) {
    throw "The $Arch app executable was not installed at the install root: $($installedExe.FullName)"
  }

  if (Test-Path -LiteralPath $layoutPath) {
    Remove-Item -LiteralPath $layoutPath -Recurse -Force
  }
  New-Item -ItemType Directory -Path $layoutPath -Force | Out-Null
  Copy-Item -Path (Join-Path $installPath '*') -Destination $layoutPath -Recurse -Force
  $layoutExe = Join-Path $layoutPath $installedExe.Name
  if ($installedExe.Name -cne 'AuroraBook.exe') {
    Rename-Item -LiteralPath $layoutExe -NewName 'AuroraBook.exe' -Force
  }

  $requiredFiles = if ($Arch -eq 'x64') { @('DirectML.dll', 'webgpu_dawn.dll') } else { @('DirectML.dll') }
  foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $layoutPath $requiredFile) -PathType Leaf)) {
      throw "The $Arch installer is missing required file '$requiredFile'."
    }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $layoutPath 'resources') -PathType Container)) {
    throw "The $Arch installer did not install the app resources directory."
  }
  Write-Host "Staged $Arch from $ArchivePath"
}

function Invoke-Packer([string[]]$Arguments) {
  & node $packer @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "MSIX packer failed with exit code $LASTEXITCODE."
  }
}

try {
  Push-Location $root
  New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
  Stage-InstalledApp -ArchivePath $x64ZipPath -Arch 'x64'
  Stage-InstalledApp -ArchivePath $arm64ZipPath -Arch 'arm64'

  Invoke-Packer @('--arch=x64', "--output=$(Join-Path $outputPath $outputNames[0])")
  Invoke-Packer @('--arch=arm64', "--output=$(Join-Path $outputPath $outputNames[1])")
  Invoke-Packer @('--bundle', "--output=$(Join-Path $outputPath $outputNames[2])")

  foreach ($name in $outputNames) {
    if (-not (Test-Path -LiteralPath (Join-Path $outputPath $name) -PathType Leaf)) {
      throw "Packaging completed without creating '$name'."
    }
    Write-Host "Created $(Join-Path $outputPath $name)"
  }
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
  }
}