import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(projectRoot, 'public');

await mkdir(publicRoot, { recursive: true });
const assets = [
  ['LICENSE', 'KEA3D_MPL-2.0.txt'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.txt'],
];

await Promise.all(assets.map(async ([source, destination]) => {
  const content = await readFile(resolve(projectRoot, source), 'utf8');
  await writeFile(resolve(publicRoot, destination), `${content.trimEnd()}\n`, 'utf8');
}));
