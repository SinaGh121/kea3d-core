import { describe, expect, it } from 'vitest';
import { createLocalFileResolver } from './localFileManager';

function file(name: string, webkitRelativePath = ''): File {
  return { name, webkitRelativePath } as File;
}

describe('local companion-file resolver', () => {
  it('preserves literal hash and percent characters while decoding URL paths once', () => {
    const main = file('model.gltf', 'product#1/models/model.gltf');
    const first = file('paint#1.png', 'product#1/textures/paint#1.png');
    const second = file('paint#2.png', 'product#1/textures/paint#2.png');
    const percent = file('paint%231.png', 'product#1/textures/paint%231.png');
    const resolve = createLocalFileResolver([main, first, second, percent], main);
    expect(resolve('../textures/paint%231.png?revision=2#preview')).toBe(first);
    expect(resolve('../textures/paint%232.png')).toBe(second);
    expect(resolve('../textures/paint%25231.png')).toBe(percent);
  });

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

  it('resolves nested GLTF companions relative to the main file', () => {
    const main = file('model.gltf', 'product/models/car/model.gltf');
    const texture = file('paint.png', 'product/textures/body/paint.png');
    const buffer = file('geometry.bin', 'product/models/shared/geometry.bin');
    const duplicateTexture = file('paint.png', 'product/variants/paint.png');
    const resolve = createLocalFileResolver([main, texture, buffer, duplicateTexture], main);

    expect(resolve('../../textures/body/paint.png?revision=2')).toBe(texture);
    expect(resolve('../shared/geometry.bin')).toBe(buffer);
  });

  it('does not replace external or embedded URLs with selected files', () => {
    const selected = file('texture.png', 'assets/texture.png');
    const resolve = createLocalFileResolver([selected]);

    expect(resolve('https://example.com/texture.png')).toBeUndefined();
    expect(resolve('data:image/png;base64,texture.png')).toBeUndefined();
    expect(resolve('/texture.png')).toBeUndefined();
  });
});
