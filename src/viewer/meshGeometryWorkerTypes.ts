export type GeometryArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

export interface SerializedGeometryAttribute {
  array: GeometryArray;
  itemSize: number;
  normalized: boolean;
}

export interface SerializedGeometry {
  attributes: Record<string, SerializedGeometryAttribute>;
  index: SerializedGeometryAttribute | null;
  alpha: number;
  hasColors: boolean;
}

export type MeshGeometryWorkerRequest = {
  buffer: ArrayBuffer;
  extension: 'ply' | 'stl';
};

export type MeshGeometryWorkerResponse =
  | { ok: true; geometry: SerializedGeometry }
  | { ok: false; error: string };
