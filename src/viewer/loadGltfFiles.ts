import type { WebGLRenderer } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createGltfLoader } from './createGltfLoader';
import type { LoadProgress } from './types';
import { fileExtension, readFileBuffer } from './localFile';
import { createLocalFileManager } from './localFileManager';

const supportedMainExtensions = new Set(['glb', 'gltf']);

export interface LoadedGltf {
  gltf: GLTF;
  mainFile: File;
  totalSize: number;
}

export async function loadGltfFiles(
  files: readonly File[],
  onProgress: (progress: LoadProgress) => void,
  renderer: WebGLRenderer,
  signal?: AbortSignal,
): Promise<LoadedGltf> {
  const mainFile = files.find((file) => supportedMainExtensions.has(fileExtension(file.name)));
  if (!mainFile) throw new Error('Choose a .glb or .gltf file.');

  const { manager, dispose } = createLocalFileManager(files, onProgress, mainFile);

  try {
    const buffer = await readFileBuffer(mainFile, onProgress, signal);
    onProgress({ stage: 'decoding' });
    const data = fileExtension(mainFile.name) === 'gltf'
      ? new TextDecoder().decode(buffer)
      : buffer;
    const gltfLoader = createGltfLoader(manager, renderer);
    let gltf: GLTF;
    try {
      gltf = await gltfLoader.loader.parseAsync(data, '');
    } finally {
      gltfLoader.dispose();
    }
    return {
      gltf,
      mainFile,
      totalSize: files.reduce((total, file) => total + file.size, 0),
    };
  } finally {
    dispose();
  }
}
