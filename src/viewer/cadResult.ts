import type { CadImportResult, CadMeshData, CadNodeData } from './cadTypes';

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

export function isRenderableCadMesh(value: unknown): value is CadMeshData {
  if (!value || typeof value !== 'object') return false;
  const mesh = value as Partial<CadMeshData>;
  const positions = mesh.attributes?.position?.array;
  const normals = mesh.attributes?.normal?.array;
  const indices = mesh.index?.array;
  if (typeof mesh.name !== 'string'
    || !isFiniteNumberArray(positions)
    || positions.length < 9
    || positions.length % 3 !== 0
    || !isFiniteNumberArray(indices)
    || indices.length < 3
    || indices.length % 3 !== 0
    || (normals !== undefined && (!isFiniteNumberArray(normals) || normals.length !== positions.length))) {
    return false;
  }

  const vertexCount = positions.length / 3;
  return indices.every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount);
}

function remapNode(value: unknown, meshIndices: ReadonlyMap<number, number>): CadNodeData | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as Partial<CadNodeData>;
  if (typeof node.name !== 'string' || !Array.isArray(node.meshes) || !Array.isArray(node.children)) return null;

  const children: CadNodeData[] = [];
  for (const child of node.children) {
    const remapped = remapNode(child, meshIndices);
    if (remapped) children.push(remapped);
  }

  return {
    name: node.name,
    meshes: node.meshes.flatMap((meshIndex) => {
      if (!Number.isInteger(meshIndex)) return [];
      const remapped = meshIndices.get(meshIndex);
      return remapped === undefined ? [] : [remapped];
    }),
    children,
  };
}

/** Removes non-renderable CAD bodies while preserving and remapping the assembly tree. */
export function sanitizeCadImportResult(value: unknown): CadImportResult {
  if (!value || typeof value !== 'object') throw new Error('OpenCascade returned an invalid CAD result.');
  const result = value as Partial<CadImportResult>;
  if (result.success !== true || !Array.isArray(result.meshes)) {
    throw new Error('OpenCascade could not read this CAD file.');
  }

  const meshes: CadMeshData[] = [];
  const meshIndices = new Map<number, number>();
  result.meshes.forEach((mesh, sourceIndex) => {
    if (!isRenderableCadMesh(mesh)) return;
    meshIndices.set(sourceIndex, meshes.length);
    meshes.push(mesh);
  });

  const root = remapNode(result.root, meshIndices);
  if (!root || meshes.length === 0) {
    throw new Error('The CAD file does not contain renderable triangle geometry.');
  }

  return { success: true, root, meshes };
}
