import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(projectRoot, 'public');

await mkdir(publicRoot, { recursive: true });
const assets = [
  ['LICENSE', 'KEA3D_MPL-2.0.txt'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.txt'],
  ['THIRD_PARTY_LICENSES.txt', 'THIRD_PARTY_LICENSES.txt'],
  ['vendor/cad-wasm/OCCT-LICENSE.txt', 'licenses/OCCT-LGPL-2.1.txt'],
  ['vendor/cad-wasm/OCCT-EXCEPTION.txt', 'licenses/OCCT-EXCEPTION.txt'],
];

await Promise.all(assets.map(async ([source, destination]) => {
  const content = await readFile(resolve(projectRoot, source), 'utf8');
  await mkdir(dirname(resolve(publicRoot, destination)), { recursive: true });
  await writeFile(resolve(publicRoot, destination), `${content.trimEnd()}\n`, 'utf8');
}));
