import { describe, expect, it } from 'vitest';
import { createLocalFileResolver } from './localFileManager';

function file(name: string, webkitRelativePath = ''): File {
  return { name, webkitRelativePath } as File;
}

describe('local companion-file resolver', () => {
  it('prefers an exact selected relative path', () => {
    const redTexture = file('paint.png', 'materials/red/paint.png');
    const blueTexture = file('paint.png', 'materials/blue/paint.png');
    const resolve = createLocalFileResolver([redTexture, blueTexture]);
    expect(resolve('materials/blue/paint.png')).toBe(blueTexture);
  });

  it('rejects an ambiguous short companion name', () => {
    const resolve = createLocalFileResolver([
      file('paint.png', 'materials/red/paint.png'),
      file('paint.png', 'materials/blue/paint.png'),
    ]);
    expect(() => resolve('paint.png')).toThrow('More than one selected companion file');
  });

  it('normalizes slashes and encoded paths for exact matches', () => {
    const texture = file('paint red.png', 'materials/paint red.png');
    const resolve = createLocalFileResolver([texture]);
    expect(resolve('materials\\paint%20red.png')).toBe(texture);
  });
});
