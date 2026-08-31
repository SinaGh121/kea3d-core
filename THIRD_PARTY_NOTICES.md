# Third-party notices

Kea3D is licensed under MPL-2.0. Its dependency versions are pinned in
`package-lock.json`.

## Import and rendering runtimes

- Three.js — MIT — <https://github.com/mrdoob/three.js>
- occt-import-js — LGPL-2.1 — <https://github.com/kovacsv/occt-import-js>
- Open CASCADE Technology, used by occt-import-js — LGPL-2.1 with the OCCT
  exception — <https://dev.opencascade.org/resources/licensing>
- assimpjs — MIT — <https://github.com/kovacsv/assimpjs>
- Assimp, used by assimpjs — BSD-3-Clause — <https://github.com/assimp/assimp>
- cgltf, used by the Windows GLB thumbnail provider — MIT —
  <https://github.com/jkuhlmann/cgltf>

The OpenCascade and Assimp WebAssembly modules are shipped as separate,
replaceable files. Unmodified upstream source is available from the links
above at the versions recorded in `package-lock.json`. Distribution packages
must include `public/licenses/occt-import-js-LGPL-2.1.txt` and
`public/licenses/assimpjs-MIT.txt`.
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
- Windows packages use the installed Microsoft Edge WebView2 Runtime.

This notice is informational and does not replace the complete license texts
provided by the respective projects.
