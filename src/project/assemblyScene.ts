import { Group, type Matrix4, type Object3D } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Kea3dProjectDocument } from './projectFormat';
import { discoverComponentAnchorDetails } from './componentAnchors';

export function discoverComponentAnchors(scene: Object3D, resourceId: string): Map<string, Matrix4> {
  return new Map(discoverComponentAnchorDetails(scene, resourceId).map((anchor) => [anchor.id, anchor.matrix]));
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
