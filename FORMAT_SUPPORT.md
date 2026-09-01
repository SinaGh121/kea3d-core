# Format support

Kea3D imports files locally. Support quality depends on the source format and
the features used by the authoring tool.

| Format | Status | Notes |
| --- | --- | --- |
| KEA3D Project v1 | Fixed assemblies | Validated reusable GLB instances, deterministic anchor attachments, secure relative resolution, optional integrity checks, missing/changed-resource recovery, validated Save/Save As, and flattened GLB export. Joints remain planned. |
| KEA3DP package | Primary project transport | Self-contained, bounded ZIP-compatible transport containing one validated Project v1 manifest and every required GLB. Open, Pack, Save, and Save As are implemented; folder Unpack remains planned. |
| GLB / glTF | Primary | Scenes, PBR materials, textures, animations, Draco, Meshopt, and KTX2/Basis. Select external `.bin` and texture files with `.gltf`. |
| STEP / STP | Primary CAD | Worker-based OpenCascade tessellation; assemblies and colors depend on source metadata. |
| IGES / IGS / BREP | Primary CAD | Worker-based OpenCascade tessellation. |
| STL | Primary mesh | Binary and ASCII; color is preserved when the STL variant contains supported color data. |
| 3MF | Primary mesh | Geometry, supported materials, colors, and authored units. |
| OBJ / MTL | Compatible | Select OBJ, MTL, and referenced textures together. |
| PLY | Compatible | Geometry and vertex colors. |
| FBX | Compatible | Geometry, supported materials, external textures, and animation clips. |
| COLLADA / DAE | Compatible | Geometry, supported materials, external textures, and animation clips. |
| BLEND | Best effort | Compatibility conversion through Assimp. Blender features and newer file versions may require File > Export > glTF 2.0 (GLB) in Blender. Kea3D reports the detected Blender version when this fallback is required. |

## Kea3D project format

`.kea3d` is a versioned UTF-8 JSON assembly-project manifest that references
reusable project-local GLB components. Version 1 schema parsing, bounded path/ID
validation, graph validation, multi-resource opening, anchor discovery, and
fixed attachment transforms are implemented. Desktop filesystem opens resolve
safe project-relative GLBs automatically. Web/PWA provides an explicit project-
folder picker and still supports selecting companions together. Missing or changed
resources open a non-destructive recovery workspace; invalid anchors are reported
without replacing the open model. Validated manifest Save/Save As and flattened
single-file GLB export are implemented. Anchor authoring and joints remain planned.

`.kea3dp` packages reuse the same manifest schema. They reject traversal,
absolute or colliding paths, directory/symlink/encrypted/nested/unreferenced
entries, unsupported compression, malformed local/central headers, excessive
entry sizes/counts, compression ratios, and expanded totals before loading.
Required GLBs are stored without redundant compression. Desktop package saves
use a same-directory temporary file and atomic replacement; mobile uses the
system document provider and web/PWA downloads the package locally.

The authoritative contract and implementation gates are in
`KEA3D_PROJECT_FORMAT.md`.

Corrected-copy export is GLB. It preserves supported scene data and applies the
selected uniform scale, source-unit correction, up-axis correction, origin, and
ground-placement changes. It is not a full CAD editor and does not rewrite the
original file.

Large STL and PLY geometry is decoded in workers. STEP, IGES, BREP, and BLEND
conversion also runs in workers. Edge extraction falls back to wireframe for very
large individual meshes to avoid blocking the interface.
