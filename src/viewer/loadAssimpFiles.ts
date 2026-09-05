import { LoadingManager, type WebGLRenderer } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createGltfLoader } from './createGltfLoader';
import { readFileBuffer } from './localFile';
import type { LoadProgress } from './types';
import { loadCancelledError, throwIfLoadCancelled } from './loadControl';

function convertWithAssimp(files: Array<{ name: string; buffer: ArrayBuffer }>, signal?: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    try {
      throwIfLoadCancelled(signal);
    } catch (error) {
      reject(error);
      return;
    }
    const worker = new Worker(new URL('./assimpWorker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(loadCancelledError());
    const succeed = (result: ArrayBuffer) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    worker.onerror = (event) => {
      fail(new Error(event.message || 'The compatibility worker failed.'));
    };
    worker.onmessageerror = () => fail(new Error('The compatibility worker returned unreadable data.'));
    worker.onmessage = (event: MessageEvent<{ glb?: ArrayBuffer; error?: string }>) => {
      if (event.data.error) fail(new Error(event.data.error));
      else if (event.data.glb) succeed(event.data.glb);
      else fail(new Error('The compatibility converter returned no model.'));
    };
    worker.postMessage({ files }, files.map((file) => file.buffer));
  });
}

export async function loadAssimpFiles(
  files: readonly File[],
  mainBuffer: ArrayBuffer,
  mainFile: File,
  onProgress: (progress: LoadProgress) => void,
  renderer: WebGLRenderer,
  signal?: AbortSignal,
): Promise<GLTF> {
  const buffers = await Promise.all(files.map(async (file) => ({
    name: file.webkitRelativePath || file.name,
    buffer: file === mainFile ? mainBuffer : await readFileBuffer(file, onProgress, signal),
  })));
  onProgress({ stage: 'decoding' });
  const glb = await convertWithAssimp(buffers, signal);
  const gltfLoader = createGltfLoader(new LoadingManager(), renderer);
  try {
    return await gltfLoader.loader.parseAsync(glb, '');
  } finally {
    gltfLoader.dispose();
  }
}
