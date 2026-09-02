param(
  [string]$PortableDirectory = 'C:\MEGA\Programs\Kea3D',
  [string]$Sample = '',
  [int]$LaunchTimeoutSeconds = 15
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$portableRoot = (Resolve-Path -LiteralPath $PortableDirectory).Path
$executable = Join-Path $portableRoot 'Kea3D.exe'
$provider = Join-Path $portableRoot 'Kea3DThumbnailProvider.dll'
$builtProvider = Join-Path $projectRoot 'native\thumbnail-provider\build\Release\Kea3DThumbnailProvider.dll'
$providerClsid = '{E50D62FC-E508-4A2D-82AF-A3290688D78C}'
$thumbnailHandler = '{E357FCCD-A995-4576-B01F-234630154E96}'

function Get-Sha256([string]$Path) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try {
    return [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
  } finally {
    $stream.Dispose()
    $sha256.Dispose()
  }
}

if ([string]::IsNullOrWhiteSpace($Sample)) {
  $Sample = Join-Path $projectRoot 'tests\fixtures\AnimatedMorphCube.glb'
}
$samplePath = (Resolve-Path -LiteralPath $Sample).Path

if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "Kea3D.exe is missing from $portableRoot."
}
if (-not (Test-Path -LiteralPath $provider -PathType Leaf)) {
  throw "Kea3DThumbnailProvider.dll is missing from $portableRoot."
}
if (-not (Test-Path -LiteralPath $builtProvider -PathType Leaf)) {
  throw 'The corresponding built thumbnail provider is missing. Build the Windows package first.'
}

$providerHash = Get-Sha256 $provider
$builtProviderHash = Get-Sha256 $builtProvider
if ($providerHash -ne $builtProviderHash) {
  throw 'The copied thumbnail provider does not match the current release build.'
}

$inprocKey = "Registry::HKEY_CURRENT_USER\Software\Classes\CLSID\$providerClsid\InprocServer32"
if (-not (Test-Path -LiteralPath $inprocKey)) {
  throw 'The Kea3D thumbnail provider is not registered for the current user.'
}
$registeredProvider = (Get-Item -LiteralPath $inprocKey).GetValue('')
if ($registeredProvider -ne $provider) {
  throw "Explorer uses a different thumbnail provider: $registeredProvider"
}

$registeredExtensions = foreach ($extension in '.glb', '.stl', '.ply', '.step', '.stp') {
  $handlerKey = "Registry::HKEY_CURRENT_USER\Software\Classes\$extension\ShellEx\$thumbnailHandler"
  $registeredClsid = if (Test-Path -LiteralPath $handlerKey) {
    (Get-Item -LiteralPath $handlerKey).GetValue('')
  } else {
    $null
  }
  if ($registeredClsid -ne $providerClsid) {
    throw "Explorer thumbnail registration is missing or incorrect for $extension."
  }
  $extension
}

$sourceBefore = Get-Item -LiteralPath $samplePath
$process = $null
$stopwatch = [Diagnostics.Stopwatch]::StartNew()
try {
  $process = Start-Process -FilePath $executable -ArgumentList ('"' + $samplePath + '"') -PassThru -WindowStyle Hidden
  while ($stopwatch.Elapsed.TotalSeconds -lt $LaunchTimeoutSeconds) {
    Start-Sleep -Milliseconds 250
    $process.Refresh()
    if ($process.HasExited) {
      throw "The portable exited during launch with code $($process.ExitCode)."
    }
    if ($process.MainWindowHandle -ne 0) { break }
  }
  $process.Refresh()
  if ($process.MainWindowHandle -eq 0) {
    throw "The portable did not create a window within $LaunchTimeoutSeconds seconds."
  }

  Start-Sleep -Seconds 3
  $process.Refresh()
  if ($process.HasExited) {
    throw "The portable exited during the stability check with code $($process.ExitCode)."
  }

  $sourceAfter = Get-Item -LiteralPath $samplePath
  if ($sourceBefore.Length -ne $sourceAfter.Length -or $sourceBefore.LastWriteTimeUtc -ne $sourceAfter.LastWriteTimeUtc) {
    throw 'The package smoke test modified its source model.'
  }

  [pscustomobject]@{
    Executable = $executable
    ProductVersion = $process.MainModule.FileVersionInfo.ProductVersion
    Sample = $samplePath
    WindowTitle = $process.MainWindowTitle
    WorkingSetMiB = [math]::Round($process.WorkingSet64 / 1MB, 1)
    Provider = $provider
    ProviderSha256 = $providerHash
    RegisteredExtensions = $registeredExtensions -join ', '
    SourceModified = $false
  } | Format-List
} finally {
  $stopwatch.Stop()
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $null = $process.WaitForExit(5000)
  }
}
