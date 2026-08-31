import type { LoadProgress } from './types';
import { loadCancelledError, throwIfLoadCancelled } from './loadControl';

const preloadedFileBuffers = new WeakMap<File, ArrayBuffer>();

export function registerPreloadedFileBuffer(file: File, buffer: ArrayBuffer): void {
  preloadedFileBuffers.set(file, buffer);
}

export function fileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function readFileBuffer(
  file: File,
  onProgress: (progress: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const preloaded = preloadedFileBuffers.get(file);
  if (preloaded) {
    preloadedFileBuffers.delete(file);
    try {
      throwIfLoadCancelled(signal);
      onProgress({ stage: 'reading', value: 1 });
      return Promise.resolve(preloaded);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return new Promise((resolve, reject) => {
    try {
      throwIfLoadCancelled(signal);
    } catch (error) {
      reject(error);
      return;
    }
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => reader.abort();
    signal?.addEventListener('abort', abort, { once: true });
    reader.onerror = () => { cleanup(); reject(reader.error ?? new Error('The file could not be read.')); };
    reader.onabort = () => { cleanup(); reject(loadCancelledError()); };
    reader.onprogress = (event) => {
      onProgress({
        stage: 'reading',
        value: event.lengthComputable ? event.loaded / event.total : undefined,
      });
    };
    reader.onload = () => {
      cleanup();
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('The browser returned an unexpected file result.'));
    };
    reader.readAsArrayBuffer(file);
  });
}
