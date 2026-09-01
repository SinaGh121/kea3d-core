param([switch]$SkipChecks)

$ErrorActionPreference = 'Stop'

function Assert-CommandSucceeded {
  param([Parameter(Mandatory = $true)][string]$Message)

  if ($LASTEXITCODE -ne 0) { throw $Message }
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Assert-PackagedManifest {
  param(
    [Parameter(Mandatory = $true)][string]$AaptPath,
    [Parameter(Mandatory = $true)][string]$ApkPath
  )

  $manifest = (& $AaptPath dump xmltree $ApkPath --file AndroidManifest.xml) -join "`n"
  Assert-CommandSucceeded -Message 'Could not inspect the packaged Android manifest.'

  $requiredMimeTypes = @(
    'model/gltf-binary',
    'model/gltf+binary',
    'model/gltf+json',
    'application/gltf-binary',
    'application/gltf-buffer',
    'application/glb',
    'application/x-glb',
    'application/x-blorb',
    'model/stl',
    'model/3mf',
    'model/obj',
    'model/ply',
    'application/vnd.autodesk.fbx',
    'model/vnd.collada+xml',
    'model/step',
    'model/iges',
    'application/x-brep',
    'application/x-blender',
    'application/octet-stream',
    'binary/octet-stream'
  )

  foreach ($mimeType in $requiredMimeTypes) {
    if ($manifest.IndexOf($mimeType, [System.StringComparison]::Ordinal) -lt 0) {
      throw "The APK is missing Android Open with MIME type: $mimeType"
    }
  }

  $requiredIntentActions = @(
    'android.intent.action.VIEW',
    'android.intent.action.SEND',
    'android.intent.action.SEND_MULTIPLE'
  )
  foreach ($intentAction in $requiredIntentActions) {
    if ($manifest.IndexOf($intentAction, [System.StringComparison]::Ordinal) -lt 0) {
      throw "The APK is missing its Android $intentAction association."
    }
  }
  if ($manifest.IndexOf('Raw: "content"', [System.StringComparison]::Ordinal) -lt 0) {
    throw 'The APK is missing its Android content URI association.'
  }

  $requiredExtensions = @(
    'glb', 'gltf', 'stl', '3mf', 'obj', 'ply', 'fbx', 'dae',
    'step', 'stp', 'iges', 'igs', 'brep', 'blend'
  )
  foreach ($extension in $requiredExtensions) {
    $pattern = 'Raw: ".*\.' + $extension + '"'
    if ($manifest.IndexOf($pattern, [System.StringComparison]::Ordinal) -lt 0) {
      throw "The APK is missing its .$extension URI association."
    }
  }
}

function Assert-PackagedVersion {
  param(
    [Parameter(Mandatory = $true)][string]$AaptPath,
    [Parameter(Mandatory = $true)][string]$ApkPath,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion
  )

  $parts = $ExpectedVersion.Split('.') | ForEach-Object { [int]$_ }
  $expectedCode = $parts[0] * 1000000 + $parts[1] * 1000 + $parts[2]
  $badging = (& $AaptPath dump badging $ApkPath) -join "`n"
  Assert-CommandSucceeded -Message 'Could not inspect the packaged Android version.'
  if ($badging.IndexOf("versionName='$ExpectedVersion'", [System.StringComparison]::Ordinal) -lt 0) {
    throw "The APK versionName is not $ExpectedVersion."
  }
  if ($badging.IndexOf("versionCode='$expectedCode'", [System.StringComparison]::Ordinal) -lt 0) {
    throw "The APK versionCode is not $expectedCode."
  }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$androidSdk = if ($env:ANDROID_HOME) {
  $env:ANDROID_HOME
} elseif ($env:ANDROID_SDK_ROOT) {
  $env:ANDROID_SDK_ROOT
} else {
  Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}

if (-not $env:JAVA_HOME) {
  $jdk17 = 'C:\Program Files\Java\jdk-17'
  if (Test-Path -LiteralPath $jdk17) { $env:JAVA_HOME = $jdk17 }
}
if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath $env:JAVA_HOME)) {
  throw 'JDK 17 was not found. Set JAVA_HOME before building Android.'
}
if (-not (Test-Path -LiteralPath $androidSdk)) {
  throw 'The Android SDK was not found. Set ANDROID_HOME before building Android.'
}

$buildTools = Get-ChildItem (Join-Path $androidSdk 'build-tools') -Directory |
  Sort-Object Name -Descending |
  Select-Object -First 1
if (-not $buildTools) { throw 'Android SDK build-tools are not installed.' }

$aapt2 = Join-Path $buildTools.FullName 'aapt2.exe'
$aapt = Join-Path $buildTools.FullName 'aapt.exe'
$apkSigner = Join-Path $buildTools.FullName 'apksigner.bat'
$sourceApk = Join-Path $projectRoot 'src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk'
$artifactDirectory = Join-Path $projectRoot 'artifacts\android'
$artifactApk = Join-Path $artifactDirectory 'Kea3D-android-arm64-debug-current.apk'
$shareDirectory = 'C:\MEGA\Share'
$buildVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$versionedName = "Kea3D-$buildVersion-android-arm64-debug.apk"
$versionedArtifact = Join-Path $artifactDirectory $versionedName
$sharedApk = Join-Path $shareDirectory $versionedName

Push-Location $projectRoot
try {
  npm run version:check
  Assert-CommandSucceeded -Message 'Product versions are not synchronized.'

  if (-not $SkipChecks) {
    npm run check
    Assert-CommandSucceeded -Message 'Quality checks failed.'
  }

  # Gradle/apksigner can append another signing block when an existing debug
  # APK is reused, so remove only the exact generated output before rebuilding.
  if (Test-Path -LiteralPath $sourceApk) {
    Remove-Item -LiteralPath $sourceApk -Force
  }
  npm run mobile:android:build -- --debug --apk --target aarch64
  Assert-CommandSucceeded -Message 'The Android APK build failed.'
  if (-not (Test-Path -LiteralPath $sourceApk)) {
    throw "Expected Android APK was not produced: $sourceApk"
  }

  Assert-PackagedManifest -AaptPath $aapt2 -ApkPath $sourceApk
  Assert-PackagedVersion -AaptPath $aapt -ApkPath $sourceApk -ExpectedVersion $buildVersion
  & $apkSigner verify --verbose $sourceApk
  Assert-CommandSucceeded -Message 'The Android debug APK signature is invalid.'

  New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
  New-Item -ItemType Directory -Force -Path $shareDirectory | Out-Null
  Copy-Item -LiteralPath $sourceApk -Destination $artifactApk -Force
  Copy-Item -LiteralPath $sourceApk -Destination $versionedArtifact -Force
  Copy-Item -LiteralPath $sourceApk -Destination $sharedApk -Force

  [PSCustomObject]@{
    Version = $buildVersion
    VersionCode = ([int]$buildVersion.Split('.')[0] * 1000000) +
      ([int]$buildVersion.Split('.')[1] * 1000) +
      [int]$buildVersion.Split('.')[2]
    Name = $versionedName
    Path = $sharedApk
    CurrentPath = $artifactApk
    Length = (Get-Item -LiteralPath $sharedApk).Length
    SHA256 = Get-Sha256 -Path $sharedApk
  }
} finally {
  Pop-Location
}
