import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import createPatched from '@kea3d/cad-wasm';
import createOriginal from 'occt-import-js';

// Explicit local fixture only; no source paths or model data are written or uploaded.
if (!process.argv[2]) throw new Error('Usage: node scripts/test-cad-colors.mjs <local STEP> [expected-colored-faces] [expected-distinct-colors]');
const bytes = await readFile(process.argv[2]);
const [patched, original] = await Promise.all([createPatched(), createOriginal()]);
const parameters = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 };
const baseline = original.ReadFile('step', bytes, parameters);
const result = patched.ReadFile('step', bytes, parameters);
assert.equal(result.success, true);
assert.deepEqual(result.root, baseline.root);
assert.equal(result.meshes.length, baseline.meshes.length);
let triangles = 0;
let coloredFaces = 0;
const colors = new Set();
for (const [index, mesh] of result.meshes.entries()) {
  const before = baseline.meshes[index];
  assert.deepEqual(mesh.attributes, before.attributes);
  assert.deepEqual(mesh.index, before.index);
  assert.deepEqual(mesh.brep_faces.map(({ first, last }) => [first, last]), before.brep_faces.map(({ first, last }) => [first, last]));
  triangles += mesh.index.array.length / 3;
  for (const face of mesh.brep_faces) {
    if (face.color) {
      coloredFaces += 1;
      colors.add(face.color.map((value) => value.toFixed(6)).join(','));
    }
  }
}
const after = await readFile(process.argv[2]);
assert.equal(createHash('sha256').update(after).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
if (process.argv[3] !== undefined) assert.equal(coloredFaces, Number(process.argv[3]), 'Colored face count');
if (process.argv[4] !== undefined) assert.equal(colors.size, Number(process.argv[4]), 'Distinct face colors');
console.log(JSON.stringify({ meshes: result.meshes.length, triangles, coloredFaces, distinctFaceColors: [...colors], geometryUnchanged: true, sourceUnchanged: true }, null, 2));
