import { LoadingManager } from 'three';
import type { LoadProgress } from './types';

function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .toLowerCase()
    .split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') segments.pop();
      else segments.push(segment);
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function directory(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? '' : path.slice(0, separator);
}

function isExternalUrl(url: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(url.trim());
}

export function createLocalFileResolver(
  files: readonly File[],
  mainFile?: File,
): (url: string) => File | undefined {
  const pathToFile = new Map<string, File>();
  const basenameToFile = new Map<string, File | null>();
  const mainDirectory = mainFile
    ? directory(normalizePath(mainFile.webkitRelativePath || mainFile.name))
    : '';

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
    if (isExternalUrl(url)) return undefined;
    let path = url.split(/[?#]/, 1)[0];
    try {
      path = decodeURIComponent(path);
    } catch {
      // Leave malformed encoding unchanged; literal file paths are never decoded.
    }
    const normalized = normalizePath(path);
    const relativeToMain = mainDirectory
      ? normalizePath(`${mainDirectory}/${normalized}`)
      : normalized;
    const exactMatch = pathToFile.get(relativeToMain) ?? pathToFile.get(normalized);
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
  mainFile?: File,
): { manager: LoadingManager; dispose: () => void } {
  const manager = new LoadingManager();
  const objectUrls = new Map<File, string>();
  const resolveLocalFile = createLocalFileResolver(files, mainFile);

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
