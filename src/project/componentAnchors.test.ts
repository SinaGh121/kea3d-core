import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { applyAnchorEdit, anchorIdForObject, discoverComponentAnchorDetails, validateAnchorEditInput, type AnchorEditInput } from './componentAnchors';

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

  it('validates and applies editable local transforms as version-one metadata', () => {
    const object = new Group();
    const input = validateAnchorEditInput({
      id: 'shaft-end', name: 'Shaft end', position: [1, 2, 3], rotation: [0, 90, -45],
    }, ['base']);
    applyAnchorEdit(object, input);

    expect(object.name).toBe('Shaft end');
    expect(object.position.toArray()).toEqual([1, 2, 3]);
    expect(object.scale.toArray()).toEqual([1, 1, 1]);
    expect(object.userData.kea3d.anchor).toEqual({ version: 1, id: 'shaft-end' });
    expect(anchorIdForObject(object, 'motor')).toBe('shaft-end');
  });

  it('rejects invalid, duplicate, and non-finite edits', () => {
    const valid = { id: 'base', name: 'Base', position: [0, 0, 0], rotation: [0, 0, 0] } satisfies AnchorEditInput;
    expect(() => validateAnchorEditInput(valid, ['base'])).toThrow('already used');
    expect(() => validateAnchorEditInput({ ...valid, id: '1-base' }, [])).toThrow('must start');
    expect(() => validateAnchorEditInput({ ...valid, position: [Number.NaN, 0, 0] }, [])).toThrow('finite');
  });
});
