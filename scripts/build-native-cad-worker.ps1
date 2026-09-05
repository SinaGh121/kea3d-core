param(
  [string]$OpenCascadeRoot = $env:KEA3D_OCCT_ROOT,
  [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'

if (-not $OpenCascadeRoot) {
  throw 'Set KEA3D_OCCT_ROOT or pass -OpenCascadeRoot with an OpenCascade 7.8 x64 installation.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Join-Path $projectRoot 'native\cad-worker'
$buildDirectory = Join-Path $sourceDirectory 'build'
$packageConfig = Join-Path $OpenCascadeRoot 'cmake\OpenCASCADEConfig.cmake'
if (-not (Test-Path -LiteralPath $packageConfig)) {
  throw "OpenCascadeConfig.cmake was not found under $OpenCascadeRoot"
}

$cmake = Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $cmake) {
  $cmake = Get-ChildItem 'C:\Program Files\Microsoft Visual Studio' -Recurse -Filter cmake.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $cmake) { throw 'CMake 3.24 or newer is required.' }

& $cmake -S $sourceDirectory -B $buildDirectory -A x64 "-DOpenCASCADE_DIR=$(Split-Path -Parent $packageConfig)"
if ($LASTEXITCODE -ne 0) { throw 'Could not configure the native CAD worker.' }

& $cmake --build $buildDirectory --config $Configuration --parallel
if ($LASTEXITCODE -ne 0) { throw 'Could not build the native CAD worker.' }

$worker = Join-Path $buildDirectory "$Configuration\kea3d-cad-worker.exe"
if (-not (Test-Path -LiteralPath $worker)) { throw "Worker was not produced: $worker" }
Get-Item -LiteralPath $worker | Select-Object FullName, Length, LastWriteTime
