import { Group, Matrix4, Vector3, type Object3D } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { validateJoint, type Kea3dJoint, type Kea3dProjectDocument } from './projectFormat';
import { discoverComponentAnchorDetails, promoteLegacyNamedAnchors } from './componentAnchors';

const bindings = new WeakMap<Object3D, { instance: string; target: Matrix4; sourceInverse: Matrix4 }>();

export function assemblyObjectForInstance(root: Object3D, instance: string): Object3D | undefined {
  let result: Object3D | undefined;
  root.traverse(object => {
    if (bindings.get(object)?.instance === instance) result = object;
  });
  return result;
}

export function assemblyInstanceForObject(object: Object3D | undefined): string | undefined {
  for (let node = object; node; node = node.parent ?? undefined) {
    const binding = bindings.get(node);
    if (binding) return binding.instance;
  }
  return undefined;
}

export function assemblyJointFrame(root: Object3D, instance: string): Matrix4 {
  root.updateWorldMatrix(true, true);
  let frame: Matrix4 | undefined;
  root.traverse(group => {
    const binding = bindings.get(group);
    if (binding?.instance === instance && group.parent) frame = group.parent.matrixWorld.clone().multiply(binding.target);
  });
  if (!frame) throw new Error('Assembly connection was not found.');
  return frame;
}

export function applyAssemblyJoint(root: Object3D, instance: string, value?: Kea3dJoint): void {
  const joint = value === undefined ? undefined : validateJoint(value);
  let found = false;
  root.traverse(group => {
    const binding = bindings.get(group);
    if (!binding || binding.instance !== instance) return;
    found = true;
    const motion = new Matrix4();
    if (joint) {
      const axis = new Vector3(joint.axis === 'x' ? 1 : 0, joint.axis === 'y' ? 1 : 0, joint.axis === 'z' ? 1 : 0);
      if (joint.type === 'revolute') motion.makeRotationAxis(axis, joint.state.position);
      else motion.makeTranslation(axis.multiplyScalar(joint.state.position));
    }
    group.matrix.copy(binding.target).multiply(motion).multiply(binding.sourceInverse);
    group.matrix.decompose(group.position, group.quaternion, group.scale);
    group.updateMatrix();
  });
  if (!found) throw new Error('Assembly connection was not found.');
  root.updateMatrixWorld(true);
}

export function discoverComponentAnchors(scene: Object3D, resourceId: string): Map<string, Matrix4> {
  promoteLegacyNamedAnchors(scene);
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
    const sourceAnchor = attachment.sourceAnchor === undefined ? new Matrix4()
      : requiredAnchor(anchorsByResource.get(instance.resource)!, attachment.sourceAnchor, instance.id, instance.resource);
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
    bindings.set(group, { instance: instance.id, target: targetAnchor.clone(), sourceInverse: sourceAnchor.clone().invert() });
    applyAssemblyJoint(group, instance.id, attachment.joint);
  }

  assembly.updateMatrixWorld(true);
  return assembly;
}
