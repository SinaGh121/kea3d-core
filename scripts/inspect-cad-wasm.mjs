import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import createOcctModule from 'occt-import-js';

const sourcePath = process.argv[2];
const profile = process.argv[3] ?? 'app';
if (!sourcePath) {
  console.error('Usage: node scripts/inspect-cad-wasm.mjs <STEP|IGES|BREP file>');
  process.exitCode = 2;
} else {
  const formatByExtension = new Map([
    ['.step', 'step'],
    ['.stp', 'step'],
    ['.iges', 'iges'],
    ['.igs', 'iges'],
    ['.brep', 'brep'],
  ]);
  const absolutePath = resolve(sourcePath);
  const format = formatByExtension.get(extname(absolutePath).toLowerCase());
  if (!format) {
    console.error(`Unsupported CAD extension: ${extname(absolutePath)}`);
    process.exitCode = 2;
  } else {
    const startedAt = performance.now();
    try {
      const [occt, bytes] = await Promise.all([createOcctModule(), readFile(absolutePath)]);
      const parameters = profile === 'default' ? null : profile === 'coarse' ? {
        linearUnit: 'millimeter',
        linearDeflectionType: 'bounding_box_ratio',
        linearDeflection: 0.01,
        angularDeflection: 1,
      } : {
        linearUnit: 'millimeter',
        linearDeflectionType: 'bounding_box_ratio',
        linearDeflection: 0.001,
        angularDeflection: 0.5,
      };
      const result = occt.ReadFile(format, bytes, parameters);
      const meshes = Array.isArray(result?.meshes) ? result.meshes : [];
      const summaries = meshes.slice(0, 5).map((mesh, index) => {
        const positions = mesh?.attributes?.position?.array;
        const indices = mesh?.index?.array;
        return {
          index,
          name: mesh?.name,
          positionKind: Array.isArray(positions) ? 'array' : positions?.constructor?.name ?? typeof positions,
          positionLength: positions?.length ?? null,
          indexKind: Array.isArray(indices) ? 'array' : indices?.constructor?.name ?? typeof indices,
          indexLength: indices?.length ?? null,
        };
      });
      let positionMeshes = 0;
      let indexedMeshes = 0;
      let triangles = 0;
      for (const mesh of meshes) {
        const positions = mesh?.attributes?.position?.array;
        const indices = mesh?.index?.array;
        if (positions?.length >= 9) positionMeshes += 1;
        if (indices?.length >= 3) {
          indexedMeshes += 1;
          triangles += Math.floor(indices.length / 3);
        }
      }
      const memory = process.memoryUsage();
      console.log(JSON.stringify({
        file: basename(absolutePath),
        profile,
        bytes: bytes.byteLength,
        elapsedSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(3)),
        success: result?.success,
        meshCount: meshes.length,
        positionMeshes,
        indexedMeshes,
        triangles,
        root: result?.root ? {
          name: result.root.name,
          meshes: Array.isArray(result.root.meshes) ? result.root.meshes.length : null,
          children: Array.isArray(result.root.children) ? result.root.children.length : null,
        } : null,
        firstMeshes: summaries,
        memoryMiB: {
          rss: Math.round(memory.rss / 1024 / 1024),
          heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
          external: Math.round(memory.external / 1024 / 1024),
        },
      }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({
        file: basename(absolutePath),
        elapsedSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(3)),
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      }, null, 2));
      process.exitCode = 1;
    }
  }
}
