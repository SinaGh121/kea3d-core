import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { stdout } from 'node:process';
import { gzipSync } from 'node:zlib';

const projectRoot = resolve(import.meta.dirname, '..');
const distDirectory = join(projectRoot, 'dist');
const indexHtml = readFileSync(join(distDirectory, 'index.html'), 'utf8');
const startupAssetMatches = [
  ...indexHtml.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+\.js)["']/gi),
  ...indexHtml.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+\.js)["']/gi),
];
const startupAssets = [...new Set(startupAssetMatches.map((match) => match[1].replace(/^\.\//, '')))].sort();

if (startupAssets.length === 0) throw new Error('No startup JavaScript assets were found in dist/index.html.');

const startupBytes = startupAssets.reduce((total, asset) => total + statSync(join(distDirectory, asset)).size, 0);
const startupGzipBytes = startupAssets.reduce((total, asset) => (
  total + gzipSync(readFileSync(join(distDirectory, asset))).byteLength
), 0);
const maximumStartupBytes = 550 * 1024;
const maximumStartupGzipBytes = 170 * 1024;

if (startupBytes > maximumStartupBytes || startupGzipBytes > maximumStartupGzipBytes) {
  throw new Error(
    `Startup JavaScript exceeds its budget: ${startupBytes} B raw / ${startupGzipBytes} B gzip `
    + `(limits: ${maximumStartupBytes} B / ${maximumStartupGzipBytes} B).`,
  );
}

const viewerChunk = readdirSync(join(distDirectory, 'assets')).find((name) => /^Viewer-.*\.js$/.test(name));
if (!viewerChunk) throw new Error('The deferred Viewer chunk was not found.');
if (startupAssets.some((asset) => basename(asset) === viewerChunk)) {
  throw new Error('The Viewer chunk is part of startup JavaScript and must remain deferred.');
}

stdout.write(
  `Bundle budget passed: ${(startupBytes / 1024).toFixed(1)} KiB raw / `
  + `${(startupGzipBytes / 1024).toFixed(1)} KiB gzip across ${startupAssets.length} startup asset(s).\n`,
);
