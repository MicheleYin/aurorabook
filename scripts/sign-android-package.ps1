param(
  [string]$Package,

  [string]$Keystore,

  [string]$Alias,

  [string]$Output,

  [switch]$Force,

  [switch]$Help
)

$ErrorActionPreference = 'Stop'

if ($Help) {
  Write-Host '.\scripts\sign-android-package.ps1 [-Package <apk|aab|GitHub artifact zip>] [-Keystore <keystore>] [-Alias <alias>] [-Output <signed package>] [-Force]'
  Write-Host 'Signs and verifies an Android APK or AAB without changing the downloaded input.'
  exit 0
}

if ([string]::IsNullOrWhiteSpace($Package)) {
  $Package = Read-Host 'Path to the downloaded APK, AAB, or GitHub Actions artifact ZIP'
}
if (-not (Test-Path -LiteralPath $Package -PathType Leaf)) {
  throw "Package file not found: $Package"
}
$packageInputPath = (Resolve-Path -LiteralPath $Package).Path
$downloadDirectory = Split-Path -Parent $packageInputPath
$temporaryExtractionPath = $null

try {
  $extension = [IO.Path]::GetExtension($packageInputPath).ToLowerInvariant()
  if ($extension -eq '.zip') {
    $temporaryExtractionPath = Join-Path ([IO.Path]::GetTempPath()) ('aurorabook-android-sign-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporaryExtractionPath -Force | Out-Null
    Expand-Archive -LiteralPath $packageInputPath -DestinationPath $temporaryExtractionPath
    $packages = @(Get-ChildItem -LiteralPath $temporaryExtractionPath -File -Recurse | Where-Object { $_.Extension -in @('.apk', '.aab') })
    if ($packages.Count -ne 1) {
      throw "Expected one APK or AAB in the GitHub artifact ZIP; found $($packages.Count). Pass a package file directly if the ZIP contains multiple packages."
    }
    $packagePath = $packages[0].FullName
  } elseif ($extension -in @('.apk', '.aab')) {
    $packagePath = $packageInputPath
  } else {
    throw "Expected an .apk, .aab, or GitHub artifact .zip file: $packageInputPath"
  }

  if ([string]::IsNullOrWhiteSpace($Keystore)) {
    $Keystore = Read-Host 'Path to your Android release keystore (.jks or .keystore)'
  }
  if (-not (Test-Path -LiteralPath $Keystore -PathType Leaf)) {
    throw "Keystore file not found: $Keystore"
  }
  $keystorePath = (Resolve-Path -LiteralPath $Keystore).Path

  if ([string]::IsNullOrWhiteSpace($Alias)) {
    $Alias = Read-Host 'Key alias'
  }
  if ([string]::IsNullOrWhiteSpace($Alias)) {
    throw 'A key alias is required.'
  }

  if ([string]::IsNullOrWhiteSpace($Output)) {
    $outputPath = Join-Path $downloadDirectory (([IO.Path]::GetFileNameWithoutExtension($packagePath)) + '-signed' + [IO.Path]::GetExtension($packagePath))
  } else {
    $outputPath = [IO.Path]::GetFullPath($Output)
  }
  if ([IO.Path]::GetFullPath($outputPath) -ieq [IO.Path]::GetFullPath($packagePath)) {
    throw 'The signed output must be different from the input package.'
  }
  if ((Test-Path -LiteralPath $outputPath) -and -not $Force) {
    throw "Output already exists: $outputPath (pass -Force to replace it)."
  }
  if (Test-Path -LiteralPath $outputPath) {
    Remove-Item -LiteralPath $outputPath -Force
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $outputPath) -Force | Out-Null

  if ([IO.Path]::GetExtension($packagePath).Equals('.apk', [StringComparison]::OrdinalIgnoreCase)) {
    $signer = Get-Command apksigner.bat, apksigner.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $signer) {
      $apksignerPath = $signer.Source
    } else {
      $sdkRoots = @(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
      ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
      $apksignerPath = $null
      foreach ($sdkRoot in $sdkRoots) {
        $buildToolsPath = Join-Path $sdkRoot 'build-tools'
        if (-not (Test-Path -LiteralPath $buildToolsPath -PathType Container)) { continue }
        $buildTools = @(Get-ChildItem -LiteralPath $buildToolsPath -Directory | Sort-Object { try { [version](($_.Name -split '-')[0]) } catch { [version]'0.0' } } -Descending)
        foreach ($buildTool in $buildTools) {
          foreach ($name in @('apksigner.bat', 'apksigner.exe')) {
            $candidate = Join-Path $buildTool.FullName $name
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
              $apksignerPath = $candidate
              break
            }
          }
          if ($apksignerPath) { break }
        }
        if ($apksignerPath) { break }
      }
      if (-not $apksignerPath) {
        throw 'Could not find apksigner. Install Android SDK Build-Tools or set ANDROID_SDK_ROOT.'
      }
    }
  } else {
    $signer = Get-Command jarsigner.exe -ErrorAction SilentlyContinue
    if ($null -ne $signer) {
      $jarsignerPath = $signer.Source
    } else {
      $javaHomes = @($env:JAVA_HOME)
      $javaRoot = Join-Path $env:ProgramFiles 'Java'
      if (Test-Path -LiteralPath $javaRoot -PathType Container) {
        $javaHomes += Get-ChildItem -LiteralPath $javaRoot -Directory | Select-Object -ExpandProperty FullName
      }
      $javaHomes += Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
      $jarsignerPath = $null
      foreach ($javaHome in ($javaHomes | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)) {
        $candidate = Join-Path $javaHome 'bin\jarsigner.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
          $jarsignerPath = $candidate
          break
        }
      }
      if (-not $jarsignerPath) {
        throw 'Could not find jarsigner. Install a JDK or set JAVA_HOME.'
      }
    }
  }

  $storePassword = Read-Host 'Keystore password' -AsSecureString
  $keyPassword = Read-Host 'Key password' -AsSecureString
  if ($storePassword.Length -eq 0 -or $keyPassword.Length -eq 0) {
    throw 'Keystore and key passwords must not be empty.'
  }

  $storePasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePassword)
  $keyPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keyPassword)
  try {
    $env:AURORABOOK_ANDROID_STORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($storePasswordPointer)
    $env:AURORABOOK_ANDROID_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPasswordPointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($storePasswordPointer)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPasswordPointer)
    $storePassword.Dispose()
    $keyPassword.Dispose()
  }

  try {
    if ($extension -eq '.zip') {
      Write-Host "Signing $([IO.Path]::GetFileName($packagePath)) from the downloaded artifact ZIP"
    } else {
      Write-Host "Signing $packagePath"
    }
    Write-Host "Writing $outputPath"

    if ([IO.Path]::GetExtension($packagePath).Equals('.apk', [StringComparison]::OrdinalIgnoreCase)) {
      & $apksignerPath sign --ks $keystorePath --ks-key-alias $Alias --ks-pass 'env:AURORABOOK_ANDROID_STORE_PASSWORD' --key-pass 'env:AURORABOOK_ANDROID_KEY_PASSWORD' --out $outputPath $packagePath
      if ($LASTEXITCODE -ne 0) { throw "apksigner failed with exit code $LASTEXITCODE." }
      & $apksignerPath verify --verbose --print-certs $outputPath
      if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed with exit code $LASTEXITCODE." }
    } else {
      & $jarsignerPath -keystore $keystorePath -storepass:env AURORABOOK_ANDROID_STORE_PASSWORD -keypass:env AURORABOOK_ANDROID_KEY_PASSWORD -signedjar $outputPath -sigalg SHA256withRSA -digestalg SHA-256 $packagePath $Alias
      if ($LASTEXITCODE -ne 0) { throw "jarsigner failed with exit code $LASTEXITCODE." }
      & $jarsignerPath -verify $outputPath
      if ($LASTEXITCODE -ne 0) { throw "AAB signature verification failed with exit code $LASTEXITCODE." }
    }

    Write-Host "Signed and verified: $outputPath"
  } finally {
    Remove-Item Env:AURORABOOK_ANDROID_STORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:AURORABOOK_ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
  }
} finally {
  if ($temporaryExtractionPath -and (Test-Path -LiteralPath $temporaryExtractionPath)) {
    Remove-Item -LiteralPath $temporaryExtractionPath -Recurse -Force
  }
}