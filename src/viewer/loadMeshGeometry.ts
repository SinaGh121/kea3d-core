import { BufferAttribute, BufferGeometry } from 'three';
import { loadCancelledError } from './loadControl';
import type { GeometryArray, MeshGeometryWorkerResponse, SerializedGeometryAttribute } from './meshGeometryWorkerTypes';

function restoreAttribute(attribute: SerializedGeometryAttribute): BufferAttribute {
  return new BufferAttribute(attribute.array as GeometryArray, attribute.itemSize, attribute.normalized);
}

export function parseMeshGeometryInWorker(
  buffer: ArrayBuffer,
  extension: 'ply' | 'stl',
  signal?: AbortSignal,
): Promise<{ geometry: BufferGeometry; alpha: number; hasColors: boolean }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./meshGeometryWorker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', handleAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const handleAbort = () => finish(() => reject(signal?.reason instanceof Error ? signal.reason : loadCancelledError()));

    signal?.addEventListener('abort', handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }

    worker.onmessage = (event: MessageEvent<MeshGeometryWorkerResponse>) => {
      finish(() => {
        if (!event.data.ok) {
          reject(new Error(event.data.error));
          return;
        }
        const geometry = new BufferGeometry();
        Object.entries(event.data.geometry.attributes).forEach(([name, attribute]) => {
          geometry.setAttribute(name, restoreAttribute(attribute));
        });
        if (event.data.geometry.index) geometry.setIndex(restoreAttribute(event.data.geometry.index));
        resolve({
          geometry,
          alpha: event.data.geometry.alpha,
          hasColors: event.data.geometry.hasColors,
        });
      });
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message || 'The mesh decoder worker failed.')));
    worker.onmessageerror = () => finish(() => reject(new Error('The mesh decoder returned unreadable data.')));
    worker.postMessage({ buffer, extension }, [buffer]);
  });
}
