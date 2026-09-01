import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';

const anchorIdPattern = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
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

export function discoverComponentAnchorDetails(
  scene: Object3D,
  resourceId: string,
  options: { allowDuplicateIds?: boolean } = {},
): ComponentAnchor[] {
  scene.updateMatrixWorld(true);
  const anchors: ComponentAnchor[] = [];
  const ids = new Set<string>();
  scene.traverse((object) => {
    const id = anchorIdForObject(object, resourceId);
    if (!id) return;
    if (!options.allowDuplicateIds && ids.has(id)) anchorError(resourceId, `anchor ID "${id}" is duplicated.`);
    ids.add(id);
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    object.matrixWorld.decompose(position, rotation, scale);
    if (![...position.toArray(), ...rotation.toArray(), ...scale.toArray()].every(Number.isFinite)) {
      anchorError(resourceId, `anchor "${id}" has a non-finite transform.`);
    }
    if (Math.abs(scale.x - 1) > unitScaleTolerance || Math.abs(scale.y - 1) > unitScaleTolerance || Math.abs(scale.z - 1) > unitScaleTolerance) {
      anchorError(resourceId, `anchor "${id}" must not contain scale.`);
    }
    if (Math.abs(rotation.length() - 1) > unitScaleTolerance) anchorError(resourceId, `anchor "${id}" has an invalid rotation.`);
    rotation.normalize();
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
