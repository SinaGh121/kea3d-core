param([switch]$InitializeUploadKey)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$keyDirectory = Join-Path $env:LOCALAPPDATA 'Kea3D\Signing'
$keyStore = Join-Path $keyDirectory 'upload.p12'
$protectedPassword = Join-Path $keyDirectory 'upload-password.dpapi'
$keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
$jarsigner = Join-Path $env:JAVA_HOME 'bin\jarsigner.exe'
if (-not (Test-Path -LiteralPath $keytool)) { throw 'Set JAVA_HOME to JDK 17.' }
if ($env:KEA3D_UPLOAD_PASSWORD -or $env:KEA3D_UPLOAD_STORE) { throw 'Clear existing signing environment variables first.' }
try {
  if ($InitializeUploadKey) {
    if ((Test-Path -LiteralPath $keyStore) -or (Test-Path -LiteralPath $protectedPassword)) {
      throw 'Existing signing files found; refusing to replace them.'
    }
    New-Item -ItemType Directory -Force -Path $keyDirectory | Out-Null
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls $keyDirectory /inheritance:r /grant:r "${identity}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect signing directory.' }
    $random = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    $env:KEA3D_UPLOAD_PASSWORD = [Convert]::ToBase64String($random)
    $secret = ConvertTo-SecureString $env:KEA3D_UPLOAD_PASSWORD -AsPlainText -Force
    $secret | ConvertFrom-SecureString | Set-Content -LiteralPath $protectedPassword
    & $keytool -genkeypair -keystore $keyStore -storetype PKCS12 -alias kea3d-upload -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Kea3D Upload' -storepass:env KEA3D_UPLOAD_PASSWORD -keypass:env KEA3D_UPLOAD_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Upload key generation failed; inspect signing directory before retrying.' }
  } else {
    if (-not (Test-Path -LiteralPath $keyStore)) { throw 'No upload keystore. Initialize only for an unregistered upload key.' }
    $secret = (Get-Content -LiteralPath $protectedPassword -Raw).Trim() | ConvertTo-SecureString
    $credential = New-Object System.Management.Automation.PSCredential('upload', $secret)
    $env:KEA3D_UPLOAD_PASSWORD = $credential.GetNetworkCredential().Password
  }
  $env:KEA3D_UPLOAD_STORE = $keyStore
  Push-Location $projectRoot
  try {
    npm run mobile:android:build -- --aab --target aarch64
    if ($LASTEXITCODE -ne 0) { throw 'Release AAB build failed.' }
    $bundle = Join-Path $projectRoot 'src-tauri\gen\android\app\build\outputs\bundle\universalRelease\app-universal-release.aab'
    if (-not (Test-Path -LiteralPath $bundle)) { throw 'Expected release AAB is missing.' }
    $verification = (& $jarsigner -verify $bundle 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $verification -notmatch 'jar verified') { throw 'AAB signature verification failed.' }
    $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
    $destination = Join-Path $projectRoot "artifacts\android\Kea3D-$version-android-arm64-internal.aab"
    New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
    Copy-Item -LiteralPath $bundle -Destination $destination -Force
    Get-FileHash -LiteralPath $destination -Algorithm SHA256
    Write-Output "Signing key stays outside the repository: $keyDirectory. Arrange a secure independent backup before upload."
  } finally { Pop-Location }
} finally {
  Remove-Item Env:KEA3D_UPLOAD_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:KEA3D_UPLOAD_STORE -ErrorAction SilentlyContinue
}
