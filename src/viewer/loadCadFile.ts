import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from 'three';
import type { CadImportResult, CadMeshData, CadNodeData } from './cadTypes';
import { loadCancelledError, throwIfLoadCancelled } from './loadControl';

type CadFormat = 'step' | 'iges' | 'brep';

function materialForColor(color: number[] | undefined | null): MeshStandardMaterial {
  const [red, green, blue] = color ?? [0.72, 0.76, 0.82];
  return new MeshStandardMaterial({
    color: new Color(red ?? 0.72, green ?? 0.76, blue ?? 0.82),
    metalness: 0.04,
    roughness: 0.58,
    side: DoubleSide,
  });
}

function colorKey(color: number[] | undefined | null): string {
  return (color ?? [0.72, 0.76, 0.82]).map((component) => Number(component ?? 0).toFixed(6)).join(',');
}

function buildCadMesh(data: CadMeshData): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(data.attributes.position.array), 3));
  if (data.attributes.normal) {
    geometry.setAttribute('normal', new BufferAttribute(Float32Array.from(data.attributes.normal.array), 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.setIndex(new BufferAttribute(Uint32Array.from(data.index.array), 1));
  geometry.name = data.name;

  const materials: Material[] = [materialForColor(data.color)];
  const materialIndices = new Map([[colorKey(data.color), 0]]);
  const faces = data.brep_faces ?? [];
  if (faces.length > 0) {
    let triangle = 0;
    for (const face of faces) {
      if (triangle < face.first) geometry.addGroup(triangle * 3, (face.first - triangle) * 3, 0);
      const faceColor = face.color ?? data.color;
      const key = colorKey(faceColor);
      let materialIndex = materialIndices.get(key);
      if (materialIndex === undefined) {
        materialIndex = materials.length;
        materialIndices.set(key, materialIndex);
        materials.push(materialForColor(faceColor));
      }
      geometry.addGroup(face.first * 3, (face.last - face.first + 1) * 3, materialIndex);
      triangle = face.last + 1;
    }
    const triangleCount = data.index.array.length / 3;
    if (triangle < triangleCount) geometry.addGroup(triangle * 3, (triangleCount - triangle) * 3, 0);
  }

  const mesh = new Mesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.name = data.name || 'CAD body';
  return mesh;
}

function buildCadNode(node: CadNodeData, meshes: CadMeshData[]): Object3D {
  const group = new Group();
  group.name = node.name || 'Assembly';
  node.meshes.forEach((meshIndex) => {
    const mesh = meshes[meshIndex];
    if (mesh) group.add(buildCadMesh(mesh));
  });
  node.children.forEach((child) => group.add(buildCadNode(child, meshes)));
  return group;
}

export function parseCadInWorker(buffer: ArrayBuffer, format: CadFormat, signal?: AbortSignal): Promise<CadImportResult> {
  return new Promise((resolve, reject) => {
    try {
      throwIfLoadCancelled(signal);
    } catch (error) {
      reject(error);
      return;
    }
    const worker = new Worker(new URL('./cadWorker.ts', import.meta.url), { type: 'module' });
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
    const succeed = (result: CadImportResult) => {
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
      fail(new Error(event.message || 'The CAD worker failed.'));
    };
    worker.onmessageerror = () => fail(new Error('The CAD worker returned unreadable data.'));
    worker.onmessage = (event: MessageEvent<{ result?: CadImportResult; error?: string }>) => {
      if (event.data.error) fail(new Error(event.data.error));
      else if (event.data.result?.success) succeed(event.data.result);
      else fail(new Error('OpenCascade could not read this CAD file.'));
    };
    worker.postMessage({ buffer, format }, [buffer]);
  });
}

export function buildCadScene(result: CadImportResult, fallbackName: string): Object3D {
  const scene = buildCadNode(result.root, result.meshes);
  if (!scene.name.trim() || scene.name === 'Assembly') scene.name = fallbackName;
  return scene;
}
