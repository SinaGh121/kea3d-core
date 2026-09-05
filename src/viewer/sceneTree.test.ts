import { describe, expect, it } from 'vitest';
import { Group, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { buildSceneTree } from './sceneTree';

describe('buildSceneTree', () => {
  it('keeps renderable hierarchy and gives unnamed parts readable labels', () => {
    const root = new Group();
    root.name = 'Assembly';
    const empty = new Group();
    const group = new Group();
    group.name = 'Housing';
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    group.add(mesh);
    root.add(empty, group);
    const objects = new Map();

    const tree = buildSceneTree(root, objects);

    expect(tree[0].name).toBe('Assembly');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe('Housing');
    expect(tree[0].children[0].children[0].name).toBe('Part 1');
    expect(objects.has(mesh.uuid)).toBe(true);
  });

  it('keeps non-renderable Anchor nodes in the inspectable hierarchy', () => {
    const root = new Group();
    const anchor = new Group();
    anchor.name = 'Base mount';
    anchor.userData = { kea3d: { anchor: { id: 'base', version: 1 } } };
    root.add(anchor);

    const objects = new Map();
    const tree = buildSceneTree(root, objects);

    expect(tree[0].children[0]).toMatchObject({ name: 'Base mount', type: 'anchor' });
    expect(objects.get(anchor.uuid)).toBe(anchor);
  });
});
