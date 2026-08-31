import { describe, expect, it } from 'vitest';
import { sanitizeCadImportResult } from './cadResult';

const triangle = {
  name: 'Valid body',
  attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } },
  index: { array: [0, 1, 2] },
};

describe('sanitizeCadImportResult', () => {
  it('drops empty CAD bodies and remaps assembly mesh indices', () => {
    const result = sanitizeCadImportResult({
      success: true,
      meshes: [
        { name: 'Empty body', attributes: { position: { array: [] } }, index: { array: [] } },
        triangle,
      ],
      root: {
        name: 'Assembly',
        meshes: [0],
        children: [{ name: 'Part', meshes: [1], children: [] }],
      },
    });

    expect(result.meshes).toEqual([triangle]);
    expect(result.root.meshes).toEqual([]);
    expect(result.root.children[0]?.meshes).toEqual([0]);
  });

  it('rejects a CAD result with no renderable bodies', () => {
    expect(() => sanitizeCadImportResult({
      success: true,
      meshes: [{ name: 'Empty body', attributes: { position: { array: [] } }, index: { array: [] } }],
      root: { name: 'Assembly', meshes: [0], children: [] },
    })).toThrow('does not contain renderable');
  });
});
