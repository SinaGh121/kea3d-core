param(
  [string]$PortableDirectory = 'C:\MEGA\Programs\Kea3D',
  [string]$AndroidApk = '',
  [string]$OutputPath = '',
  [switch]$SkipWindowsLaunch,
  [switch]$RequireAndroidDevice,
  [switch]$InstallAndroid
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$portableExecutable = Join-Path $PortableDirectory 'Kea3D.exe'
$thumbnailProvider = Join-Path $PortableDirectory 'Kea3DThumbnailProvider.dll'
$androidPackage = 'com.kea3d.app.debug'

if ([string]::IsNullOrWhiteSpace($AndroidApk)) {
  $AndroidApk = "C:\MEGA\Share\Kea3D-$version-android-arm64-debug.apk"
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $projectRoot "artifacts\release-validation\Kea3D-$version-preflight.json"
}

function Assert-LastCommand([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
      return [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Resolve-AndroidTool([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $sdk = if ($env:ANDROID_HOME) {
    $env:ANDROID_HOME
  } elseif ($env:ANDROID_SDK_ROOT) {
    $env:ANDROID_SDK_ROOT
  } else {
    Join-Path $env:LOCALAPPDATA 'Android\Sdk'
  }

  if ($Name -eq 'adb') {
    $candidate = Join-Path $sdk 'platform-tools\adb.exe'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }

  $buildToolsRoot = Join-Path $sdk 'build-tools'
  if (Test-Path -LiteralPath $buildToolsRoot) {
    $buildTools = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
      Sort-Object Name -Descending |
      Select-Object -First 1
    if ($buildTools) {
      $fileName = if ($Name -eq 'apksigner') { 'apksigner.bat' } else { "$Name.exe" }
      $candidate = Join-Path $buildTools.FullName $fileName
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  }

  throw "Android tool '$Name' was not found."
}

Push-Location $projectRoot
try {
  npm run version:check
  Assert-LastCommand 'Product versions are not synchronized.'

  foreach ($path in @($portableExecutable, $thumbnailProvider, $AndroidApk)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Release artifact is missing: $path"
    }
  }

  $executableVersion = (Get-Item -LiteralPath $portableExecutable).VersionInfo.ProductVersion
  if ($executableVersion -ne $version) {
    throw "Portable version is $executableVersion; expected $version."
  }

  $aapt = Resolve-AndroidTool 'aapt'
  $apkSigner = Resolve-AndroidTool 'apksigner'
  $badging = (& $aapt dump badging $AndroidApk) -join "`n"
  Assert-LastCommand 'Could not inspect Android package metadata.'
  if ($badging.IndexOf("package: name='$androidPackage'", [StringComparison]::Ordinal) -lt 0) {
    throw 'Android package identity does not match the expected debug application.'
  }
  if ($badging.IndexOf("versionName='$version'", [StringComparison]::Ordinal) -lt 0) {
    throw "Android package version does not match $version."
  }
  if ($badging.IndexOf("native-code: 'arm64-v8a'", [StringComparison]::Ordinal) -lt 0) {
    throw 'Android package does not advertise the required ARM64 native code.'
  }
  & $apkSigner verify --verbose $AndroidApk | Out-Null
  Assert-LastCommand 'Android package signature verification failed.'

  $windowsSmoke = 'skipped'
  if (-not $SkipWindowsLaunch) {
    & (Join-Path $PSScriptRoot 'test-windows-package.ps1') -PortableDirectory $PortableDirectory | Out-Host
    Assert-LastCommand 'Windows portable smoke test failed.'
    $windowsSmoke = 'passed'
  }

  $adb = Resolve-AndroidTool 'adb'
  $deviceLines = & $adb devices -l | Select-Object -Skip 1
  Assert-LastCommand 'Could not query Android devices.'
  $devices = @($deviceLines | Where-Object { $_ -match '^([^\s]+)\s+device\b' } | ForEach-Object {
    [pscustomobject]@{ Serial = $Matches[1]; Description = $_.Trim() }
  })

  if (($RequireAndroidDevice -or $InstallAndroid) -and $devices.Count -eq 0) {
    throw 'No authorized Android device is connected through ADB.'
  }
  if ($devices.Count -gt 1 -and $InstallAndroid) {
    throw 'More than one Android device is connected; disconnect extras before installation.'
  }

  $androidLaunch = 'not-run'
  if ($InstallAndroid) {
    $serial = $devices[0].Serial
    & $adb -s $serial install -r $AndroidApk | Out-Host
    Assert-LastCommand 'Android package installation failed.'
    & $adb -s $serial shell monkey -p $androidPackage -c android.intent.category.LAUNCHER 1 | Out-Host
    Assert-LastCommand 'Android package launch failed.'
    Start-Sleep -Seconds 2
    $pid = (& $adb -s $serial shell pidof $androidPackage).Trim()
    Assert-LastCommand 'Could not query the Android app process.'
    if ([string]::IsNullOrWhiteSpace($pid)) { throw 'Android app did not remain running after launch.' }
    $androidLaunch = 'passed'
  }

  $result = [ordered]@{
    Schema = 'kea3d-release-preflight-v1'
    GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
    Version = $version
    Windows = [ordered]@{
      Executable = $portableExecutable
      ExecutableSha256 = Get-Sha256 $portableExecutable
      ThumbnailProvider = $thumbnailProvider
      ThumbnailProviderSha256 = Get-Sha256 $thumbnailProvider
      Smoke = $windowsSmoke
    }
    Android = [ordered]@{
      Apk = $AndroidApk
      ApkSha256 = Get-Sha256 $AndroidApk
      Signature = 'verified'
      Architecture = 'arm64-v8a'
      ConnectedDevices = $devices
      InstallAndLaunch = $androidLaunch
    }
    ManualChecklist = 'RELEASE_DEVICE_CHECKLIST.md'
  }

  $outputDirectory = Split-Path -Parent $OutputPath
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
  $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputPath -Encoding utf8
  $result | ConvertTo-Json -Depth 5
  Write-Host "Preflight report: $OutputPath"
} finally {
  Pop-Location
}
