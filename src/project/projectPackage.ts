import { unzipSync, zipSync, type Zippable } from 'fflate';
import { createArchiveEntryFilter, isSafeArchivePath, maxArchiveExtractedBytes } from '@/viewer/archiveSafety';
import { decodeKea3dProject, serializeKea3dProject, type Kea3dProjectSession } from './projectFormat';

export const KEA3D_PACKAGE_EXTENSION = 'kea3dp';
export const KEA3D_PACKAGE_MANIFEST = 'project.kea3d';

const zipEndSignature = 0x06054b50;
const zipCentralSignature = 0x02014b50;
const zipLocalSignature = 0x04034b50;
const fixedZipTime = new Date('1980-01-01T00:00:00.000Z');

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function archiveError(message: string): never {
  throw new Error(`Invalid Kea3D package: ${message}`);
}

function inspectZipMetadata(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  const minimumEnd = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimumEnd; offset -= 1) {
    if (view.getUint32(offset, true) === zipEndSignature) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) archiveError('the ZIP directory is missing.');
  const disk = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const commentLength = view.getUint16(endOffset + 20, true);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) archiveError('multi-volume ZIP files are not supported.');
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) archiveError('ZIP64 packages are not supported.');
  if (endOffset + 22 + commentLength !== bytes.byteLength) archiveError('the ZIP trailer is malformed.');
  if (centralOffset + centralSize !== endOffset) archiveError('the ZIP directory bounds are invalid.');

  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || view.getUint32(offset, true) !== zipCentralSignature) archiveError('the ZIP directory is malformed.');
    const madeBy = view.getUint16(offset + 4, true) >>> 8;
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const entryCommentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameLength === 0 || nameLength > 1_024 || nameEnd > endOffset) archiveError('an entry path has an invalid length.');
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(nameStart, nameEnd));
    } catch {
      archiveError('entry paths must be valid UTF-8.');
    }
    if (name.endsWith('/') || !isSafeArchivePath(name)) archiveError(`entry path "${name}" is unsafe.`);
    if ((flags & 1) !== 0) archiveError('encrypted entries are not supported.');
    if (compression !== 0 && compression !== 8) archiveError('an entry uses an unsupported compression method.');
    if (madeBy === 3 && ((externalAttributes >>> 16) & 0xf000) === 0xa000) archiveError('symbolic links are not supported.');
    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== zipLocalSignature) archiveError('an entry has an invalid local header.');
    const localFlags = view.getUint16(localOffset + 6, true);
    const localCompression = view.getUint16(localOffset + 8, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    if (localNameEnd + localExtraLength > centralOffset
      || localFlags !== flags
      || localCompression !== compression
      || localNameLength !== nameLength
      || !bytes.subarray(localNameStart, localNameEnd).every((value, byteIndex) => value === bytes[nameStart + byteIndex])) {
      archiveError('an entry local header does not match the ZIP directory.');
    }
    offset += 46 + nameLength + extraLength + entryCommentLength;
  }
  if (offset !== endOffset) archiveError('the ZIP directory contains trailing data.');
}

function packagedFile(path: string, bytes: Uint8Array, type: string): File {
  const file = new File([exactBuffer(bytes)], path.split('/').pop() || path, { type, lastModified: 0 });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

export function decodeKea3dPackage(buffer: ArrayBuffer): {
  document: Kea3dProjectSession['document'];
  manifestFile: File;
  resourceFiles: Map<string, File>;
  files: File[];
} {
  if (buffer.byteLength === 0 || buffer.byteLength > maxArchiveExtractedBytes) archiveError('the package has an invalid size.');
  const bytes = new Uint8Array(buffer);
  inspectZipMetadata(bytes);
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes, { filter: createArchiveEntryFilter() });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The archive')) throw error;
    archiveError('the ZIP data could not be decoded.');
  }
  const paths = Object.keys(archive);
  if (!Object.hasOwn(archive, KEA3D_PACKAGE_MANIFEST)) archiveError(`exactly one root ${KEA3D_PACKAGE_MANIFEST} manifest is required.`);
  const document = decodeKea3dProject(exactBuffer(archive[KEA3D_PACKAGE_MANIFEST]));
  const referencedIds = new Set(document.instances.map((instance) => instance.resource));
  const expectedPaths = new Set([KEA3D_PACKAGE_MANIFEST]);
  const resourceFiles = new Map<string, File>();
  for (const resource of document.resources) {
    if (!referencedIds.has(resource.id)) continue;
    const data = archive[resource.uri];
    if (!data) archiveError(`required resource "${resource.uri}" is missing.`);
    expectedPaths.add(resource.uri);
    resourceFiles.set(resource.id, packagedFile(resource.uri, data, 'model/gltf-binary'));
  }
  const unexpected = paths.find((path) => !expectedPaths.has(path));
  if (unexpected) archiveError(`unexpected entry "${unexpected}" is not referenced by the manifest.`);
  const manifestFile = packagedFile(KEA3D_PACKAGE_MANIFEST, archive[KEA3D_PACKAGE_MANIFEST], 'application/json');
  return { document, manifestFile, resourceFiles, files: [manifestFile, ...resourceFiles.values()] };
}

export async function encodeKea3dPackage(session: Kea3dProjectSession): Promise<Uint8Array> {
  const manifest = new TextEncoder().encode(serializeKea3dProject(session.document));
  const referencedIds = new Set(session.document.instances.map((instance) => instance.resource));
  const entries: Array<[string, Uint8Array, 0 | 6]> = [[KEA3D_PACKAGE_MANIFEST, manifest, 6]];
  let totalBytes = manifest.byteLength;
  for (const resource of session.document.resources) {
    if (!referencedIds.has(resource.id)) continue;
    const file = session.resourceFiles.get(resource.id);
    if (!file) throw new Error(`Project resource "${resource.uri}" must be located before the project can be packed.`);
    const data = new Uint8Array(await file.arrayBuffer());
    totalBytes += data.byteLength;
    if (totalBytes > maxArchiveExtractedBytes) throw new Error('The project expands to more data than Kea3D can pack safely.');
    entries.push([resource.uri, data, 0]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right, 'en-US'));
  const zippable: Zippable = {};
  for (const [path, data, level] of entries) zippable[path] = [data, { level, mtime: fixedZipTime }];
  const packageBytes = zipSync(zippable);
  inspectZipMetadata(packageBytes);
  decodeKea3dPackage(exactBuffer(packageBytes));
  return packageBytes;
}

export function packageSuggestedName(session: Kea3dProjectSession): string {
  const manifestBase = session.manifestFile.name.replace(/\.kea3d$/i, '');
  const withoutControls = Array.from((manifestBase || session.document.name).trim())
    .map((character) => character.charCodeAt(0) <= 0x1f ? '-' : character)
    .join('');
  const safeName = withoutControls.replace(/[<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '') || 'project';
  return `${safeName}.${KEA3D_PACKAGE_EXTENSION}`;
}
