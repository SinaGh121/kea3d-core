# Format support

Kea3D imports files locally. Support quality depends on the source format and
the features used by the authoring tool.

| Format | Status | Notes |
| --- | --- | --- |
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

## Planned Kea3D project format

`.kea3d` is the approved, but not yet implemented, assembly-project format. It
will be a versioned UTF-8 JSON manifest that references reusable project-local
GLB components, instances them, and resolves anchor-to-anchor attachments. It is
not a geometry interchange format and must not be shown as currently supported
until the parser, validator, resolver, save flow, and round-trip tests ship.

The authoritative draft contract and implementation gates are in
`KEA3D_PROJECT_FORMAT.md`.

Corrected-copy export is GLB. It preserves supported scene data and applies the
selected uniform scale, source-unit correction, up-axis correction, origin, and
ground-placement changes. It is not a full CAD editor and does not rewrite the
original file.

Large STL and PLY geometry is decoded in workers. STEP, IGES, BREP, and BLEND
conversion also runs in workers. Edge extraction falls back to wireframe for very
large individual meshes to avoid blocking the interface.
