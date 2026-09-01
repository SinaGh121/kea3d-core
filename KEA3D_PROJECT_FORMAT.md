# Kea3D Assembly Project Format

## Status

Version one is frozen in source at `public/schemas/project/v1.json`. The pure
parser enforces the same bounded IDs, paths, resources, instances, and acyclic
attachment graph before any visible model is replaced. Future changes require
an explicit migration and backward-compatibility fixture.

The current opening slice resolves all referenced GLBs explicitly selected with
the manifest, discovers version-one anchor metadata, and evaluates fixed
multi-instance attachments without mutating source assets. Desktop project-
relative resolution, explicit web/PWA project-folder selection, optional resource
integrity checks, and session-only recovery are implemented. Anchor authoring,
Save/Save As, joints, and canonical
website publication remain later gates.

`ANCHOR_ATTACHMENT_SYSTEM.md` is the detailed authority for Anchor,
Attachment, and Joint semantics. The core rule is that Anchors define location
and orientation, Attachments define connectivity, and optional Joints define
movement. Fixed Attachments omit the `joint` property.

`POSES_MOTION_SYSTEM.md` defines the future Pose and Motion layer built on
stable Joint IDs. Pose and Motion collections extend this resource/instance
model rather than replacing it with a second asset model.

## Decision

Kea3D uses two complementary formats:

- `.glb` for reusable, independently viewable component assets and flattened
  standard exchange.
- `.kea3d` for a UTF-8 JSON assembly project that references component files,
  instances them, and records their attachment relationships.

Project geometry is referenced rather than embedded. Kea3D must not modify a
source component merely because it is used by an assembly.

```text
robot/
├── robot.kea3d
└── components/
    ├── chassis.glb
    ├── motor.glb
    ├── camera.glb
    └── sensor.glb
```

The initial implementation supports GLB component resources only. Other source
formats can be imported and converted to GLB before becoming project resources.

## Model

The project separates reusable resources from assembly instances:

- A **resource** identifies one external GLB file.
- An **instance** places one occurrence of a resource in the assembly.
- An **anchor** is a named coordinate frame inside a component.
- An **attachment** aligns a source anchor to a target instance anchor.

This separation allows four wheel instances, for example, to reference one
`wheel.glb` without duplicating the component file.

Every project has exactly one root instance. Every non-root instance has at most
one attachment parent. Attachment relationships form a directed acyclic graph;
cycles and dangling references are invalid. Every instance must be reachable
from the declared root, so detached subgraphs cannot be saved as a valid
version-one project.

## Draft version-one document

```json
{
  "$schema": "https://kea3d.com/schemas/project/v1.json",
  "format": "kea3d-project",
  "version": 1,
  "name": "Robot",
  "rootInstance": "chassis",
  "resources": [
    {
      "id": "chassis-model",
      "uri": "components/chassis.glb"
    },
    {
      "id": "wheel-model",
      "uri": "components/wheel.glb"
    }
  ],
  "instances": [
    {
      "id": "chassis",
      "resource": "chassis-model"
    },
    {
      "id": "wheel-front-left",
      "resource": "wheel-model",
      "attachment": {
        "sourceAnchor": "wheel-base",
        "targetInstance": "chassis",
        "targetAnchor": "wheel-front-left"
      }
    }
  ]
}
```

Stable IDs are machine identifiers and must be unique within their namespace.
Display names may change without breaking attachments. An optional source
integrity record may contain a non-negative `byteLength`, a hexadecimal SHA-256
digest, or both. Integrity mismatches require an explicit recovery choice and
must never silently discard a user's project or overwrite a source file.

## Component anchors

Anchors are ordinary glTF nodes without geometry. Their transforms define a
coordinate frame relative to the component root. Kea3D metadata is stored in
standard glTF `extras`, so the GLB remains valid in other viewers.

```json
{
  "name": "Base",
  "translation": [0, 0, 0],
  "rotation": [0, 0, 0, 1],
  "extras": {
    "kea3d": {
      "anchor": {
        "id": "wheel-base",
        "version": 1
      }
    }
  }
}
```

Anchor scale should normally remain `[1, 1, 1]`. Non-finite transforms,
duplicate anchor IDs, and zero or non-uniform anchor scales are rejected unless
a later schema explicitly defines their semantics.

## Transform resolution

For an attachment, Kea3D computes the component transform that makes the two
anchor coordinate frames coincide:

```text
instance world transform
  = target anchor world transform
  × inverse(source anchor component-space transform)
```

The source-anchor transform is its accumulated transform relative to the
component root, not merely the anchor node's immediate local transform. The
resolved transform aligns position, orientation, and axes without baking changes
into source geometry.

Manual transform offsets may be added later as explicit, versioned project data.
They must be applied predictably after attachment resolution and remain
reversible. Attachment scale is not part of version one.

## Paths and portability

Resource URIs use forward-slash project-relative paths such as
`components/motor.glb`. Version one rejects:

- absolute paths;
- drive letters and UNC paths;
- URI schemes and remote URLs;
- empty segments, `.` or `..` traversal;
- paths that escape the selected project root;
- duplicate normalized paths and ambiguous case-only collisions.

Desktop builds resolve referenced files from the project directory after applying
the same bounded URI rules, canonicalizing every path, rejecting paths outside
the project root, and loading only resources referenced by instances. Browsers
cannot silently read adjacent files: the web/PWA flow asks the user to select the
project folder or all required companion files and resolves them through the
existing local-file map. A `.kea3d` file never grants filesystem access.

## Missing and changed resources

The v1 loader is atomic: if a referenced component is missing, ambiguous,
changed, or invalid, Kea3D preserves the already-open model and reports every
resource that needs attention without partially replacing the scene. The
recovery workspace can:

1. preserve the missing resource and instance records;
2. show one clear, non-blocking project warning;
3. locate or explicitly replace a resource;
4. accept a changed resource by removing its stale integrity record in memory;
5. intentionally remove unavailable non-root component subtrees in memory;
6. load the resulting assembly only after an explicit recovery choice;
7. avoid overwriting the original project during recovery.

Invalid resources or instances must not cause valid source files to be modified.
Saving uses a validated document and atomic replacement where the platform
supports it.

## Validation and safety

The loader validates the complete document before mutating the visible project.
Validation includes schema version, type and size limits, unique IDs, normalized
paths, root existence, resource references, anchor references, finite transforms,
attachment cycles, and configurable resource/instance limits. Unknown required
versions fail clearly; unknown optional fields are preserved when practical.

Project files contain no executable code. Loading a project performs no network
request and follows Kea3D's local-only privacy boundary.

## Standard export

`Export Assembly` creates a new standard GLB containing resolved instance
transforms and geometry. It does not replace the modular project or source
components. The export path must pass the existing scene validation and corrected
GLB round-trip gates.

```text
robot.kea3d + components/*
  -> resolve and validate assembly
  -> export robot.glb
```

## Future packaged project

Kea3D reserves `.kea3dp` for a later self-contained package containing one
ordinary `.kea3d` manifest and its required component files. It is a transport
and sharing container, not a second assembly schema, and is not part of the
initial version-one implementation.

```text
robot.kea3dp
├── project.kea3d
├── components/
│   ├── chassis.glb
│   ├── wheel.glb
│   └── motor.glb
└── preview/
    └── thumbnail.png
```

The package uses a ZIP-compatible container behind the product-specific
extension. It must unpack into a normal portable `.kea3d` project folder, and
packing that folder again must preserve the same validated project semantics.
The manifest remains the authority for format and schema versions. GLB entries
should normally be stored without expensive additional compression because
their geometry and textures may already be compressed.

Initial package rules are deliberately strict:

- exactly one `project.kea3d` manifest at the package root;
- normalized project-relative paths only;
- no absolute, drive, UNC, remote, empty, `.` or `..` paths;
- no executable behavior, symlinks, encrypted entries, or nested archives;
- rejection of duplicate and ambiguous case-only paths;
- explicit entry-count, individual-size, total-expanded-size, path-length, and
  compression-ratio limits;
- validation before any package replaces the currently visible project;
- atomic package writes where the platform supports them;
- no mutation of reusable source GLB files.

The planned user operations are `Pack Project`, `Unpack Project`, and normal
Open/Save support for an already packaged document. `Export Flattened GLB`
remains a separate interoperability operation. Streaming behavior, licensing
review, missing-resource policy, and deterministic pack/unpack and malformed-
archive tests are release gates.

## Implementation sequence

1. Freeze JSON Schema v1 and canonical path/ID rules. **Complete.**
2. Add pure parser, validator, graph, and transform-resolution modules. **Complete for fixed attachments.**
3. Add GLB anchor discovery and authoring with stable metadata. **Discovery complete; authoring remains.**
4. Add multi-file/folder project opening with missing-resource recovery. **Complete for desktop relative resolution, web/PWA folder selection, optional integrity checks, and session-only locate/replace/accept/remove recovery.**
5. Add instances and attachment evaluation without mutating source assets. **Complete for fixed attachments.**
6. Add transactional save, Save As, and migration fixtures.
7. Add flattened GLB export and reopen validation.
8. Add bounded `.kea3dp` pack/unpack only after transparent external projects
   and their Save/Save As recovery behavior are proven.

All changes after schema v1 ships require explicit migration behavior and
backward-compatibility fixtures.
