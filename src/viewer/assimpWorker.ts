/// <reference lib="webworker" />

import createAssimpModule from 'assimpjs';
import assimpWasmUrl from 'assimpjs/dist/assimpjs.wasm?url';

interface AssimpWorkerRequest {
  files: Array<{ name: string; buffer: ArrayBuffer }>;
}

const modulePromise = createAssimpModule({
  locateFile: (path) => path.endsWith('.wasm') ? assimpWasmUrl : path,
});

self.onmessage = async (event: MessageEvent<AssimpWorkerRequest>) => {
  try {
    const assimp = await modulePromise;
    const fileList = new assimp.FileList();
    event.data.files.forEach((file) => fileList.AddFile(file.name, new Uint8Array(file.buffer)));
    const result = assimp.ConvertFileList(fileList, 'glb2');
    if (!result.IsSuccess() || result.FileCount() === 0) {
      throw new Error(`Assimp could not convert this file (${result.GetErrorCode()}).`);
    }
    const glb = Uint8Array.from(result.GetFile(0).GetContent()).buffer;
    self.postMessage({ glb }, { transfer: [glb] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Model conversion failed.' });
  }
};
