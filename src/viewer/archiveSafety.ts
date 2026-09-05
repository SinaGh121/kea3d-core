export interface ArchiveEntryInfo {
  name: string;
  size: number;
  originalSize: number;
}

export const maxArchiveEntries = 2_048;
export const maxArchiveEntryBytes = 128 * 1024 * 1024;
export const maxArchiveExtractedBytes = 512 * 1024 * 1024;
export const maxArchiveCompressionRatio = 1_000;

export function isSafeArchivePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\')) return false;
  const segments = path.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function createArchiveEntryFilter(): (entry: ArchiveEntryInfo) => boolean {
  let entryCount = 0;
  let extractedBytes = 0;
  const paths = new Set<string>();

  return (entry) => {
    if (entry.name.endsWith('/')) return false;
    if (!isSafeArchivePath(entry.name)) throw new Error('The archive contains an unsafe file path.');
    if (!Number.isSafeInteger(entry.size) || !Number.isSafeInteger(entry.originalSize) || entry.size < 0 || entry.originalSize < 0) {
      throw new Error('The archive contains an invalid file size.');
    }

    entryCount += 1;
    if (entryCount > maxArchiveEntries) throw new Error(`The archive contains more than ${maxArchiveEntries.toLocaleString()} files.`);
    if (entry.originalSize > maxArchiveEntryBytes) throw new Error('The archive contains a file that is too large to open safely.');

    extractedBytes += entry.originalSize;
    if (extractedBytes > maxArchiveExtractedBytes) throw new Error('The archive expands to more data than Kea3D can open safely.');
    if (entry.originalSize > 0 && (entry.size === 0 || entry.originalSize / entry.size > maxArchiveCompressionRatio)) {
      throw new Error('The archive has an unsafe compression ratio.');
    }

    const normalizedPath = entry.name.toLocaleLowerCase('en-US');
    if (paths.has(normalizedPath)) throw new Error('The archive contains colliding file paths.');
    paths.add(normalizedPath);
    return true;
  };
}
