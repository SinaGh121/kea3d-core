import { describe, expect, it } from 'vitest';
import {
  acceptProjectResourceChanges,
  KEA3D_PROJECT_SCHEMA,
  decodeKea3dProject,
  normalizeProjectResourceUri,
  parseKea3dProjectJson,
  ProjectResourceRecoveryError,
  removeProjectResources,
  resolveProjectResourceFile,
  resolveProjectResourceFiles,
  rootProjectResource,
  serializeKea3dProject,
  type Kea3dProjectDocument,
} from './projectFormat';

function project(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: KEA3D_PROJECT_SCHEMA,
    format: 'kea3d-project',
    version: 1,
    name: 'Robot',
    rootInstance: 'chassis',
    resources: [{ id: 'chassis-model', uri: 'components/chassis.glb' }],
    instances: [{ id: 'chassis', resource: 'chassis-model' }],
    ...overrides,
  };
}

function file(name: string, webkitRelativePath = ''): File {
  return { name, webkitRelativePath } as File;
}

describe('Kea3D project format v1', () => {
  it('parses the canonical root-resource project and preserves optional data', () => {
    const parsed = parseKea3dProjectJson(JSON.stringify(project({ metadata: { customer: 'Example' } })));
    expect(parsed.name).toBe('Robot');
    expect(rootProjectResource(parsed).uri).toBe('components/chassis.glb');
    expect(parsed.metadata).toEqual({ customer: 'Example' });
  });

  it('validates and normalizes optional resource integrity metadata', () => {
    const parsed = parseKea3dProjectJson(JSON.stringify(project({
      resources: [{
        id: 'chassis-model',
        uri: 'components/chassis.glb',
        integrity: { byteLength: 42, sha256: 'A'.repeat(64) },
      }],
    })));
    expect(parsed.resources[0].integrity).toEqual({ byteLength: 42, sha256: 'a'.repeat(64) });
    expect(() => parseKea3dProjectJson(JSON.stringify(project({
      resources: [{ id: 'chassis-model', uri: 'components/chassis.glb', integrity: { sha256: 'bad' } }],
    })))).toThrow('64-character hexadecimal digest');
  });

  it('decodes a UTF-8 manifest with a byte-order mark', () => {
    const bytes = new TextEncoder().encode(`\uFEFF${JSON.stringify(project())}`);
    expect(decodeKea3dProject(bytes.buffer).version).toBe(1);
  });

  it('serializes a validated project deterministically and round trips optional data', () => {
    const parsed = parseKea3dProjectJson(JSON.stringify(project({ metadata: { revision: 4 } }))) as Kea3dProjectDocument;
    const serialized = serializeKea3dProject(parsed);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(parseKea3dProjectJson(serialized)).toEqual(parsed);
    expect(serializeKea3dProject(parseKea3dProjectJson(serialized))).toBe(serialized);
  });

  it.each([
    '../chassis.glb',
    './chassis.glb',
    '/chassis.glb',
    'C:/parts/chassis.glb',
    'https://example.com/chassis.glb',
    'components\\chassis.glb',
    'components//chassis.glb',
    'components/%2e%2e/chassis.glb',
    'components/🚕.glb',
    'components/chassis.gltf',
  ])('rejects unsafe or unsupported resource URI %s', (uri) => {
    expect(() => normalizeProjectResourceUri(uri)).toThrow('Invalid Kea3D project');
  });

  it('rejects ambiguous case-only resource paths', () => {
    expect(() => parseKea3dProjectJson(JSON.stringify(project({
      resources: [
        { id: 'first', uri: 'parts/Wheel.glb' },
        { id: 'second', uri: 'parts/wheel.glb' },
      ],
    })))).toThrow('collides with another resource path');
  });

  it('rejects dangling resources and attachment cycles before loading geometry', () => {
    expect(() => parseKea3dProjectJson(JSON.stringify(project({
      instances: [{ id: 'chassis', resource: 'missing-model' }],
    })))).toThrow('references missing resource');

    expect(() => parseKea3dProjectJson(JSON.stringify(project({
      rootInstance: 'root',
      instances: [
        { id: 'root', resource: 'chassis-model' },
        { id: 'left', resource: 'chassis-model', attachment: { sourceAnchor: 'base', targetInstance: 'right', targetAnchor: 'mount' } },
        { id: 'right', resource: 'chassis-model', attachment: { sourceAnchor: 'base', targetInstance: 'left', targetAnchor: 'mount' } },
      ],
    })))).toThrow('attachment cycle');
  });

  it('resolves an exact project-relative file before basename fallback', () => {
    const parsed = parseKea3dProjectJson(JSON.stringify(project())) as Kea3dProjectDocument;
    const manifest = file('robot.kea3d', 'robot/robot.kea3d');
    const exact = file('chassis.glb', 'robot/components/chassis.glb');
    const other = file('chassis.glb', 'archive/chassis.glb');
    expect(resolveProjectResourceFile(parsed, manifest, [manifest, other, exact])).toBe(exact);
  });

  it('supports a unique basename selection and explains missing recovery', () => {
    const parsed = parseKea3dProjectJson(JSON.stringify(project())) as Kea3dProjectDocument;
    const manifest = file('robot.kea3d');
    const component = file('chassis.glb');
    expect(resolveProjectResourceFile(parsed, manifest, [manifest, component])).toBe(component);
    expect(() => resolveProjectResourceFile(parsed, manifest, [manifest])).toThrow('Choose the .kea3d project and its referenced GLB together');
  });

  it('reports every missing referenced resource in one recovery error', () => {
    const parsed = parseKea3dProjectJson(JSON.stringify(project({
      resources: [
        { id: 'chassis-model', uri: 'components/chassis.glb' },
        { id: 'wheel-model', uri: 'components/wheel.glb' },
      ],
      instances: [
        { id: 'chassis', resource: 'chassis-model' },
        { id: 'wheel', resource: 'wheel-model', attachment: { sourceAnchor: 'base', targetInstance: 'chassis', targetAnchor: 'mount' } },
      ],
    }))) as Kea3dProjectDocument;
    try {
      resolveProjectResourceFiles(parsed, file('robot.kea3d'), []);
      throw new Error('Expected recovery error');
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectResourceRecoveryError);
      expect((error as ProjectResourceRecoveryError).issues).toHaveLength(2);
      expect((error as ProjectResourceRecoveryError).issues[0].requiredByRoot).toBe(true);
    }
  });

  it('accepts changed integrity or removes an unavailable optional subtree in memory', () => {
    const parsed = parseKea3dProjectJson(JSON.stringify(project({
      resources: [
        { id: 'chassis-model', uri: 'chassis.glb', integrity: { byteLength: 10 } },
        { id: 'wheel-model', uri: 'wheel.glb' },
      ],
      instances: [
        { id: 'chassis', resource: 'chassis-model' },
        { id: 'wheel', resource: 'wheel-model', attachment: { sourceAnchor: 'base', targetInstance: 'chassis', targetAnchor: 'mount' } },
        { id: 'cap', resource: 'chassis-model', attachment: { sourceAnchor: 'base', targetInstance: 'wheel', targetAnchor: 'cap' } },
      ],
    }))) as Kea3dProjectDocument;
    expect(acceptProjectResourceChanges(parsed, new Set(['chassis-model'])).resources[0].integrity).toBeUndefined();
    const reduced = removeProjectResources(parsed, new Set(['wheel-model']));
    expect(reduced.instances.map((instance) => instance.id)).toEqual(['chassis']);
    expect(reduced.resources.map((resource) => resource.id)).toEqual(['chassis-model']);
    expect(() => removeProjectResources(parsed, new Set(['chassis-model']))).toThrow('root project resource cannot be removed');
  });

  it('resolves each referenced resource once for multi-instance projects', () => {
    const parsed = parseKea3dProjectJson(JSON.stringify(project({
      resources: [
        { id: 'chassis-model', uri: 'components/chassis.glb' },
        { id: 'wheel-model', uri: 'components/wheel.glb' },
      ],
      instances: [
        { id: 'chassis', resource: 'chassis-model' },
        { id: 'wheel-left', resource: 'wheel-model', attachment: { sourceAnchor: 'wheel-base', targetInstance: 'chassis', targetAnchor: 'wheel-left' } },
        { id: 'wheel-right', resource: 'wheel-model', attachment: { sourceAnchor: 'wheel-base', targetInstance: 'chassis', targetAnchor: 'wheel-right' } },
      ],
    }))) as Kea3dProjectDocument;
    const manifest = file('robot.kea3d');
    const chassis = file('chassis.glb');
    const wheel = file('wheel.glb');
    const resolved = resolveProjectResourceFiles(parsed, manifest, [manifest, chassis, wheel]);
    expect([...resolved]).toEqual([
      ['chassis-model', chassis],
      ['wheel-model', wheel],
    ]);
  });
});
