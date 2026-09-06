# CAD WebAssembly color correction

The mobile/web worker uses `@kea3d/cad-wasm`, a replaceable local package based on
occt-import-js 0.0.23. Its API, geometry traversal, tessellation, unit handling,
and linear RGB output remain unchanged. Only XCAF surface-color lookup changes.

`importer-xcaf.cpp` is the complete modified upstream file, under LGPL-2.1,
not MPL-2.0. It collects standard `XCAFPrs::CollectStyleSettings` once per mesh
node, resolves body/shell colors onto faces, and gives explicit face colors
precedence. Maps remain import-local; no global cache or STEP text rewriting is
used. The original direct lookup remains the fallback for unstyled faces.

## Rebuild

Use a separate build workspace, outside the application directory:

- occt-import-js commit `c2148e54b456b571238d35cac037d304053d64b2` (tag 0.0.23).
- Its `occt` subdirectory: Open-Cascade-SAS/OCCT commit
  `d2abb6d844231cb8f29be6894440874a4700e4a5` (7.6.1).
- Emscripten SDK 3.1.69, CMake, and Ninja. Activate the SDK in the build shell.

```powershell
./scripts/build-cad-wasm.ps1 -ImporterSource <checkout> -EmsdkRoot <emsdk> -BuildDirectory <build> -CMake <cmake> -Ninja <ninja>
```

The script overlays only the modified source file and copies the generated JS
and WASM to `vendor/cad-wasm/dist`. Commit both artifacts with the modified
source, build recipe, and license texts. No compiler installation is needed to
build the application from the source snapshot.

`-PackageExistingBuild` only packages an already completed build from these exact
sources; it is not a compile or verification step. Run the checksum, color, and
geometry regressions before using packaged outputs.

`fixtures/main.cpp` generates the internally authored body/shell/face-color
regression STEP. Build it using its CMake project and an installed OpenCascade,
then pass the output filename to the generated executable. Private customer
models are tested locally only and must not be distributed.
