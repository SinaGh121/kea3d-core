import { Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Kea3dProjectDocument } from './projectFormat';

const anchorIdPattern = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const unitScaleTolerance = 1e-5;

function anchorError(resourceId: string, message: string): never {
  throw new Error(`Invalid anchor in project resource "${resourceId}": ${message}`);
}

function readAnchorId(object: Object3D, resourceId: string): string | null {
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

export function discoverComponentAnchors(scene: Object3D, resourceId: string): Map<string, Matrix4> {
  scene.updateMatrixWorld(true);
  const anchors = new Map<string, Matrix4>();
  scene.traverse((object) => {
    const id = readAnchorId(object, resourceId);
    if (!id) return;
    if (anchors.has(id)) anchorError(resourceId, `anchor ID "${id}" is duplicated.`);
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
    anchors.set(id, new Matrix4().compose(position, rotation.normalize(), new Vector3(1, 1, 1)));
  });
  return anchors;
}

function requiredAnchor(
  anchors: ReadonlyMap<string, Matrix4>,
  anchorId: string,
  instanceId: string,
  resourceId: string,
): Matrix4 {
  const anchor = anchors.get(anchorId);
  if (!anchor) throw new Error(`Project instance "${instanceId}" uses resource "${resourceId}", which is missing anchor "${anchorId}".`);
  return anchor;
}

export function buildFixedAssemblyScene(
  project: Kea3dProjectDocument,
  resourceScenes: ReadonlyMap<string, Object3D>,
): Group {
  const assembly = new Group();
  assembly.name = project.name;
  const anchorsByResource = new Map<string, Map<string, Matrix4>>();
  const groupsByInstance = new Map<string, Group>();

  for (const instance of project.instances) {
    const prototype = resourceScenes.get(instance.resource);
    if (!prototype) throw new Error(`Project resource "${instance.resource}" was not loaded.`);
    if (!anchorsByResource.has(instance.resource)) {
      anchorsByResource.set(instance.resource, discoverComponentAnchors(prototype, instance.resource));
    }
    const group = new Group();
    group.name = instance.id;
    group.add(clone(prototype));
    groupsByInstance.set(instance.id, group);
  }

  const root = groupsByInstance.get(project.rootInstance);
  if (!root) throw new Error(`Project root instance "${project.rootInstance}" was not created.`);
  assembly.add(root);

  const pending = project.instances.filter((instance) => instance.id !== project.rootInstance);
  while (pending.length > 0) {
    const index = pending.findIndex((instance) => instance.attachment && groupsByInstance.get(instance.attachment.targetInstance)?.parent);
    if (index < 0) throw new Error('Project attachment hierarchy could not be resolved.');
    const [instance] = pending.splice(index, 1);
    const attachment = instance.attachment!;
    const group = groupsByInstance.get(instance.id)!;
    const targetGroup = groupsByInstance.get(attachment.targetInstance)!;
    const sourceAnchor = requiredAnchor(anchorsByResource.get(instance.resource)!, attachment.sourceAnchor, instance.id, instance.resource);
    const targetInstance = project.instances.find((candidate) => candidate.id === attachment.targetInstance)!;
    const targetAnchor = requiredAnchor(
      anchorsByResource.get(targetInstance.resource)!,
      attachment.targetAnchor,
      targetInstance.id,
      targetInstance.resource,
    );
    group.matrix.copy(targetAnchor).multiply(sourceAnchor.clone().invert());
    group.matrix.decompose(group.position, group.quaternion, group.scale);
    group.matrixAutoUpdate = true;
    group.updateMatrix();
    targetGroup.add(group);
  }

  assembly.updateMatrixWorld(true);
  return assembly;
}
