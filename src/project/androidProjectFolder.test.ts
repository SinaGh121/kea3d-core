import { afterEach, expect, it, vi } from 'vitest';
import { chooseAndroidProjectResources } from './androidProjectFolder';

afterEach(() => vi.unstubAllGlobals());

function bridges(result: unknown) {
  const folder = { onmessage: null as null | ((event: { data: string }) => void), postMessage: () => queueMicrotask(() => folder.onmessage?.({ data: JSON.stringify(result) })) };
  const reader = { onmessage: null as null | ((event: { data: string | ArrayBuffer }) => void), postMessage: vi.fn((message: string) => queueMicrotask(() => reader.onmessage?.({ data: JSON.parse(message).action === 'open' ? new Uint8Array([1, 2, 3]).buffer : 'done' }))) };
  vi.stubGlobal('window', { kea3dProjectFolder: folder, kea3dNativeFile: reader });
  return reader;
}

it('retains exact resource paths and reports only checked missing paths', async () => {
  bridges({ files: [{ path: 'components/rail.glb', uri: 'content://test/rail', size: 3 }] });
  const result = await chooseAndroidProjectResources(['components/rail.glb', 'components/carriage.glb']);
  expect(result?.missing).toEqual(['components/carriage.glb']);
  expect(result?.files[0].webkitRelativePath).toBe('components/rail.glb');
  expect(result?.files[0].size).toBe(3);
});

it('does not classify cancellation or permission denial as missing files', async () => {
  bridges({ cancelled: true });
  expect(await chooseAndroidProjectResources(['rail.glb'])).toBeNull();
  bridges({ error: 'Folder access was denied.' });
  await expect(chooseAndroidProjectResources(['rail.glb'])).rejects.toThrow('denied');
});

it.each([-1, 0, 300 * 1024 * 1024])('rejects unsafe resource size %i before reading', async size => {
  const reader = bridges({ files: [{ path: 'rail.glb', uri: 'content://test/rail', size }] });
  await expect(chooseAndroidProjectResources(['rail.glb'])).rejects.toThrow('safely');
  expect(reader.postMessage).not.toHaveBeenCalled();
});
