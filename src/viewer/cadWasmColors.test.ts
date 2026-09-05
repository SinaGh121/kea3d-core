/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import createPatched from '@kea3d/cad-wasm';
import createOriginal from 'occt-import-js';
import type { CadImportResult } from './cadTypes';
import { buildCadScene } from './loadCadFile';
import { Mesh, type MeshStandardMaterial } from 'three';
import { disposeObject3D } from './disposeObject';
import { cadCacheNamespace } from './cadCache';

describe('CAD WebAssembly inherited surface colors', () => {
  it('ships the exact recorded compiler outputs', () => {
    const root = new URL('../../vendor/cad-wasm/', import.meta.url);
    const metadata = JSON.parse(readFileSync(new URL('build.json', root), 'utf8').replace(/^\uFEFF/, ''));
    for (const [filename, digest] of [['occt-import-js.js', metadata.JavaScriptSha256], ['occt-import-js.wasm', metadata.WasmSha256]]) {
      const bytes = readFileSync(new URL(`dist/${filename}`, root));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
    }
  });
  it('preserves shell colors, face overrides, uncolored bodies, and exact geometry', async () => {
    const bytes = readFileSync(new URL('../../tests/fixtures/cad-inherited-colors.step', import.meta.url));
    const [patched, original] = await Promise.all([createPatched(), createOriginal()]);
    const result = patched.ReadFile('step', bytes, null) as CadImportResult;
    const baseline = original.ReadFile('step', bytes, null) as CadImportResult;
    expect(result.success).toBe(true);
    expect(result.meshes).toHaveLength(2);
    expect(result.root).toEqual(baseline.root);
    for (const [index, mesh] of result.meshes.entries()) {
      expect(mesh.attributes).toEqual(baseline.meshes[index].attributes);
      expect(mesh.index).toEqual(baseline.meshes[index].index);
      expect(mesh.brep_faces?.map(({ first, last }) => [first, last]))
        .toEqual(baseline.meshes[index].brep_faces?.map(({ first, last }) => [first, last]));
    }
    const colored = result.meshes.find((mesh) => mesh.name === 'BodyShellFace')!;
    expect(colored.brep_faces?.filter((face) => face.color?.join(',') === '1,0,0')).toHaveLength(5);
    expect(colored.brep_faces?.filter((face) => face.color?.join(',') === '0,1,0')).toHaveLength(1);
    const plain = result.meshes.find((mesh) => mesh.name === 'Uncolored')!;
    expect(plain.color).toBeUndefined();
    expect(plain.brep_faces?.every((face) => face.color === null)).toBe(true);
    const scene = buildCadScene(result, 'Color fixture');
    let mesh: Mesh | undefined;
    scene.traverse((object) => { if (object instanceof Mesh && object.name === 'BodyShellFace') mesh = object; });
    expect(mesh).toBeDefined();
    const colors = (mesh!.material as MeshStandardMaterial[]).map((material) => material.color.toArray().join(','));
    expect(colors).toContain('1,0,0');
    expect(colors).toContain('0,1,0');
    disposeObject3D(scene);
  }, 30_000);

  it('does not reuse tessellations produced by the old color resolver', () => {
    expect(cadCacheNamespace).toContain('occt-0.0.23-kea3d.1');
  });
});
