param(
  [Parameter(Mandatory = $true)][string]$SourceArchive,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$CMake = '',
  [int]$Parallel = 4
)
$ErrorActionPreference = 'Stop'
$expected = 'c3d2199ccf5331d261cf293abbc6b6b6ca1eb7187ef2113c181c49f9365cd9ae'
if ((Get-FileHash -LiteralPath $SourceArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
  throw 'Expected the unmodified occt-sys 7.8.1 crates.io source archive.'
}
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Use a new output directory to preserve earlier evidence.' }
if (-not $CMake) {
  $command = Get-Command cmake -ErrorAction SilentlyContinue
  if ($command) { $CMake = $command.Source }
  else {
    $CMake = Get-ChildItem 'C:\Program Files\Microsoft Visual Studio' -Recurse -Filter cmake.exe |
      Select-Object -First 1 -ExpandProperty FullName
  }
}
if (-not $CMake) { throw 'Install Visual Studio 2022 C++ tools and CMake.' }
$root = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $root | Out-Null
& tar -xzf $SourceArchive -C $root
if ($LASTEXITCODE -ne 0) { throw 'Source extraction failed.' }
$source = Join-Path $root 'occt-sys-7.8.1'
$build = Join-Path $root 'build'
$install = Join-Path $root 'install'
$options = @('-G', 'Visual Studio 17 2022', '-A', 'x64',
  "-DBUILD_PATCH=$source/patch", '-DBUILD_LIBRARY_TYPE=Static',
  '-DBUILD_MODULE_ApplicationFramework=OFF', '-DBUILD_MODULE_Draw=OFF',
  '-DBUILD_USE_PCH=OFF', '-DCMAKE_CXX_FLAGS=/MD /Brepro',
  '-DINSTALL_DIR_LIB=lib', '-DINSTALL_DIR_INCLUDE=include', "-DINSTALL_DIR=$install")
foreach ($feature in 'D3D','DRACO','EIGEN','FFMPEG','FREEIMAGE','FREETYPE','GLES2','OPENGL','OPENVR','RAPIDJSON','TBB','TCL','TK','VTK','XLIB') {
  $options += "-DUSE_$feature=OFF"
}
& $CMake -S "$source/OCCT" -B $build @options
if ($LASTEXITCODE -ne 0) { throw 'OCCT configure failed.' }
& $CMake --build $build --config Release --target INSTALL --parallel $Parallel
if ($LASTEXITCODE -ne 0) { throw 'OCCT rebuild failed.' }
Write-Output "Rebuilt OCCT installation: $install"
