import { DoubleSide, Group, Mesh, MeshStandardMaterial, type AnimationClip, type Object3D, type WebGLRenderer } from 'three';
import { loadGltfFiles } from './loadGltfFiles';
import { buildCadScene, parseCadInWorker } from './loadCadFile';
import { loadAssimpFiles } from './loadAssimpFiles';
import { fileExtension, readFileBuffer } from './localFile';
import { createLocalFileManager } from './localFileManager';
import { threeMfUnitFromXml } from './threeMfUnit';
import type { LinearUnit, LoadProgress, UpAxis } from './types';
import { blendCompatibilityMessage, cadNoGeometryMessage, isLoadCancellation, throwIfLoadCancelled } from './loadControl';
import { parseMeshGeometryInWorker } from './loadMeshGeometry';
import { createCadCacheKey, readCadCache, writeCadCache } from './cadCache';
import { createArchiveEntryFilter } from './archiveSafety';
import { sanitizeCadImportResult } from './cadResult';
import { consumePreparedModel } from './preparedModel';

interface LoadedModelSource {
  scene: Object3D;
  animations: AnimationClip[];
  mainFile: File;
  totalSize: number;
  sourceUnit: LinearUnit;
  upAxis: UpAxis;
}

export async function loadModelFiles(
  files: readonly File[],
  onProgress: (progress: LoadProgress) => void,
  renderer: WebGLRenderer,
  signal?: AbortSignal,
): Promise<LoadedModelSource> {
  const prepared = consumePreparedModel(files);
  if (prepared) {
    return {
      ...prepared.model,
      mainFile: prepared.file,
    };
  }
  const gltfFile = files.find((file) => ['glb', 'gltf'].includes(fileExtension(file.name)));
  if (gltfFile) {
    const { gltf, mainFile, totalSize } = await loadGltfFiles(files, onProgress, renderer, signal);
    return {
      scene: gltf.scene,
      animations: gltf.animations,
      mainFile,
      totalSize,
      sourceUnit: 'm',
      upAxis: 'y',
    };
  }

  const mainFile = files.find((file) => ['stl', '3mf', 'obj', 'ply', 'fbx', 'dae', 'step', 'stp', 'iges', 'igs', 'brep', 'blend'].includes(fileExtension(file.name)));
  if (!mainFile) throw new Error('Choose a supported 3D model file.');

  const buffer = await readFileBuffer(mainFile, onProgress, signal);
  onProgress({ stage: 'decoding' });
  throwIfLoadCancelled(signal);
  const extension = fileExtension(mainFile.name);
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  const name = mainFile.name.replace(/\.[^.]+$/, '');

  if (extension === 'blend') {
    let gltf;
    try {
      gltf = await loadAssimpFiles(files, buffer, mainFile, onProgress, renderer, signal);
    } catch (error) {
      if (isLoadCancellation(error)) throw error;
      throw new Error(blendCompatibilityMessage(buffer), { cause: error });
    }
    if (!gltf.scene.name.trim()) gltf.scene.name = name;
    return {
      scene: gltf.scene,
      animations: gltf.animations,
      mainFile,
      totalSize,
      sourceUnit: 'm',
      upAxis: 'y',
    };
  }

  if (['step', 'stp', 'iges', 'igs', 'brep'].includes(extension)) {
    const format = extension === 'step' || extension === 'stp' ? 'step' : extension === 'iges' || extension === 'igs' ? 'iges' : 'brep';
    onProgress({ stage: 'caching' });
    const cacheKey = await createCadCacheKey(buffer, format, signal);
    throwIfLoadCancelled(signal);
    const cachedResult = cacheKey ? await readCadCache(cacheKey) : null;
    throwIfLoadCancelled(signal);
    let result = cachedResult;
    if (!result) {
      const parsed = await parseCadInWorker(buffer, format, signal);
      try {
        result = sanitizeCadImportResult(parsed);
      } catch (error) {
        const noGeometry = error instanceof Error && error.message.includes('does not contain renderable triangle geometry');
        if (noGeometry) {
          const explanation = cadNoGeometryMessage(mainFile.size, format, navigator.userAgent);
          if (explanation) throw new Error(explanation, { cause: error });
        }
        throw error;
      }
    }
    if (cacheKey && !cachedResult) void writeCadCache(cacheKey, result, mainFile.size);
    return {
      scene: buildCadScene(result, name),
      animations: [],
      mainFile,
      totalSize,
      sourceUnit: 'mm',
      upAxis: 'z',
    };
  }

  if (extension === 'obj') {
    const { manager, dispose } = createLocalFileManager(files, onProgress);
    try {
      const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
        import('three/addons/loaders/OBJLoader.js'),
        import('three/addons/loaders/MTLLoader.js'),
      ]);
      const loader = new OBJLoader(manager);
      const materialFile = files.find((file) => fileExtension(file.name) === 'mtl');
      if (materialFile) {
        const materialBuffer = await readFileBuffer(materialFile, onProgress, signal);
        const materials = new MTLLoader(manager).parse(new TextDecoder().decode(materialBuffer), '');
        materials.preload();
        loader.setMaterials(materials);
      }
      const scene = loader.parse(new TextDecoder().decode(buffer));
      scene.name = name;
      return { scene, animations: [], mainFile, totalSize, sourceUnit: 'mm', upAxis: 'y' };
    } finally {
      dispose();
    }
  }

  if (extension === 'ply') {
    const { geometry } = await parseMeshGeometryInWorker(buffer, 'ply', signal);
    const hasVertexColors = geometry.hasAttribute('color');
    const material = new MeshStandardMaterial({
      color: hasVertexColors ? 0xffffff : 0xb7c0cc,
      metalness: 0.04,
      roughness: 0.62,
      side: DoubleSide,
      vertexColors: hasVertexColors,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    const scene = new Group();
    scene.name = name;
    scene.add(mesh);
    return { scene, animations: [], mainFile, totalSize, sourceUnit: 'mm', upAxis: 'y' };
  }

  if (extension === 'fbx') {
    const { manager, dispose } = createLocalFileManager(files, onProgress);
    try {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      const scene = new FBXLoader(manager).parse(buffer, '');
      if (!scene.name.trim()) scene.name = name;
      return { scene, animations: scene.animations, mainFile, totalSize, sourceUnit: 'm', upAxis: 'y' };
    } finally {
      dispose();
    }
  }

  if (extension === 'dae') {
    const { manager, dispose } = createLocalFileManager(files, onProgress);
    try {
      const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
      const result = new ColladaLoader(manager).parse(new TextDecoder().decode(buffer), '');
      if (!result) throw new Error('The COLLADA file could not be decoded.');
      if (!result.scene.name.trim()) result.scene.name = name;
      return { scene: result.scene, animations: result.scene.animations, mainFile, totalSize, sourceUnit: 'm', upAxis: 'y' };
    } finally {
      dispose();
    }
  }

  if (extension === '3mf') {
    const [{ ThreeMFLoader }, { strFromU8, unzipSync, zipSync }] = await Promise.all([
      import('three/addons/loaders/3MFLoader.js'),
      import('three/addons/libs/fflate.module.js'),
    ]);
    const archive = unzipSync(new Uint8Array(buffer), { filter: createArchiveEntryFilter() });
    const modelEntry = Object.entries(archive).find(([path]) => path.toLowerCase().endsWith('.model'))?.[1];
    const xmlHeader = modelEntry
      ? strFromU8(modelEntry.subarray(0, Math.min(modelEntry.length, 8_192)))
      : '';
    const safeArchive = zipSync(archive);
    const safeBuffer = safeArchive.buffer.slice(safeArchive.byteOffset, safeArchive.byteOffset + safeArchive.byteLength) as ArrayBuffer;
    const scene = new ThreeMFLoader().parse(safeBuffer);
    if (!scene.name.trim()) scene.name = mainFile.name.replace(/\.[^.]+$/, '');
    return {
      scene,
      animations: [],
      mainFile,
      totalSize,
      sourceUnit: threeMfUnitFromXml(xmlHeader),
      upAxis: 'z',
    };
  }

  const { geometry, alpha, hasColors } = await parseMeshGeometryInWorker(buffer, 'stl', signal);
  const hasVertexColors = hasColors && geometry.hasAttribute('color');
  const material = new MeshStandardMaterial({
    color: hasVertexColors ? 0xffffff : 0xb7c0cc,
    metalness: 0.04,
    opacity: alpha,
    roughness: 0.62,
    side: DoubleSide,
    transparent: alpha < 1,
    vertexColors: hasVertexColors,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  const scene = new Group();
  scene.name = name;
  scene.add(mesh);

  return {
    scene,
    animations: [],
    mainFile,
    totalSize,
    sourceUnit: 'mm',
    upAxis: 'z',
  };
}
