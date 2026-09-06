param(
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'

function Wait-ForFinalExecutable {
  param([Parameter(Mandatory = $true)][string]$Path)

  $deadline = (Get-Date).AddMinutes(3)
  do {
    $activeBuild = Get-Process -Name cargo,makensis,candle,light,wix -ErrorAction SilentlyContinue
    if (-not $activeBuild) { break }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  if (Get-Process -Name cargo,makensis,candle,light,wix -ErrorAction SilentlyContinue) {
    throw 'The desktop build did not finish within three minutes.'
  }

  $previousHash = $null
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    if (-not (Test-Path $Path)) { throw "Expected executable was not produced: $Path" }
    $currentHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash
    if ($currentHash -eq $previousHash) { return }
    $previousHash = $currentHash
    Start-Sleep -Seconds 5
  }
}

function Assert-EmbeddedDesktopAsset {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedText
  )

  $content = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($Path))
  if ($content.IndexOf($ExpectedText, [System.StringComparison]::Ordinal) -lt 0) {
    throw "The packaged EXE is missing required desktop asset: $ExpectedText"
  }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$artifactDirectory = Join-Path $projectRoot 'artifacts\windows'
$targetDirectory = Join-Path $projectRoot 'src-tauri\target\release'
$sharedPortableDirectory = 'C:\MEGA\Programs\Kea3D'
$sharedPortablePath = Join-Path $sharedPortableDirectory 'Kea3D.exe'
$productVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version

Push-Location $projectRoot
try {
  npm run version:check
  if ($LASTEXITCODE -ne 0) { throw 'Product versions are not synchronized.' }

  if (-not $SkipChecks) {
    npm run check
    if ($LASTEXITCODE -ne 0) { throw 'Quality checks failed.' }
  }

  npx tauri icon .\dist\kea3d-icon.svg -o .\src-tauri\icons
  if ($LASTEXITCODE -ne 0) { throw 'Could not generate platform icons.' }
  python .\scripts\create-web-icons.py
  if ($LASTEXITCODE -ne 0) { throw 'Could not generate the web icons.' }

  & .\scripts\build-thumbnail-provider.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Could not build the Windows thumbnail provider.' }

  $nativeCadWorker = Join-Path $projectRoot 'native\cad-worker\build\Release\kea3d-cad-worker.exe'
  if ($env:KEA3D_OCCT_ROOT) {
    & .\scripts\build-native-cad-worker.ps1
    if ($LASTEXITCODE -ne 0) { throw 'Could not build the native CAD worker.' }
  }
  if (-not (Test-Path -LiteralPath $nativeCadWorker)) {
    throw 'The Windows release requires the native CAD worker. Set KEA3D_OCCT_ROOT and run scripts\build-native-cad-worker.ps1.'
  }

  npm run desktop:build
  if ($LASTEXITCODE -ne 0) { throw 'The Windows desktop build failed.' }

  npm run check:bundle
  if ($LASTEXITCODE -ne 0) { throw 'The production bundle exceeded its performance budget.' }

  $executable = Join-Path $targetDirectory 'kea3d.exe'
  Wait-ForFinalExecutable -Path $executable
  Assert-EmbeddedDesktopAsset -Path $executable -ExpectedText 'app.kea3d.viewer.v2'
  Assert-EmbeddedDesktopAsset -Path $executable -ExpectedText 'desktop-cache-reset-v2.js'
  Assert-EmbeddedDesktopAsset -Path $executable -ExpectedText 'import_pending_native_cad'

  New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
  Copy-Item -Force $executable (Join-Path $artifactDirectory "Kea3D-$productVersion-windows-portable.exe")
  New-Item -ItemType Directory -Force -Path $sharedPortableDirectory | Out-Null
  Copy-Item -Force $executable $sharedPortablePath
  foreach ($portableAlias in @('Kea3D-portable.exe', 'Kea3D-portable-current.exe')) {
    try {
      Copy-Item -Force $executable (Join-Path $artifactDirectory $portableAlias) -ErrorAction Stop
    } catch {
      Write-Warning "$portableAlias is currently in use; the versioned portable artifact was still created."
    }
  }
  $thumbnailProviderFileName = 'Kea3DThumbnailProvider.dll'
  $thumbnailProvider = Join-Path $projectRoot "native\thumbnail-provider\build\Release\$thumbnailProviderFileName"
  foreach ($thumbnailDestination in @($artifactDirectory, $sharedPortableDirectory)) {
    try {
      Copy-Item -Force $thumbnailProvider (Join-Path $thumbnailDestination $thumbnailProviderFileName) -ErrorAction Stop
    } catch {
      Write-Warning "Explorer is using the existing $thumbnailProviderFileName in $thumbnailDestination; keeping that compatible copy."
    }
  }
  foreach ($thumbnailDestination in @($artifactDirectory, $sharedPortableDirectory)) {
    Get-ChildItem -LiteralPath $thumbnailDestination -Filter 'Kea3DThumbnailProvider-*.dll' -File -ErrorAction SilentlyContinue | ForEach-Object {
      $legacyProviderPath = $_.FullName
      try {
        Remove-Item -LiteralPath $legacyProviderPath -Force -ErrorAction Stop
      } catch {
        Write-Warning "Explorer is still using $legacyProviderPath; it can be removed after Explorer restarts."
      }
    }
  }

  foreach ($distributionDirectory in @($artifactDirectory, $sharedPortableDirectory)) {
    $distributionRoot = [System.IO.Path]::GetFullPath($distributionDirectory).TrimEnd('\')
    $legalDirectory = Join-Path $distributionRoot 'Legal'
    $resolvedLegalDirectory = [System.IO.Path]::GetFullPath($legalDirectory)
    if ($resolvedLegalDirectory.StartsWith("$distributionRoot\", [System.StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedLegalDirectory) -eq 'Legal' -and
        (Test-Path -LiteralPath $resolvedLegalDirectory -PathType Container)) {
      Remove-Item -LiteralPath $resolvedLegalDirectory -Recurse -Force
    }
  }
  Copy-Item -Force (Join-Path $projectRoot 'scripts\refresh-windows-thumbnail-cache.bat') $artifactDirectory

  $msi = Join-Path $targetDirectory "bundle\msi\Kea3D_${productVersion}_x64_en-US.msi"
  $setup = Join-Path $targetDirectory "bundle\nsis\Kea3D_${productVersion}_x64-setup.exe"
  if (Test-Path $msi) { Copy-Item -Force $msi (Join-Path $artifactDirectory "Kea3D-$productVersion-windows-x64.msi") }
  if (Test-Path $setup) { Copy-Item -Force $setup (Join-Path $artifactDirectory "Kea3D-$productVersion-windows-x64-setup.exe") }

  Get-ChildItem $artifactDirectory -File | Select-Object Name, Length, LastWriteTime
} finally {
  Pop-Location
}
