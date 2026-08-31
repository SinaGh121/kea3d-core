import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(projectRoot, 'public/vendor/three');
const assets = [
  ['examples/jsm/libs/draco/gltf/draco_decoder.js', 'draco/draco_decoder.js'],
  ['examples/jsm/libs/draco/gltf/draco_decoder.wasm', 'draco/draco_decoder.wasm'],
  ['examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js', 'draco/draco_wasm_wrapper.js'],
  ['examples/jsm/libs/basis/basis_transcoder.js', 'basis/basis_transcoder.js'],
  ['examples/jsm/libs/basis/basis_transcoder.wasm', 'basis/basis_transcoder.wasm'],
];

await rm(outputRoot, { recursive: true, force: true });
for (const [source, destination] of assets) {
  const output = resolve(outputRoot, destination);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(resolve(projectRoot, 'node_modules/three', source), output);
}
