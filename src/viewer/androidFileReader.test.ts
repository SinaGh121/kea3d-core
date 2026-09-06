import { describe, expect, it, vi } from 'vitest';
import { readAndroidContentUri, type AndroidNativeFileBridge } from './androidFileReader';

function bridge() {
  return { postMessage: vi.fn<(message: string) => void>(), onmessage: null as AndroidNativeFileBridge['onmessage'] };
}

describe('Android content reader', () => {
  it.each([0, 3])('assembles chunks with expected size %i and cleans up', async size => {
    const native = bridge();
    const progress = vi.fn();
    const result = readAndroidContentUri(native, 'content://test', size, progress);
    native.onmessage!({ data: new Uint8Array([1, 2]).buffer });
    native.onmessage!({ data: new Uint8Array([3]).buffer });
    native.onmessage!({ data: 'done' });
    expect(new Uint8Array(await result)).toEqual(new Uint8Array([1, 2, 3]));
    expect(native.onmessage).toBeNull();
    if (size) expect(progress).toHaveBeenLastCalledWith(1);
  });

  it('does not start an already cancelled read', async () => {
    const native = bridge();
    const controller = new AbortController();
    controller.abort();
    await expect(readAndroidContentUri(native, 'content://test', 1, vi.fn(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.postMessage).not.toHaveBeenCalled();
  });

  it('cancels once, ignores late callbacks and permits a new read', async () => {
    const native = bridge();
    const controller = new AbortController();
    const result = readAndroidContentUri(native, 'content://first', 10, vi.fn(), controller.signal);
    const late = native.onmessage!;
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.onmessage).toBeNull();
    const next = readAndroidContentUri(native, 'content://second', 1, vi.fn());
    const current = native.onmessage;
    late({ data: new Uint8Array([9]).buffer });
    late({ data: 'done' });
    expect(native.onmessage).toBe(current);
    current!({ data: new Uint8Array([5]).buffer });
    current!({ data: 'done' });
    expect(new Uint8Array(await next)).toEqual(new Uint8Array([5]));
    expect(native.postMessage.mock.calls.filter(([text]) => JSON.parse(text).action === 'cancel')).toHaveLength(1);
  });

  it.each(['short', 'oversize', 'provider'])('rejects %s data and detaches callbacks', async mode => {
    const native = bridge();
    const result = readAndroidContentUri(native, 'content://test', 1, vi.fn());
    native.onmessage!({ data: mode === 'short' ? 'done' : mode === 'provider' ? 'error:Provider failed' : new Uint8Array(2).buffer });
    await expect(result).rejects.toThrow();
    expect(native.onmessage).toBeNull();
  });

  it('settles and detaches even when the bridge throws', async () => {
    const native = bridge();
    native.postMessage.mockImplementation(() => { throw new Error('disconnected'); });
    await expect(readAndroidContentUri(native, 'content://test', 1, vi.fn())).rejects.toThrow('disconnected');
    expect(native.onmessage).toBeNull();
  });
});
