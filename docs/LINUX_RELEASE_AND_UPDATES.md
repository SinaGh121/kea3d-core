# Linux packages and update ownership

Target: x86_64 AppImage (portable), DEB (Debian/Ubuntu), RPM (Fedora family).
These are build candidates, not currently verified public downloads.

## Build

Use a Linux x64 build host with the project's pinned npm dependencies, Rust,
Visual Studio-independent C++ compiler, CMake >=3.24, pkg-config, patchelf,
RPM build tools, WebKitGTK 4.1 development headers and OpenCascade development
libraries. Linux native CAD uses host OCCT libraries, unlike Windows static OCCT.
Consult the host distribution's packages; do not substitute Windows binaries.

From the repository root:

```sh
npm ci
node scripts/build-linux-release.mjs --plan
node scripts/build-linux-release.mjs
```

The build uses the existing native CAD build/test hooks and Tauri's bundle
targets. It refuses stale or wrong-version artifacts, copies candidates to a
new artifacts/linux directory, and records hashes. It never publishes, installs,
changes repository signing keys, or registers a package repository.

## Acceptance before publication

- Check AppImage includes the native CAD worker and all required redistributable
  OCCT/shared libraries; ldd must not report unresolved dependencies on a clean host.
- Verify DEB dependency metadata with dpkg-deb and RPM requirements with rpm.
  Building RPM on a Debian host alone is not Fedora compatibility evidence.
- Install, launch, open authored colored STEP and GLB, export, then uninstall on
  clean Debian/Ubuntu and Fedora. Check desktop integration and model associations.
- Move AppImage to a different path (including spaces); test executable permission,
  FUSE availability, read-only locations and no-root execution.
- Retain source/build provenance and applicable native/runtime license notices.
- Publish per-format/architecture artifacts only after testing, then update public
  release metadata. Do not announce a local build as an available update.

## Updates

AppImage: planned signed download, explicit save/exit consent, writable-directory
probe, temporary sibling staging, atomic replacement where supported, previous
version retention, rollback and failure recovery. No automatic replacement yet.

DEB/RPM: only the package manager owns installed files. Until repositories are
configured, users download and install a newer package with their package manager.
Repository-based apt/dnf updates require separately configured signed metadata,
release retention and distribution testing. Do not invoke privileged commands
silently or overwrite package-owned files with a portable updater.

The current OS-only version list is discovery metadata, not permission to install.
Before automatic installation, introduce authenticated version/architecture and
distribution identity. Never infer portable mode solely from folder writability.
