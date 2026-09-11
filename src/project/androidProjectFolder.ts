import { readAndroidContentUri, type AndroidNativeFileBridge } from '@/viewer/androidFileReader';

type FolderBridge = { postMessage(message: string): void; onmessage: ((event: { data: string }) => void) | null };
type FolderResult = { cancelled?: boolean; error?: string; files?: { path: string; uri: string; size: number }[] };

export async function chooseAndroidProjectResources(paths: string[]): Promise<{ files: File[]; missing: string[] } | null> {
  const native = window as Window & { kea3dProjectFolder?: FolderBridge; kea3dNativeFile?: AndroidNativeFileBridge };
  const folder = native.kea3dProjectFolder;
  const reader = native.kea3dNativeFile;
  if (!folder || !reader) throw new Error('Folder access is unavailable in this Android WebView. Use Locate or replace to select the resource files, or open a .kea3dp package.');
  const result = await new Promise<FolderResult>((resolve, reject) => {
    folder.onmessage = ({ data }) => {
      folder.onmessage = null;
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Android returned an invalid folder response.')); }
    };
    try { folder.postMessage(JSON.stringify({ paths })); }
    catch (error) { folder.onmessage = null; reject(error); }
  });
  if (result.cancelled) return null;
  if (result.error) throw new Error(result.error);
  if (!Array.isArray(result.files) || result.files.length > paths.length) throw new Error('Invalid folder response.');
  let total = 0;
  const seen = new Set<string>();
  for (const entry of result.files) {
    if (!paths.includes(entry.path) || seen.has(entry.path) || !entry.uri.startsWith('content://') || !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > 256 * 1024 * 1024) {
      throw new Error('A resource size or path could not be safely read. Select the files individually or use a .kea3dp package.');
    }
    seen.add(entry.path);
    total += entry.size;
  }
  if (total > 512 * 1024 * 1024) throw new Error('Project resources exceed the 512 MB folder recovery limit.');
  const files: File[] = [];
  for (const entry of result.files) {
    const bytes = await readAndroidContentUri(reader, entry.uri, entry.size, () => undefined, AbortSignal.timeout(60_000));
    const file = new File([bytes], entry.path.split('/').pop()!);
    Object.defineProperty(file, 'webkitRelativePath', { value: entry.path });
    files.push(file);
  }
  return { files, missing: paths.filter(path => !seen.has(path)) };
}
