import { describe, expect, it } from 'vitest';
import {
  cadCacheKeysToEvict,
  cadCacheMaxEntries,
  cadCacheMaxTrackedSourceBytes,
  cadCacheNamespace,
  createCadCacheKey,
  getCadCacheStats,
  isValidCadImportResult,
} from './cadCache';

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

  it('invalidates a cached tessellation when source bytes or format change', async () => {
    const original = new TextEncoder().encode('ISO-10303-21;\nEND-ISO-10303-21;').buffer;
    const changed = new TextEncoder().encode('ISO-10303-21;\nEND-ISO-10303-21;\n').buffer;

    const originalKey = await createCadCacheKey(original, 'step');
    const changedKey = await createCadCacheKey(changed, 'step');
    const otherFormatKey = await createCadCacheKey(original, 'iges');

    expect(originalKey).toMatch(new RegExp(`^${cadCacheNamespace}:step:[0-9a-f]{64}$`));
    expect(changedKey).not.toBe(originalKey);
    expect(otherFormatKey).not.toBe(originalKey);
  });

  it('evicts least-recently-used entries by count and tracked source size', () => {
    const countLimited = Array.from({ length: cadCacheMaxEntries + 1 }, (_, index) => ({
      key: `entry-${index}`,
      sourceBytes: 1,
      lastAccessedAt: index,
    }));
    expect(cadCacheKeysToEvict(countLimited)).toEqual(['entry-0']);

    const sizeLimited = [
      { key: 'old', sourceBytes: cadCacheMaxTrackedSourceBytes * 0.7, lastAccessedAt: 1 },
      { key: 'new', sourceBytes: cadCacheMaxTrackedSourceBytes * 0.7, lastAccessedAt: 2 },
    ];
    expect(cadCacheKeysToEvict(sizeLimited)).toEqual(['old']);
  });
});
