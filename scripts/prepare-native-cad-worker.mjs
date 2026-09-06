import { chmod, copyFile, mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

if (process.platform !== 'linux') process.exit(0);
if (process.arch !== 'x64') throw new Error(`The native Linux CAD worker currently requires x64, received ${process.arch}.`);

const sourceDirectory = resolve('native/cad-worker');
const buildDirectory = resolve('native/cad-worker/build-linux');
const worker = resolve(buildDirectory, 'kea3d-cad-worker');
const sidecarDirectory = resolve('native/cad-worker/bin');
const sidecar = resolve(sidecarDirectory, 'kea3d-cad-worker-x86_64-unknown-linux-gnu');

function run(arguments_) {
  const result = spawnSync('cmake', arguments_, { stdio: 'inherit' });
  if (result.error) throw new Error(`Could not run CMake: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`CMake exited with code ${result.status}.`);
}

run(['-S', sourceDirectory, '-B', buildDirectory, '-DCMAKE_BUILD_TYPE=Release']);
run(['--build', buildDirectory, '--config', 'Release', '--parallel']);
await stat(worker);
await mkdir(sidecarDirectory, { recursive: true });
await copyFile(worker, sidecar);
await chmod(worker, 0o755);
await chmod(sidecar, 0o755);
console.log(`Prepared native Linux CAD worker: ${sidecar}`);
