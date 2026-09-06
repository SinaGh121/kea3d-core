import { describe, expect, it, vi } from 'vitest';
import { readFileBuffer, registerPreloadedFileBuffer } from './localFile';

describe('local file buffers', () => {
  it('reuses a native preloaded buffer without a second FileReader copy', async () => {
    const file = new File([new Uint8Array([9])], 'model.glb');
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    const onProgress = vi.fn();
    registerPreloadedFileBuffer(file, buffer);

    await expect(readFileBuffer(file, onProgress)).resolves.toBe(buffer);
    expect(onProgress).toHaveBeenCalledWith({ stage: 'reading', value: 1 });
  });
});
