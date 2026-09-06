import { describe, expect, it } from 'vitest';
import { cadCacheNamespace, getCadCacheStats, isValidCadImportResult } from './cadCache';

const validResult = {
  success: true,
  root: { name: 'Assembly', meshes: [0], children: [] },
  meshes: [{ name: 'Body', attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } }, index: { array: [0, 1, 2] } }],
};

describe('CAD cache validation', () => {
  it('uses a versioned Kea3D parser namespace', () => {
    expect(cadCacheNamespace).toContain('kea3d-cad-');
    expect(cadCacheNamespace).toContain('occt-0.0.23');
  });

  it('accepts valid tessellation results and rejects invalid indices', () => {
    expect(isValidCadImportResult(validResult)).toBe(true);
    expect(isValidCadImportResult({ ...validResult, meshes: [{ ...validResult.meshes[0], index: { array: [0, 1, 3] } }] })).toBe(false);
    expect(isValidCadImportResult({ ...validResult, meshes: [{ ...validResult.meshes[0], attributes: { position: { array: [] } }, index: { array: [] } }] })).toBe(false);
  });

  it('reports an empty cache when browser storage is unavailable', async () => {
    await expect(getCadCacheStats()).resolves.toEqual({ entries: 0, sourceBytes: 0 });
  });
});
