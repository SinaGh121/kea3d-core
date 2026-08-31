import { LoadingManager } from 'three';
import type { LoadProgress } from './types';

function normalizePath(path: string): string {
  let decodedPath = path;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    // Keep an invalid URL unresolved instead of failing the entire loader setup.
  }
  return decodedPath
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .split(/[?#]/, 1)[0]
    .toLowerCase();
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

export function createLocalFileResolver(files: readonly File[]): (url: string) => File | undefined {
  const pathToFile = new Map<string, File>();
  const basenameToFile = new Map<string, File | null>();

  for (const file of files) {
    const relativePath = normalizePath(file.webkitRelativePath || file.name);
    const existingPath = pathToFile.get(relativePath);
    if (existingPath && existingPath !== file) throw new Error(`More than one selected file has the path "${relativePath}".`);
    pathToFile.set(relativePath, file);

    const shortName = basename(relativePath);
    const existingBasename = basenameToFile.get(shortName);
    if (existingBasename === undefined) basenameToFile.set(shortName, file);
    else if (existingBasename !== file) basenameToFile.set(shortName, null);
  }

  return (url) => {
    const normalized = normalizePath(url);
    const exactMatch = pathToFile.get(normalized);
    if (exactMatch) return exactMatch;

    const shortName = basename(normalized);
    const basenameMatch = basenameToFile.get(shortName);
    if (basenameMatch === null) throw new Error(`More than one selected companion file is named "${shortName}". Select a folder so Kea3D can resolve its paths.`);
    return basenameMatch;
  };
}

export function createLocalFileManager(
  files: readonly File[],
  onProgress: (progress: LoadProgress) => void,
): { manager: LoadingManager; dispose: () => void } {
  const manager = new LoadingManager();
  const objectUrls = new Map<File, string>();
  const resolveLocalFile = createLocalFileResolver(files);

  manager.setURLModifier((url) => {
    const file = resolveLocalFile(url);
    if (!file) return url;

    let objectUrl = objectUrls.get(file);
    if (!objectUrl) {
      objectUrl = URL.createObjectURL(file);
      objectUrls.set(file, objectUrl);
    }
    return objectUrl;
  });
  manager.onStart = () => onProgress({ stage: 'resolving' });
  manager.onProgress = () => onProgress({ stage: 'resolving' });

  return {
    manager,
    dispose: () => objectUrls.forEach((url) => URL.revokeObjectURL(url)),
  };
}
