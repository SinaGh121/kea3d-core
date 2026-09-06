param(
  [Parameter(Mandatory = $true)][string]$Sample,
  [string]$OpenCascadeRoot = $env:KEA3D_OCCT_ROOT,
  [switch]$SkipBuild,
  [int]$ExpectedBatches = 0,
  [int]$ExpectedTriangles = 0
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$samplePath = (Resolve-Path -LiteralPath $Sample).Path
$before = Get-Item -LiteralPath $samplePath
$capture = Join-Path ([IO.Path]::GetTempPath()) "kea3d-cad-worker-$([Guid]::NewGuid().ToString('N')).bin"
$session = "acceptance-$([Guid]::NewGuid().ToString('N'))"

Push-Location $projectRoot
try {
  if (-not $SkipBuild) {
    & .\scripts\build-native-cad-worker.ps1 -OpenCascadeRoot $OpenCascadeRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not build the native CAD worker.' }
  }

  $worker = Join-Path $projectRoot 'native\cad-worker\build\Release\kea3d-cad-worker.exe'
  if (-not (Test-Path -LiteralPath $worker)) {
    throw 'The native CAD worker is not built. Remove -SkipBuild or build it first.'
  }
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $worker
  $quotedSamplePath = '"' + $samplePath.Replace('"', '\"') + '"'
  $startInfo.Arguments = "--protocol 1 --session $session --input $quotedSamplePath"
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true

  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  $null = $process.Start()
  $output = [IO.File]::Create($capture)
  try {
    $process.StandardOutput.BaseStream.CopyTo($output)
  } finally {
    $output.Dispose()
  }
  $standardError = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $stopwatch.Stop()
  $workerExitCode = $process.ExitCode

  Push-Location (Join-Path $projectRoot 'src-tauri')
  try {
    $summary = & cargo run --quiet --example inspect_native_cad_stream -- $capture $session
    if ($LASTEXITCODE -ne 0) { throw 'The Rust host rejected the native CAD stream.' }
  } finally {
    Pop-Location
  }

  if ($workerExitCode -ne 0) {
    throw "CAD worker exited with $workerExitCode. $summary $standardError"
  }

  if ($ExpectedBatches -gt 0 -and $summary -notmatch "batches=$ExpectedBatches(?:\s|$)") {
    throw "Expected $ExpectedBatches batches but received: $summary"
  }
  if ($ExpectedTriangles -gt 0 -and $summary -notmatch "triangles=$ExpectedTriangles(?:\s|$)") {
    throw "Expected $ExpectedTriangles triangles but received: $summary"
  }

  $after = Get-Item -LiteralPath $samplePath
  if ($before.Length -ne $after.Length -or $before.LastWriteTimeUtc -ne $after.LastWriteTimeUtc) {
    throw 'The native CAD acceptance run modified its source model.'
  }
  if (Get-Process -Name 'kea3d-cad-worker' -ErrorAction SilentlyContinue) {
    throw 'The native CAD acceptance run left an orphaned worker.'
  }

  [pscustomobject]@{
    Seconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
    CaptureBytes = (Get-Item -LiteralPath $capture).Length
    Summary = $summary
    SourceModified = $false
    RemainingWorkers = 0
  } | Format-List
} finally {
  if (Test-Path -LiteralPath $capture) { Remove-Item -LiteralPath $capture -Force }
  Pop-Location
}
