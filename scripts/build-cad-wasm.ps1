param(
  [Parameter(Mandatory = $true)][string]$ImporterSource,
  [Parameter(Mandatory = $true)][string]$EmsdkRoot,
  [Parameter(Mandatory = $true)][string]$BuildDirectory,
  [string]$CMake = 'cmake',
  [string]$Ninja = 'ninja',
  [int]$Parallel = 12,
  [switch]$PackageExistingBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = (Resolve-Path -LiteralPath $ImporterSource).Path
$sdk = (Resolve-Path -LiteralPath $EmsdkRoot).Path
$expectedImporter = 'c2148e54b456b571238d35cac037d304053d64b2'
$expectedOcct = 'd2abb6d844231cb8f29be6894440874a4700e4a5'
if ((git -C $source rev-parse HEAD) -ne $expectedImporter) { throw 'Expected occt-import-js 0.0.23 source commit.' }
if ((git -C (Join-Path $source 'occt') rev-parse HEAD) -ne $expectedOcct) { throw 'Expected the pinned OCCT 7.6.1 source commit.' }
$emcc = Join-Path $sdk 'upstream/emscripten/emcc.bat'
$compilerVersion = (& $emcc --version) -join "`n"
if ($LASTEXITCODE -ne 0 -or $compilerVersion -notmatch '3\.1\.69') { throw 'Activate Emscripten 3.1.69 before building.' }
Copy-Item -LiteralPath (Join-Path $projectRoot 'native/cad-wasm/importer-xcaf.cpp') -Destination (Join-Path $source 'occt-import-js/src/importer-xcaf.cpp') -Force
if (-not $PackageExistingBuild) {
  & (Join-Path $sdk 'upstream/emscripten/emcmake.bat') $CMake -S $source -B $BuildDirectory -G Ninja "-DCMAKE_MAKE_PROGRAM=$Ninja" -DCMAKE_NINJA_FORCE_RESPONSE_FILE=ON -DEMSCRIPTEN=1 -DCMAKE_BUILD_TYPE=Release
  if ($LASTEXITCODE -ne 0) { throw 'CAD WebAssembly configure failed.' }
  & $CMake --build $BuildDirectory --parallel $Parallel
  if ($LASTEXITCODE -ne 0) { throw 'CAD WebAssembly build failed.' }
}
$destination = Join-Path $projectRoot 'vendor/cad-wasm/dist'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($name in @('occt-import-js.js', 'occt-import-js.wasm')) {
  Copy-Item -LiteralPath (Join-Path $BuildDirectory "Release/$name") -Destination (Join-Path $destination $name) -Force
}
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $destination 'occt-import-js.js'), (Join-Path $destination 'occt-import-js.wasm')
$metadata = [ordered]@{
  ImporterCommit = $expectedImporter
  OpenCascadeCommit = $expectedOcct
  Emscripten = '3.1.69'
  ModifiedSourceSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $projectRoot 'native/cad-wasm/importer-xcaf.cpp')).Hash.ToLower()
  JavaScriptSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $destination 'occt-import-js.js')).Hash.ToLower()
  WasmSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $destination 'occt-import-js.wasm')).Hash.ToLower()
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'vendor/cad-wasm/build.json') -Encoding utf8
