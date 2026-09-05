/// <reference lib="webworker" />

import type { BufferGeometry } from 'three';
import type { MeshGeometryWorkerRequest, MeshGeometryWorkerResponse, SerializedGeometry } from './meshGeometryWorkerTypes';

function serializeGeometry(geometry: BufferGeometry): SerializedGeometry {
  const attributes = Object.fromEntries(
    Object.entries(geometry.attributes).map(([name, attribute]) => [name, {
      array: attribute.array,
      itemSize: attribute.itemSize,
      normalized: attribute.normalized,
    }]),
  );
  const index = geometry.index
    ? { array: geometry.index.array, itemSize: geometry.index.itemSize, normalized: geometry.index.normalized }
    : null;
  const stlGeometry = geometry as BufferGeometry & { alpha?: number; hasColors?: boolean };
  return {
    attributes,
    index,
    alpha: Number.isFinite(stlGeometry.alpha) ? stlGeometry.alpha ?? 1 : 1,
    hasColors: stlGeometry.hasColors === true && geometry.hasAttribute('color'),
  };
}

self.onmessage = async (event: MessageEvent<MeshGeometryWorkerRequest>) => {
  try {
    const geometry = event.data.extension === 'stl'
      ? new (await import('three/addons/loaders/STLLoader.js')).STLLoader().parse(event.data.buffer)
      : new (await import('three/addons/loaders/PLYLoader.js')).PLYLoader().parse(event.data.buffer);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const serialized = serializeGeometry(geometry);
    const transfers = [
      ...Object.values(serialized.attributes).map((attribute) => attribute.array.buffer),
      ...(serialized.index ? [serialized.index.array.buffer] : []),
    ];
    const response: MeshGeometryWorkerResponse = { ok: true, geometry: serialized };
    self.postMessage(response, { transfer: transfers });
  } catch (error) {
    const response: MeshGeometryWorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : 'The mesh geometry could not be decoded.',
    };
    self.postMessage(response);
  }
};
