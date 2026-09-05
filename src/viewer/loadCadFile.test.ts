import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import { buildCadScene } from './loadCadFile';
import type { CadImportResult } from './cadTypes';

describe('buildCadScene', () => {
  it('builds hierarchy and deduplicates repeated CAD face colors', () => {
    const result: CadImportResult = {
      success: true,
      root: { name: '', meshes: [], children: [{ name: 'Part', meshes: [0], children: [] }] },
      meshes: [{
        name: 'Body',
        color: [0.8, 0.8, 0.8],
        brep_faces: [
          { first: 0, last: 0, color: [1, 0, 0] },
          { first: 1, last: 1, color: [1, 0, 0] },
        ],
        attributes: {
          position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] },
          normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] },
        },
        index: { array: [0, 1, 2, 3, 4, 5] },
      }],
    };

    const scene = buildCadScene(result, 'fallback');
    const mesh = scene.getObjectByName('Body');

    expect(scene.name).toBe('fallback');
    expect(mesh).toBeInstanceOf(Mesh);
    expect(Array.isArray((mesh as Mesh).material)).toBe(true);
    expect(((mesh as Mesh).material as unknown[])).toHaveLength(2);
    expect((mesh as Mesh).geometry.groups.map((group) => group.materialIndex)).toEqual([1, 1]);
  });
});
