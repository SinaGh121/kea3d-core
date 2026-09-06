import { describe, expect, it } from 'vitest';
import { createArchiveEntryFilter, isSafeArchivePath, maxArchiveEntries, maxArchiveEntryBytes } from './archiveSafety';

describe('archive safety', () => {
  it('accepts normal relative archive paths', () => {
    expect(isSafeArchivePath('3D/3dmodel.model')).toBe(true);
    expect(isSafeArchivePath('Metadata/thumbnail.png')).toBe(true);
  });

  it('rejects absolute, traversing, and backslash paths', () => {
    expect(isSafeArchivePath('/3D/model.model')).toBe(false);
    expect(isSafeArchivePath('../3D/model.model')).toBe(false);
    expect(isSafeArchivePath('3D\\model.model')).toBe(false);
  });

  it('rejects duplicate paths without extracting either collision', () => {
    const filter = createArchiveEntryFilter();
    expect(filter({ name: '3D/model.model', size: 10, originalSize: 20 })).toBe(true);
    expect(() => filter({ name: '3d/MODEL.model', size: 10, originalSize: 20 })).toThrow('colliding');
  });

  it('enforces entry and size limits', () => {
    const filter = createArchiveEntryFilter();
    for (let index = 0; index < maxArchiveEntries; index += 1) {
      expect(filter({ name: `3D/item-${index}.bin`, size: 1, originalSize: 1 })).toBe(true);
    }
    expect(() => filter({ name: '3D/overflow.bin', size: 1, originalSize: 1 })).toThrow('more than');
    expect(() => createArchiveEntryFilter()({ name: '3D/large.bin', size: 1, originalSize: maxArchiveEntryBytes + 1 })).toThrow('too large');
  });

  it('rejects extreme compression ratios', () => {
    expect(() => createArchiveEntryFilter()({ name: '3D/bomb.bin', size: 1, originalSize: 1_001 })).toThrow('compression ratio');
  });
});
