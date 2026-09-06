param([string]$Configuration = 'Release')

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Join-Path $projectRoot 'native\thumbnail-provider'
$buildDirectory = Join-Path $sourceDirectory 'build'

$cmake = Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $cmake) {
  $cmake = Get-ChildItem 'C:\Program Files\Microsoft Visual Studio' -Recurse -Filter cmake.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $cmake) { throw 'CMake 3.24 or newer is required.' }

& $cmake -S $sourceDirectory -B $buildDirectory -A x64
if ($LASTEXITCODE -ne 0) { throw 'Could not configure the Windows thumbnail provider.' }

& $cmake --build $buildDirectory --config $Configuration --parallel
if ($LASTEXITCODE -ne 0) { throw 'Could not build the Windows thumbnail provider.' }

& $cmake --build $buildDirectory --config $Configuration --target RUN_TESTS
if ($LASTEXITCODE -ne 0) { throw 'Windows thumbnail provider safety tests failed.' }

$provider = Join-Path $buildDirectory "$Configuration\Kea3DThumbnailProvider.dll"
$testTool = Join-Path $buildDirectory "$Configuration\Kea3DThumbnailTest.exe"
$shellTestTool = Join-Path $buildDirectory "$Configuration\Kea3DShellThumbnailTest.exe"
if (-not (Test-Path -LiteralPath $provider)) { throw "Thumbnail provider was not produced: $provider" }
if (-not (Test-Path -LiteralPath $testTool)) { throw "Thumbnail test tool was not produced: $testTool" }
if (-not (Test-Path -LiteralPath $shellTestTool)) { throw "Shell thumbnail test tool was not produced: $shellTestTool" }
Get-Item -LiteralPath $provider, $testTool, $shellTestTool | Select-Object FullName, Length, LastWriteTime
