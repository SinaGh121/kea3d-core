import { Euler, MathUtils, Matrix4, Quaternion, Vector3, type Object3D } from 'three';

const anchorIdPattern = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const legacyNamedAnchorPattern = /^[A-Z][A-Z0-9]{1,7}_[A-Z][A-Z0-9]{1,7}_[0-9]{2,4}$/;
const unitScaleTolerance = 1e-5;

export interface ComponentAnchor {
  id: string;
  name: string;
  object: Object3D;
  matrix: Matrix4;
  position: [number, number, number];
  rotation: [number, number, number, number];
  parentName: string | null;
}

export interface AnchorEditInput {
  id: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
}

function anchorError(resourceId: string, message: string): never {
  throw new Error(`Invalid anchor in project resource "${resourceId}": ${message}`);
}

export function anchorIdForObject(object: Object3D, resourceId: string): string | null {
  const kea3d = object.userData?.kea3d;
  if (kea3d === undefined) return null;
  if (typeof kea3d !== 'object' || kea3d === null || Array.isArray(kea3d)) return null;
  const anchor = (kea3d as Record<string, unknown>).anchor;
  if (anchor === undefined) return null;
  if (typeof anchor !== 'object' || anchor === null || Array.isArray(anchor)) anchorError(resourceId, 'anchor metadata must be an object.');
  const record = anchor as Record<string, unknown>;
  if (record.version !== 1) anchorError(resourceId, 'anchor version must be 1.');
  if (typeof record.id !== 'string' || !anchorIdPattern.test(record.id)) anchorError(resourceId, 'anchor ID is invalid.');
  return record.id;
}

export function validateAnchorEditInput(input: AnchorEditInput, existingIds: Iterable<string>, previousId?: string): AnchorEditInput {
  const id = input.id.trim();
  const name = input.name.trim();
  if (!anchorIdPattern.test(id)) throw new Error('Anchor ID must start with a letter and use only letters, numbers, dot, underscore, or dash.');
  if (name.length < 1 || name.length > 128) throw new Error('Anchor name must contain 1 to 128 characters.');
  if ([...input.position, ...input.rotation].some((value) => !Number.isFinite(value))) throw new Error('Anchor position and rotation must contain finite numbers.');
  if ([...existingIds].some((existingId) => existingId === id && existingId !== previousId)) throw new Error(`Anchor ID "${id}" is already used.`);
  return { id, name, position: [...input.position], rotation: [...input.rotation] };
}

export function applyAnchorEdit(object: Object3D, input: AnchorEditInput): void {
  object.name = input.name;
  object.position.fromArray(input.position);
  object.quaternion.setFromEuler(new Euler(
    MathUtils.degToRad(input.rotation[0]),
    MathUtils.degToRad(input.rotation[1]),
    MathUtils.degToRad(input.rotation[2]),
    'XYZ',
  ));
  object.scale.set(1, 1, 1);
  object.userData.kea3d = {
    ...(typeof object.userData.kea3d === 'object' && object.userData.kea3d !== null ? object.userData.kea3d : {}),
    anchor: {
      ...(typeof object.userData.kea3d?.anchor === 'object' && object.userData.kea3d.anchor !== null && !Array.isArray(object.userData.kea3d.anchor) ? object.userData.kea3d.anchor : {}),
      version: 1,
      id: input.id,
    },
  };
}

export function promoteLegacyNamedAnchors(scene: Object3D, options: { allowInheritedScale?: boolean } = {}): number {
  scene.updateMatrixWorld(true);
  let promoted = 0;
  scene.traverse((object) => {
    if (object.children.length > 0 || !legacyNamedAnchorPattern.test(object.name.trim())) return;
    if (!['Object3D', 'Group'].includes(object.type) || anchorIdForObject(object, 'model')) return;
    try {
      anchorTransform(object, 'model', object.name.trim(), options.allowInheritedScale);
    } catch {
      // A name is only a compatibility hint, never grounds to reject a model.
      return;
    }
    const kea3d = typeof object.userData.kea3d === 'object' && object.userData.kea3d !== null
      ? object.userData.kea3d as Record<string, unknown>
      : {};
    object.userData.kea3d = {
      ...kea3d,
      anchor: { version: 1, id: object.name.trim() },
    };
    promoted += 1;
  });
  return promoted;
}

function anchorTransform(object: Object3D, resourceId: string, id: string, allowInheritedScale = false) {
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  object.matrixWorld.decompose(position, rotation, scale);
  if (![...position.toArray(), ...rotation.toArray(), ...scale.toArray()].every(Number.isFinite)) {
    anchorError(resourceId, `anchor "${id}" has a non-finite transform.`);
  }
  const checkedScale = allowInheritedScale
    ? new Vector3().setFromMatrixScale(object.matrix)
    : scale;
  if ((allowInheritedScale && object.matrix.determinant() <= 0) || checkedScale.toArray().some((value) => !Number.isFinite(value) || Math.abs(value - 1) > unitScaleTolerance)) {
    anchorError(resourceId, `anchor "${id}" must not contain scale.`);
  }
  if (Math.abs(rotation.length() - 1) > unitScaleTolerance) anchorError(resourceId, `anchor "${id}" has an invalid rotation.`);
  rotation.normalize();
  return { position, rotation };
}

export function discoverComponentAnchorDetails(
  scene: Object3D,
  resourceId: string,
  options: { allowDuplicateIds?: boolean; allowInheritedScale?: boolean } = {},
): ComponentAnchor[] {
  scene.updateMatrixWorld(true);
  const anchors: ComponentAnchor[] = [];
  const ids = new Set<string>();
  scene.traverse((object) => {
    const id = anchorIdForObject(object, resourceId);
    if (!id) return;
    if (!options.allowDuplicateIds && ids.has(id)) anchorError(resourceId, `anchor ID "${id}" is duplicated.`);
    ids.add(id);
    const { position, rotation } = anchorTransform(object, resourceId, id, options.allowInheritedScale);
    anchors.push({
      id,
      name: object.name.trim() || id,
      object,
      matrix: new Matrix4().compose(position, rotation, new Vector3(1, 1, 1)),
      position: position.toArray(),
      rotation: rotation.toArray(),
      parentName: object.parent?.name.trim() || null,
    });
  });
  return anchors;
}

export function isAnchorObject(object: Object3D): boolean {
  try {
    return anchorIdForObject(object, 'model') !== null;
  } catch {
    return false;
  }
}
