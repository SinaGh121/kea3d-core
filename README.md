# Kea3D

A fast, local-first 3D and CAD viewer in development.

## Run locally

```powershell
npm install
npm run dev
```

Then open the local URL shown by Vite and drop a supported model. Current import support includes:

- Mesh and scene: GLB/glTF, STL, 3MF, OBJ/MTL, PLY, FBX, and COLLADA/DAE.
- CAD: STEP/STP, IGES/IGS, and BREP.
- Compatibility conversion: BLEND through a lazy local Assimp worker. New or feature-heavy Blender files may still need export to GLB.
- Assembly projects: validated `.kea3d` Project v1 manifests and self-contained `.kea3dp` packages with reusable GLB instances and fixed anchor-to-anchor attachments.

Anchors can be shown in the viewport and Scene objects tree, selected, fitted, and inspected by stable ID, parent, world position, and rotation. Standalone models support creating, editing, deleting, undoing, and exporting persistent Anchors in GLB copies. Resolved `.kea3d`/`.kea3dp` assemblies remain inspection-only so their source component files are never changed implicitly. Anchor helpers are excluded from geometry bounds.

Select companion material, binary, and texture files together with the main model when the format references external files.
On the web/PWA, use **Open project folder**, select the `.kea3d` manifest and referenced GLBs together, or open one self-contained `.kea3dp`. Desktop apps and file associations securely resolve referenced GLBs relative to transparent manifests automatically. Kea3D validates the graph, optional resource integrity metadata, anchors, and packaged ZIP boundary before replacing the open model. Its Export workspace saves manifests, packs or atomically resaves `.kea3dp` transports, and creates standard flattened GLBs with resolved assembly transforms.

After selecting a scene object, **Set material** provides 39 internally authored numerical PBR presets across basics, metals, plastics/rubber, glass, and emissive LEDs. Applicable families expose independent Dark/Standard/Light tone and Matte/Satin/Gloss or Brushed/Satin/Polished finish controls, with advanced numerical PBR adjustment. Changes can target the selected object or all meshes that shared its original material, support bounded Undo/Redo through the panel or Ctrl/Command shortcuts, and are included only when saving a new corrected GLB copy.

See [FORMAT_SUPPORT.md](FORMAT_SUPPORT.md) for the detailed compatibility matrix.

## Verify

```powershell
npm run check:release
```

The release check runs lint, TypeScript, unit tests, a production build, startup-bundle budgets, and Chromium UI/accessibility tests. Install its local browser runtime once with `npx playwright install chromium`.

## Windows desktop build

```powershell
.\scripts\build-windows.ps1
```

This runs the quality checks and creates the portable executable, MSI, and setup
installer under `artifacts/windows/`. The packages are currently unsigned.
The portable artifact and `C:\MEGA\Programs\Kea3D` copy also include the
stable `Kea3DThumbnailProvider.dll`; keep it beside `Kea3D.exe` when sharing the
portable build. About exposes the authoritative Core license, third-party notices,
and the exact versioned public source release on every platform.
The installer registers supported model formats. The portable executable also opens
a model passed on its command line, so Windows **Open with** and double-click file
associations work after selecting `Kea3D-portable-current.exe` as the default app.

## Android and iOS

The shared Tauri 2 shell is mobile-capable. The Android project is initialized and
an installable ARM64 debug APK can be built with Tauri using JDK 17, Android SDK 36,
and NDK 27. Release distribution still requires a protected signing key. iOS
packaging requires macOS, Xcode, and an Apple signing identity. Both platforms still
require real-device performance, file-picker, memory, and store-policy testing.

`package.json` is the authoritative Kea3D product version. Before starting a new
cross-platform release, run `npm run version:set -- <major.minor.patch>` once. This
synchronizes npm, Tauri, Cargo, and their lockfiles; `npm run version:check` and the
normal quality/build workflows reject any mismatch. Web, Windows, Linux, macOS,
Android, and iOS packages therefore use the same release version even when native
packages are built later on their required host operating systems.

On Windows, `npm run mobile:android:package` runs the web quality checks, builds the
signed ARM64 debug APK at the current shared product version, verifies its Android
Open with MIME/URI declarations, embedded version, and signature, and refreshes
`artifacts/android/Kea3D-android-arm64-debug-current.apk`. It also retains
`Kea3D-<version>-android-arm64-debug.apk` and copies that file to `C:\MEGA\Share`.
Packaging never advances one platform independently; change the shared version first.
After installation, Android still requires the user to choose **Kea3D → Always**;
applications cannot silently make themselves the default model viewer.

The same checked ARM64 debug build can be started manually from GitHub Actions
with the **Android test package** workflow. It uploads the verified APK as a
14-day workflow artifact; it is not a Play Store or production-signed release.

Preferences are saved locally by the browser or desktop webview. The Settings panel
can export or import the same validated JSON document for portable transfer without
including model data.

## Privacy

Files are processed locally. The core has no upload service, account requirement, analytics, or telemetry.

## License

MPL-2.0. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
