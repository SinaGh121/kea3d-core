import { describe, expect, it } from 'vitest';
import { Group, Vector3 } from 'three';
import { applyAssemblyJoint, assemblyObjectForInstance, assemblyInstanceForObject, buildFixedAssemblyScene } from './assemblyScene';
import { KEA3D_PROJECT_SCHEMA_V2, parseKea3dProjectJson, type Kea3dJoint } from './projectFormat';

const joint: Kea3dJoint = { id: 'slide', type: 'prismatic', axis: 'x', limits: { min: -0.07, max: 0.05 }, state: { position: 0.05 } };
const manifest = () => ({ $schema: KEA3D_PROJECT_SCHEMA_V2, version: 2, format: 'kea3d-project', name: 'Motion', rootInstance: 'base', resources: [{ id: 'part', uri: 'part.glb' }], instances: [{ id: 'base', resource: 'part' }, { id: 'child', resource: 'part', attachment: { targetInstance: 'base', targetAnchor: 'mount', joint } }] });

describe('Joint projects', () => {
  it('selects the bound part when a source anchor has the same name', () => {
    const prototype = new Group();
    const anchor = new Group();
    anchor.name = 'child';
    anchor.userData = { kea3d: { anchor: { id: 'mount', version: 1 } } };
    prototype.add(anchor);
    const root = buildFixedAssemblyScene(parseKea3dProjectJson(JSON.stringify(manifest())), new Map([['part', prototype]]));
    expect(assemblyInstanceForObject(root.getObjectByName('child'))).toBeUndefined();
    const part = assemblyObjectForInstance(root, 'child')!;
    expect(assemblyInstanceForObject(part)).toBe('child');
    applyAssemblyJoint(root, 'child', { ...joint, state: { position: -0.07 } });
    expect(part.position.x).toBeCloseTo(-0.07);
  });
  it('round trips optional child origins and rejects invalid limits', () => {
    const parsed = parseKea3dProjectJson(JSON.stringify(manifest()));
    expect(parsed.instances[1].attachment?.sourceAnchor).toBeUndefined();
    expect(parsed.instances[1].attachment?.joint).toEqual(joint);
    const bad = manifest();
    bad.instances[1].attachment!.joint = { ...joint, state: { position: 1 } };
    expect(() => parseKea3dProjectJson(JSON.stringify(bad))).toThrow();
    expect(() => parseKea3dProjectJson(JSON.stringify({ ...manifest(), version: 1 }))).toThrow();
    const duplicate = manifest();
    duplicate.instances.push({ ...duplicate.instances[1], id: 'other' });
    expect(() => parseKea3dProjectJson(JSON.stringify(duplicate))).toThrow();
  });

  it('uses parent Anchor axes and absolute state without altering resources', () => {
    const prototype = new Group();
    const anchor = new Group();
    anchor.name = 'mount';
    anchor.userData = { kea3d: { anchor: { id: 'mount', version: 1 } } };
    anchor.position.set(2, 0, 0);
    anchor.rotation.z = Math.PI / 2;
    prototype.add(anchor);
    const root = buildFixedAssemblyScene(parseKea3dProjectJson(JSON.stringify(manifest())), new Map([['part', prototype]]));
    const child = root.getObjectByName('child')!;
    expect(child.position.x).toBeCloseTo(2);
    expect(child.position.y).toBeCloseTo(0.05);
    applyAssemblyJoint(root, 'child', joint);
    expect(child.position.y).toBeCloseTo(0.05);
    applyAssemblyJoint(root, 'child');
    expect(child.position.y).toBeCloseTo(0);
    applyAssemblyJoint(root, 'child', { ...joint, type: 'revolute', limits: { min: -1, max: 1 }, state: { position: 0.2 } });
    expect(child.position.distanceTo(new Vector3(2, 0, 0))).toBeCloseTo(0);
    expect(prototype.position.length()).toBe(0);
    expect(anchor.rotation.z).toBeCloseTo(Math.PI / 2);
    const explicit = parseKea3dProjectJson(JSON.stringify(manifest()));
    explicit.instances[1].attachment!.sourceAnchor = 'missing';
    expect(() => buildFixedAssemblyScene(explicit, new Map([['part', prototype]]))).toThrow('missing anchor');
  });
});
