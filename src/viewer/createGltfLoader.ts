import type { LoadingManager, WebGLRenderer } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export function createGltfLoader(manager: LoadingManager, renderer: WebGLRenderer) {
  const decoderRoot = new URL(`${import.meta.env.BASE_URL}vendor/three/`, document.baseURI).href;
  const dracoLoader = new DRACOLoader(manager).setDecoderPath(`${decoderRoot}draco/`);
  const ktx2Loader = new KTX2Loader(manager)
    .setTranscoderPath(`${decoderRoot}basis/`)
    .detectSupport(renderer);
  const loader = new GLTFLoader(manager)
    .setDRACOLoader(dracoLoader)
    .setKTX2Loader(ktx2Loader)
    .setMeshoptDecoder(MeshoptDecoder);

  return {
    loader,
    dispose: () => {
      dracoLoader.dispose();
      ktx2Loader.dispose();
    },
  };
}
