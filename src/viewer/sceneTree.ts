import { Mesh, type Object3D } from 'three';
import type { SceneNode } from './types';

export function buildSceneTree(root: Object3D, objects: Map<string, Object3D>): SceneNode[] {
  let meshIndex = 0;
  let groupIndex = 0;

  const visit = (object: Object3D, isRoot = false): SceneNode | null => {
    const children = object.children
      .map((child) => visit(child))
      .filter((child): child is SceneNode => child !== null);
    const isMesh = object instanceof Mesh;
    if (!isRoot && !isMesh && children.length === 0) return null;

    objects.set(object.uuid, object);
    if (isMesh) meshIndex += 1;
    else groupIndex += 1;

    return {
      id: object.uuid,
      name: object.name.trim() || (isMesh ? `Part ${meshIndex}` : isRoot ? 'Model' : `Group ${groupIndex}`),
      type: isMesh ? 'mesh' : 'group',
      visible: object.visible,
      children,
    };
  };

  const tree = visit(root, true);
  return tree ? [tree] : [];
}
