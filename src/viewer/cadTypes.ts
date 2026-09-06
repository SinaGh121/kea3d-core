export interface CadNodeData {
  name: string;
  meshes: number[];
  children: CadNodeData[];
}

export interface CadFaceData {
  first: number;
  last: number;
  color: number[] | null;
}

export interface CadMeshData {
  name: string;
  color?: number[];
  brep_faces?: CadFaceData[];
  attributes: {
    position: { array: number[] };
    normal?: { array: number[] };
  };
  index: { array: number[] };
}

export interface CadImportResult {
  success: boolean;
  root: CadNodeData;
  meshes: CadMeshData[];
}
