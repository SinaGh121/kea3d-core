import { describe, expect, it } from 'vitest';
import {
  KEA3D_PROJECT_SCHEMA,
  decodeKea3dProject,
  normalizeProjectResourceUri,
  parseKea3dProjectJson,
  resolveProjectResourceFile,
  rootProjectResource,
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

  it('decodes a UTF-8 manifest with a byte-order mark', () => {
    const bytes = new TextEncoder().encode(`\uFEFF${JSON.stringify(project())}`);
    expect(decodeKea3dProject(bytes.buffer).version).toBe(1);
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

  it('keeps multi-instance projects valid but defers their scene loading clearly', () => {
    const parsed = parseKea3dProjectJson(JSON.stringify(project({
      instances: [
        { id: 'chassis', resource: 'chassis-model' },
        { id: 'wheel', resource: 'chassis-model', attachment: { sourceAnchor: 'wheel-base', targetInstance: 'chassis', targetAnchor: 'wheel-mount' } },
      ],
    }))) as Kea3dProjectDocument;
    expect(() => resolveProjectResourceFile(parsed, file('robot.kea3d'), [file('chassis.glb')])).toThrow('Multi-instance assembly loading is the next project milestone');
  });
});
