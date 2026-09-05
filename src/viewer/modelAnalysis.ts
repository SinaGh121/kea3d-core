import { Box3, Mesh, Vector3, type Object3D } from 'three';
import type { ModelInfo, SelectionInfo } from './types';

function renderedVertexCount(mesh: Mesh): number {
  const geometry = mesh.geometry;
  const positionCount = geometry.getAttribute('position')?.count ?? 0;
  const available = geometry.index?.count ?? positionCount;
  const drawCount = Number.isFinite(geometry.drawRange.count)
    ? geometry.drawRange.count
    : available;
  return Math.max(0, Math.min(available, drawCount));
}

export function analyzeSelection(root: Object3D): SelectionInfo {
  return analyzeSelections([root]);
}

export function analyzeSelections(roots: readonly Object3D[]): SelectionInfo {
  let meshes = 0;
  let vertices = 0;
  let triangles = 0;
  const materials = new Set<string>();
  const visitedMeshes = new Set<Mesh>();
  const bounds = new Box3();

  roots.forEach((root) => {
    bounds.expandByObject(root);
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      if (visitedMeshes.has(object)) return;
      visitedMeshes.add(object);
      meshes += 1;
      vertices += object.geometry.getAttribute('position')?.count ?? 0;
      triangles += Math.floor(renderedVertexCount(object) / 3);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      objectMaterials.forEach((material) => materials.add(material.uuid));
    });
  });

  const size = bounds.getSize(new Vector3());
  return {
    meshes,
    vertices,
    triangles,
    materials: materials.size,
    dimensions: [size.x, size.y, size.z],
  };
}

export function analyzeModel(
  root: Object3D,
  fileName: string,
  fileSize: number,
): ModelInfo {
  return { fileName, fileSize, ...analyzeSelection(root) };
}
