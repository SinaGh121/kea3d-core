# Third-party notices

Kea3D is licensed under MPL-2.0. Its dependency versions are pinned in
`package-lock.json`.

## Import and rendering runtimes

- Three.js — MIT — <https://github.com/mrdoob/three.js>
- fflate — MIT — <https://github.com/101arrowz/fflate>
- occt-import-js — LGPL-2.1 — <https://github.com/kovacsv/occt-import-js>
- Open CASCADE Technology, used by occt-import-js — LGPL-2.1 with the OCCT
  exception — <https://dev.opencascade.org/resources/licensing>
- assimpjs — MIT — <https://github.com/kovacsv/assimpjs>
- Assimp, used by assimpjs — BSD-3-Clause — <https://github.com/assimp/assimp>
- cgltf, used by the Windows GLB thumbnail provider — MIT —
  <https://github.com/jkuhlmann/cgltf>

The OpenCascade and Assimp WebAssembly modules are separate build assets.
Native applications may embed them inside their signed package: replacement
then requires rebuilding and signing your own copy, not editing the installed
package. Kea3D does not require the publisher's signing key for your own build.
Kea3D's CAD WebAssembly module includes a modified
occt-import-js 0.0.23 XCAF color resolver. Its LGPL-2.1 source and pinned rebuild
instructions are in `native/cad-wasm/` in the corresponding Core source release;
runtime license texts are in `vendor/cad-wasm/`. Other upstream source is available
from the links above at the versions recorded in `package-lock.json`. Distribution packages
must include `public/licenses/occt-import-js-LGPL-2.1.txt` and
`public/licenses/assimpjs-MIT.txt`. Packages with `.kea3dp` support must include
`public/licenses/fflate-MIT.txt`.
Windows packages that include the thumbnail provider must also include
`public/licenses/cgltf-MIT.txt`.

## Interface dependencies

- React and React DOM — MIT
- Radix UI — MIT
- shadcn/ui — MIT
- Lucide — ISC
- Geist font — SIL Open Font License 1.1
- Tailwind CSS — MIT

## Application shell

- Tauri — Apache-2.0 OR MIT — <https://github.com/tauri-apps/tauri>
- Tauri Opener plugin — Apache-2.0 OR MIT — <https://github.com/tauri-apps/plugins-workspace>
- Windows packages use the installed Microsoft Edge WebView2 Runtime.

The app's Third-party panel also includes the collected upstream license texts
from THIRD_PARTY_LICENSES.txt. These texts preserve component-specific terms.
