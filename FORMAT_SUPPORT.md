# Format support

Kea3D imports files locally. Support quality depends on the source format and
the features used by the authoring tool.

| Format | Status | Notes |
| --- | --- | --- |
| KEA3D Project v1 | Fixed assemblies | Validated local JSON manifest with reusable GLB instances and deterministic anchor-to-anchor attachments. Select the manifest and referenced GLBs together. Save/Save As and joints remain planned. |
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
fixed attachment transforms are implemented. The manifest and referenced GLBs
must currently be selected together; missing resources or anchors are reported
without replacing the open model. Folder recovery, anchor authoring, Save/Save
As, joints, and flattened assembly export remain planned.

The authoritative contract and implementation gates are in
`KEA3D_PROJECT_FORMAT.md`.

Corrected-copy export is GLB. It preserves supported scene data and applies the
selected uniform scale, source-unit correction, up-axis correction, origin, and
ground-placement changes. It is not a full CAD editor and does not rewrite the
original file.

Large STL and PLY geometry is decoded in workers. STEP, IGES, BREP, and BLEND
conversion also runs in workers. Edge extraction falls back to wireframe for very
large individual meshes to avoid blocking the interface.
