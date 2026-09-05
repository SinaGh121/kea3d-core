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
  ['legal/evidence/scroll-LICENSE.txt', 'licenses/react-remove-scroll-bar-MIT.txt'],
  ['legal/evidence/assimp-bundled-notices.txt', 'licenses/assimp-bundled-notices.txt'],
  ['legal/evidence/basis-LICENSES-Apache-2.0.txt', 'licenses/basis-Apache-2.0.txt'],
  ['legal/evidence/basis-LICENSES-BSD-3-clause.txt', 'licenses/basis-BSD-3-clause.txt'],
  ['legal/evidence/basis-LICENSES-MIT.txt', 'licenses/basis-MIT.txt'],
  ['legal/evidence/basis-LICENSES-Zlib.txt', 'licenses/basis-Zlib.txt'],
  ['legal/evidence/basis-zstd-LICENSE', 'licenses/basis-zstd.txt'],
];

await Promise.all(assets.map(async ([source, destination]) => {
  let content = await readFile(resolve(projectRoot, source), 'utf8');
  if (source === 'THIRD_PARTY_LICENSES.txt') {
    for (const [supplement] of assets.filter(([path]) => path.startsWith('legal/evidence/'))) {
      content += `\n\n===== ${supplement} =====\n${await readFile(resolve(projectRoot, supplement), 'utf8')}`;
    }
  }
  await mkdir(dirname(resolve(publicRoot, destination)), { recursive: true });
  await writeFile(resolve(publicRoot, destination), `${content.trimEnd()}\n`, 'utf8');
}));
