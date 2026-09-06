# Kea3D Core 0.1.100

Matching Free/Core source. License: MPL-2.0; third-party components retain their licenses. See LICENSE and THIRD_PARTY_NOTICES.md.

## Build

Install Node.js/npm, then run:

```sh
npm ci
npm run build
```

The web output is in dist/. Use npm run dev for local development.

Native builds require Rust and the target platform's Tauri prerequisites. Run npx tauri build for desktop packages.

Required component/platform rebuild instructions: native/cad-worker/README.md.
Required component/platform rebuild instructions: native/cad-wasm/README.md.
Required component/platform rebuild instructions: legal/ANDROID_RECIPIENT_REBUILD.md.

Preserve all license, notice and attribution files. Source releases: https://github.com/SinaGh121/kea3d-core/releases
