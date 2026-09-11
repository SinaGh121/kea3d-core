import { expect, test } from '@playwright/test';
import { zipSync } from 'fflate';

test('packaged image override loads with local PNG and UV coordinates', async ({ page }) => {
  const name = 'Label';
  const binary = Buffer.from(new Float32Array([-1,-1,0, 1,-1,0, 0,1,0, 0,0, 1,0, 0.5,1]).buffer);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ name, doubleSided: true }], buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1,-1,0], max: [1,1,0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
  };
  const text = JSON.stringify(json); const chunk = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4));
  const bytes = Buffer.alloc(28 + chunk.length + binary.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(chunk.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); chunk.copy(bytes, 20);
  bytes.writeUInt32LE(binary.length, 20 + chunk.length); bytes.writeUInt32LE(0x004e4942, 24 + chunk.length); binary.copy(bytes, 28 + chunk.length);
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFZkAAAAASUVORK5CYII=', 'base64');
  const project = { $schema: 'https://kea3d.com/schemas/project/v2.json', format: 'kea3d-project', version: 2,
    name: 'Image test', rootInstance: 'part', resources: [{ id: 'model', uri: 'model.glb' }, { id: 'image', uri: 'image.png' }],
    instances: [{ id: 'part', resource: 'model', materialImages: [{ material: name, image: 'image' }] }],
  };
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Images.kea3dp', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync({ 'project.kea3d': Buffer.from(JSON.stringify(project)), 'model.glb': bytes, 'image.png': image })) });
  await expect(page.getByRole('button', { name: /Open another model.*Images/ })).toBeVisible();
  expect(errors).toEqual([]);
});
