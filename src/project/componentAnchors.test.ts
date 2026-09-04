import { describe, expect, it } from 'vitest';
import { Group, Mesh } from 'three';
import { CommandHistory } from '../commandHistory';
import { applyAnchorEdit, anchorIdForObject, discoverComponentAnchorDetails, isAnchorObject, promoteLegacyNamedAnchors, validateAnchorEditInput, type AnchorEditInput } from './componentAnchors';

function anchor(id: string, name = ''): Group {
  const object = new Group();
  object.name = name;
  object.userData = { kea3d: { anchor: { id, version: 1, metadata: {} } } };
  return object;
}

describe('component anchor catalog', () => {
  it('preserves additional Anchor metadata through editing, undo, and redo', () => {
    const object = anchor('mount');
    object.userData.kea3d.anchor.metadata = { description: 'Keep me', tags: ['mount'] };
    object.userData.kea3d.anchor.extension = { vendor: 'example' };
    const before: AnchorEditInput = { id: 'mount', name: 'Mount', position: [0, 0, 0], rotation: [0, 0, 0] };
    const after: AnchorEditInput = { ...before, id: 'renamed', name: 'Renamed', position: [1, 2, 3] };
    const history = new CommandHistory();
    history.execute({ label: 'Edit Anchor', apply: () => applyAnchorEdit(object, after), revert: () => applyAnchorEdit(object, before) });
    for (const action of [() => {}, () => history.undo(), () => history.redo()]) {
      action();
      expect(object.userData.kea3d.anchor.metadata).toEqual({ description: 'Keep me', tags: ['mount'] });
      expect(object.userData.kea3d.anchor.extension).toEqual({ vendor: 'example' });
    }
    expect(object.userData.kea3d.anchor.id).toBe('renamed');
  });

  it('allows inherited calibration in the viewer but keeps local Anchor and assembly scale validation', () => {
    const root = new Group();
    root.scale.setScalar(2.54);
    const mount = anchor('mount');
    mount.position.x = 1;
    root.add(mount);
    expect(discoverComponentAnchorDetails(root, 'scaled.glb', { allowInheritedScale: true })[0].position[0]).toBeCloseTo(2.54);
    expect(() => discoverComponentAnchorDetails(root, 'assembly')).toThrow('must not contain scale');
    mount.scale.setScalar(0.001);
    expect(() => discoverComponentAnchorDetails(root, 'scaled.glb', { allowInheritedScale: true })).toThrow('must not contain scale');
  });

  it('does not promote invalid legacy candidates or reject ordinary scaled empties', () => {
    const root = new Group();
    const scaled = new Group();
    scaled.name = 'AB_CD_01';
    scaled.scale.setScalar(0.001);
    const invalid = new Group();
    invalid.name = 'AB_CD_02';
    invalid.position.x = Number.NaN;
    root.add(scaled, invalid);
    expect(promoteLegacyNamedAnchors(root, { allowInheritedScale: true })).toBe(0);
    expect(discoverComponentAnchorDetails(root, 'ordinary.glb')).toEqual([]);
    expect(scaled.userData).toEqual({});
    expect(invalid.userData).toEqual({});
  });

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

  it('promotes only legacy engineering locator leaves into versioned Anchors', () => {
    const root = new Group();
    const locator = new Group();
    locator.name = 'PB_LT_01';
    locator.userData = { source: 'legacy' };
    const ordinaryLeaf = new Group();
    ordinaryLeaf.name = 'Wheel mount';
    const hierarchy = new Group();
    hierarchy.name = 'PB_RT_02';
    hierarchy.add(ordinaryLeaf);
    const mesh = new Mesh();
    mesh.name = 'LV_MP_03';
    root.add(locator, hierarchy, mesh);

    expect(promoteLegacyNamedAnchors(root)).toBe(1);
    expect(locator.userData).toEqual({ source: 'legacy', kea3d: { anchor: { version: 1, id: 'PB_LT_01' } } });
    expect(discoverComponentAnchorDetails(root, 'legacy.glb')).toHaveLength(1);
    expect(isAnchorObject(hierarchy)).toBe(false);
    expect(isAnchorObject(mesh)).toBe(false);
  });
});
