# Windows native CAD source and recipient rebuild

The Windows executable embeds a separate C++ CAD worker. The worker
statically links OpenCascade Technology (OCCT) 7.8.1. This is independent of
the WebAssembly CAD importer documented in native/cad-wasm/README.md.

## Exact dependency source

The recorded OCCT CMake cache identifies the source and BUILD_PATCH inputs as
the published **occt-sys 7.8.1** crate, not an arbitrary OCCT installation:

- Download: https://static.crates.io/crates/occt-sys/occt-sys-7.8.1.crate
- SHA-256: `c3d2199ccf5331d261cf293abbc6b6b6ca1eb7187ef2113c181c49f9365cd9ae`
- Crate repository: https://github.com/bschwind/opencascade-rs
- Crate VCS revision: `bbd62aba7e7516db9ed91685ef5a946f99c277ce`
- OCCT source is under `OCCT/`; retain `LICENSE_LGPL_21.txt` and
  `OCCT_LGPL_EXCEPTION.txt` without modification.
- The crate's `patch/adm/MODULES` and `patch/adm/RESOURCES` are build overlays.
  Both are included in that archive. Do not silently substitute stock OCCT
  module/resource definitions.
- The worker also compiles the thumbnail renderer with cgltf pinned in its
  CMakeLists.txt. cgltf's MIT notice is supplied in public/licenses/cgltf-MIT.txt.

## Build with your own toolchain

Prerequisites: Windows x64, Visual Studio 2022 Desktop development with C++,
Windows SDK, CMake 3.24 or later, Git and tar. For the full app also install
Node/npm and Rust's x86_64-pc-windows-msvc toolchain.

1. Extract the matching Kea3D Core source archive. Download the crate above.
2. In PowerShell at the Core source root, run:

   ```powershell
   ./scripts/rebuild-windows-occt.ps1 -SourceArchive C:/build/occt-sys-7.8.1.crate -OutputDirectory C:/build/kea3d-occt
   ```

   Use a new output directory. The script checks the archive hash and recreates
   the static Release build with the recorded module overlays and disabled
   optional dependencies. It does not use the publisher's temporary build paths.
3. Build the worker against the new installation:

   ```powershell
   ./scripts/build-native-cad-worker.ps1 -OpenCascadeRoot C:/build/kea3d-occt/install
   ```

4. Check the worker independently with a STEP fixture:

   ```powershell
   node scripts/benchmark-native-cad.mjs --file tests/fixtures/cad-native-colors.step --worker native/cad-worker/build/Release/kea3d-cad-worker.exe --expected-triangles 12 --expected-colored-faces 6 --minimum-distinct-colors 2
   ```

5. To replace OCCT with a modified version, edit the extracted OCCT sources,
   then rerun CMake's build/install on that build directory and rebuild the worker.
   The archive check applies to the original download; modifications after
   extraction do not require publisher approval or credentials.
6. To embed the rebuilt worker in your own app, run `npm ci`, `npm run build`
   and `npm run desktop:build` at the Core root. src-tauri/build.rs copies the
   worker into the executable at compile time. Use the resulting unsigned
   executable under src-tauri/target/release or sign it with your own key.
   Do not use package-copy scripts targeting the publisher's MEGA folder.

The app does not require the publisher's signature or a license key to run a
recipient build. Replacing an extracted cached worker in the official installed
app is not the replacement mechanism: rebuild the app to embed your worker.
Compiler versions and timestamps can change binary hashes; functional rebuild
verification is not a claim of bit-for-bit reproducibility.

## Verification on 2026-09-06

A fresh archive extraction matched all 14,983 files in the original Cargo source
directory byte-for-byte. A new OCCT installation and worker were built with
Visual Studio 2022 / MSVC 19.44.35228 / Windows SDK 10.0.26100, without reusing
the original OCCT libraries. Both workers passed the authored single-root color
fixture: 12 triangles, 24 vertices, six colored faces and two distinct colors.
The original multi-root WASM fixture is intentionally not used: this worker
currently accepts exactly one STEP root. This is a functional worker rebuild
test, not clean-machine installer acceptance or exhaustive CAD compatibility.

Generate the native fixture with native/cad-wasm/fixtures and pass
`tests/fixtures/cad-native-colors.step --single-root` to its executable.
