import { loadCancelledError, throwIfLoadCancelled } from './loadControl';

export interface AndroidNativeFileBridge {
  postMessage(message: string): void;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null;
}

export function readAndroidContentUri(
  bridge: AndroidNativeFileBridge,
  uri: string,
  expectedSize: number,
  onProgress: (value: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    throwIfLoadCancelled(signal);
    const bytes = expectedSize > 0 ? new Uint8Array(expectedSize) : null;
    const chunks: Uint8Array[] = [];
    let offset = 0;
    let settled = false;
    const abort = () => finish(loadCancelledError());
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      bridge.onmessage = null;
      if (error) {
        // A failed bridge must not hide cancellation or leave this Promise pending.
        try { bridge.postMessage(JSON.stringify({ action: 'cancel' })); } catch { /* Already disconnected. */ }
        chunks.length = 0;
        reject(error);
        return;
      }
      if (bytes) {
        if (offset !== bytes.byteLength) reject(new Error(`The file provider returned ${offset} bytes instead of ${bytes.byteLength}.`));
        else resolve(bytes.buffer);
        return;
      }
      const combined = new Uint8Array(offset);
      let chunkOffset = 0;
      for (const chunk of chunks) { combined.set(chunk, chunkOffset); chunkOffset += chunk.byteLength; }
      chunks.length = 0;
      resolve(combined.buffer);
    };
    signal?.addEventListener('abort', abort, { once: true });
    bridge.onmessage = ({ data }) => {
      if (settled) return;
      try {
        if (typeof data === 'string') {
          if (data === 'done') finish();
          else if (data.startsWith('error:')) finish(new Error(data.slice(6)));
          return;
        }
        const chunk = new Uint8Array(data);
        if (bytes) {
          if (offset + chunk.byteLength > bytes.byteLength) throw new Error('The file provider returned more data than expected.');
          bytes.set(chunk, offset);
        } else chunks.push(chunk);
        offset += chunk.byteLength;
        if (expectedSize > 0) onProgress(offset / expectedSize);
        if (!settled) bridge.postMessage(JSON.stringify({ action: 'next' }));
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    };
    try { bridge.postMessage(JSON.stringify({ action: 'open', uri, expectedSize })); }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
