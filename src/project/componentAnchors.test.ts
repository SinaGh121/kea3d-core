import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { anchorIdForObject, discoverComponentAnchorDetails } from './componentAnchors';

function anchor(id: string, name = ''): Group {
  const object = new Group();
  object.name = name;
  object.userData = { kea3d: { anchor: { id, version: 1, metadata: {} } } };
  return object;
}

describe('component anchor catalog', () => {
  it('discovers stable IDs, display names, parents, and component-space transforms', () => {
    const root = new Group();
    root.name = 'Motor';
    const base = anchor('base', 'Base mount');
    base.position.set(1, 2, 3);
    root.add(base);

    const [result] = discoverComponentAnchorDetails(root, 'motor');

    expect(result.id).toBe('base');
    expect(result.name).toBe('Base mount');
    expect(result.parentName).toBe('Motor');
    expect(result.position).toEqual([1, 2, 3]);
    expect(result.object).toBe(base);
  });

  it('uses the stable ID as the fallback display name', () => {
    const object = anchor('shaft');
    expect(discoverComponentAnchorDetails(object, 'motor')[0].name).toBe('shaft');
  });

  it('rejects invalid and duplicate metadata through the shared validator', () => {
    const root = new Group();
    root.add(anchor('same'), anchor('same'));
    expect(() => discoverComponentAnchorDetails(root, 'motor')).toThrow('duplicated');

    const unsupported = anchor('future');
    unsupported.userData.kea3d.anchor.version = 2;
    expect(() => anchorIdForObject(unsupported, 'motor')).toThrow('version must be 1');
  });
});
