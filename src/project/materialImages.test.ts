import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, PlaneGeometry, Texture } from 'three';
import { applyMaterialImages, imageDimensions } from './materialImages';
import { encodeKea3dPackage, decodeKea3dPackage } from './projectPackage';
import { parseKea3dProjectJson, projectResourceIds, removeProjectResources, serializeKea3dProject } from './projectFormat';

const manifest = () => ({ $schema: 'https://kea3d.com/schemas/project/v2.json', format: 'kea3d-project', version: 2, name: 'Labels', rootInstance: 'part',
  resources: [{ id: 'model', uri: 'model.glb' }, { id: 'front', uri: 'front.png' }, { id: 'back', uri: 'back.jpg' }],
  instances: [{ id: 'part', resource: 'model', materialImages: [{ material: 'Front', image: 'front' }, { material: 'Back', image: 'back' }] }],
});

describe('project material images', () => {
  it('packs image resources and preserves the material mapping', async () => {
    const document = parseKea3dProjectJson(JSON.stringify(manifest()));
    const resourceFiles = new Map(document.resources.map(r => [r.id, new File(['fixture'], r.uri)]));
    const bytes = await encodeKea3dPackage({ document, manifestFile: new File([JSON.stringify(document)], 'test.kea3d'), resourceFiles });
    const decoded = decodeKea3dPackage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(decoded.document).toEqual(document);
    expect(decoded.resourceFiles.size).toBe(3);
    expect(decoded.resourceFiles.get('front')?.type).toBe('image/png');
  });
  it('rejects non-image content before browser decoding', () => {
    expect(() => imageDimensions(new ArrayBuffer(20))).toThrow('PNG');
  });
  it('validates and round trips image references and removes optional overrides', () => {
    const project = parseKea3dProjectJson(JSON.stringify(manifest()));
    expect([...projectResourceIds(project)]).toEqual(['model', 'front', 'back']);
    expect(parseKea3dProjectJson(serializeKea3dProject(project))).toEqual(project);
    expect(removeProjectResources(project, new Set(['front'])).instances[0].materialImages).toHaveLength(1);
    const invalid = manifest(); invalid.instances[0].materialImages[0].image = 'missing';
    expect(() => parseKea3dProjectJson(JSON.stringify(invalid))).toThrow('PNG or JPEG');
    expect(() => parseKea3dProjectJson(JSON.stringify({ ...manifest(), version: 1 }))).toThrow();
    invalid.resources[1].uri = '../front.png';
    expect(() => parseKea3dProjectJson(JSON.stringify(invalid))).toThrow('unsafe');
  });
  it('assigns two independent images without altering shared instance materials', () => {
    const root = new Group();
    const front = new MeshStandardMaterial(); front.name = 'Front'; front.map = new Texture();
    const back = front.clone(); back.name = 'Back';
    const a = new Mesh(new PlaneGeometry(), front), b = new Mesh(new PlaneGeometry(), back);
    root.add(a, b);
    const untouched = a.clone();
    const images = new Map([['front', new Texture()], ['back', new Texture()]]);
    applyMaterialImages(root, manifest().instances[0], images);
    expect(a.material).not.toBe(front);
    expect(untouched.material).toBe(front);
    expect(a.material.map?.source).toBe(images.get('front')?.source);
    expect(b.material.map?.source).toBe(images.get('back')?.source);
    expect(front.map).not.toBe(a.material.map);
  });
  it('rejects missing targets and UVs before applying any replacements', () => {
    const root = new Group(); const material = new MeshStandardMaterial(); material.name = 'Front';
    const mesh = new Mesh(new PlaneGeometry(), material); root.add(mesh);
    const images = new Map([['front', new Texture()], ['back', new Texture()]]);
    expect(() => applyMaterialImages(root, manifest().instances[0], images)).toThrow('missing or ambiguous');
    expect(mesh.material).toBe(material);
    mesh.geometry.deleteAttribute('uv');
    expect(() => applyMaterialImages(root, manifest().instances[0], images)).toThrow('UV');
  });
});
