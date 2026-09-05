/// <reference lib="webworker" />

import createOcctModule from '@kea3d/cad-wasm';
import occtWasmUrl from '@kea3d/cad-wasm/dist/occt-import-js.wasm?url';
import type { CadImportResult } from './cadTypes';

interface CadWorkerRequest {
  buffer: ArrayBuffer;
  format: 'step' | 'iges' | 'brep';
}

const modulePromise = createOcctModule({
  locateFile: (path) => path.endsWith('.wasm') ? occtWasmUrl : path,
});

self.onmessage = async (event: MessageEvent<CadWorkerRequest>) => {
  try {
    const occt = await modulePromise;
    const result = occt.ReadFile(event.data.format, new Uint8Array(event.data.buffer), {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.001,
      angularDeflection: 0.5,
    }) as CadImportResult;
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'CAD parsing failed.' });
  }
};
