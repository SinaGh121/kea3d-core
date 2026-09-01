import { DoubleSide, Group, Mesh, MeshStandardMaterial, type AnimationClip, type Object3D, type WebGLRenderer } from 'three';
import { loadGltfFiles } from './loadGltfFiles';
import { buildCadScene, parseCadInWorker } from './loadCadFile';
import { loadAssimpFiles } from './loadAssimpFiles';
import { fileExtension, readFileBuffer, registerPreloadedFileBuffer } from './localFile';
import { createLocalFileManager } from './localFileManager';
import { threeMfUnitFromXml } from './threeMfUnit';
import type { LinearUnit, LoadProgress, UpAxis } from './types';
import { blendCompatibilityMessage, cadNoGeometryMessage, isLoadCancellation, throwIfLoadCancelled } from './loadControl';
import { parseMeshGeometryInWorker } from './loadMeshGeometry';
import { createCadCacheKey, readCadCache, writeCadCache } from './cadCache';
import { createArchiveEntryFilter } from './archiveSafety';
import { sanitizeCadImportResult } from './cadResult';
import { consumePreparedModel } from './preparedModel';
import { changedProjectResourceIssue, decodeKea3dProject, KEA3D_PROJECT_MAX_BYTES, ProjectResourceRecoveryError, resolveProjectResourceFiles, type Kea3dProjectDocument, type Kea3dProjectSession, type ProjectResourceRecoveryIssue } from '../project/projectFormat';
import { buildFixedAssemblyScene } from '../project/assemblyScene';
import { disposeObject3D } from './disposeObject';

interface LoadedModelSource {
  scene: Object3D;
  animations: AnimationClip[];
  mainFile: File;
  totalSize: number;
  sourceUnit: LinearUnit;
  upAxis: UpAxis;
  project?: Kea3dProjectSession;
}

async function verifyProjectResourceIntegrity(
  project: Kea3dProjectDocument,
  resourceFiles: ReadonlyMap<string, File>,
  onProgress: (progress: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const issues: ProjectResourceRecoveryIssue[] = [];
  for (const resource of project.resources) {
    const file = resourceFiles.get(resource.id);
    const integrity = resource.integrity;
    if (!file || !integrity) continue;
    if (integrity.byteLength !== undefined && file.size !== integrity.byteLength) {
      issues.push(changedProjectResourceIssue(
        project,
        resource,
        `Project resource "${resource.uri}" changed size: expected ${integrity.byteLength} bytes, found ${file.size}.`,
      ));
      continue;
    }
    if (!integrity.sha256) continue;
    const buffer = await readFileBuffer(file, onProgress, signal);
    throwIfLoadCancelled(signal);
    registerPreloadedFileBuffer(file, buffer);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    if (digest !== integrity.sha256) {
      issues.push(changedProjectResourceIssue(
        project,
        resource,
        `Project resource "${resource.uri}" does not match its recorded SHA-256 digest.`,
      ));
    }
  }
  if (issues.length > 0) throw new ProjectResourceRecoveryError(issues);
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
  const projectFiles = files.filter((file) => fileExtension(file.name) === 'kea3d');
  if (projectFiles.length > 1) throw new Error('Choose one .kea3d project at a time.');
  const projectFile = projectFiles[0];
  if (projectFile) {
    if (projectFile.size > KEA3D_PROJECT_MAX_BYTES) throw new Error(`Invalid Kea3D project: document exceeds ${KEA3D_PROJECT_MAX_BYTES} bytes.`);
    const projectBuffer = await readFileBuffer(projectFile, onProgress, signal);
    throwIfLoadCancelled(signal);
    const project = decodeKea3dProject(projectBuffer);
    const resourceFiles = resolveProjectResourceFiles(project, projectFile, files);
    await verifyProjectResourceIntegrity(project, resourceFiles, onProgress, signal);
    if (project.instances.length === 1) {
      const root = project.instances[0];
      const resourceFile = root && resourceFiles.get(root.resource);
      if (!resourceFile) throw new Error('Invalid Kea3D project: the root resource could not be resolved.');
      const { gltf } = await loadGltfFiles([resourceFile], onProgress, renderer, signal);
      if (!gltf.scene.name.trim()) gltf.scene.name = project.name;
      return {
        scene: gltf.scene,
        animations: gltf.animations,
        mainFile: projectFile,
        totalSize: projectFile.size + resourceFile.size,
        sourceUnit: 'm',
        upAxis: 'y',
        project: { document: project, manifestFile: projectFile, resourceFiles },
      };
    }

    const resourceScenes = new Map<string, Object3D>();
    try {
      for (const [resourceId, resourceFile] of resourceFiles) {
        throwIfLoadCancelled(signal);
        const { gltf } = await loadGltfFiles([resourceFile], onProgress, renderer, signal);
        resourceScenes.set(resourceId, gltf.scene);
        if (gltf.animations.length > 0) throw new Error(`Project resource "${resourceId}" contains animation. Animated assembly instances are not supported yet.`);
      }
      return {
        scene: buildFixedAssemblyScene(project, resourceScenes),
        animations: [],
        mainFile: projectFile,
        totalSize: projectFile.size + [...new Set(resourceFiles.values())].reduce((total, file) => total + file.size, 0),
        sourceUnit: 'm',
        upAxis: 'y',
        project: { document: project, manifestFile: projectFile, resourceFiles },
      };
    } catch (error) {
      resourceScenes.forEach(disposeObject3D);
      throw error;
    }
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
    // The worker owns the transferred source buffer, so derive diagnostics before conversion.
    const compatibilityMessage = blendCompatibilityMessage(buffer);
    let gltf;
    try {
      gltf = await loadAssimpFiles(files, buffer, mainFile, onProgress, renderer, signal);
    } catch (error) {
      if (isLoadCancellation(error)) throw error;
      throw new Error(compatibilityMessage, { cause: error });
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
