import type { CadImportResult } from './cadTypes';
import { isRenderableCadMesh } from './cadResult';
import { throwIfLoadCancelled } from './loadControl';

export const cadCacheSchemaVersion = '2';
export const cadCacheNamespace = `kea3d-cad-${cadCacheSchemaVersion}-occt-0.0.23-kea3d.1-mm-0.001-0.5`;

const databaseName = 'kea3d-cad-cache';
const storeName = 'tessellations';
export const cadCacheMaxEntries = 10;
export const cadCacheMaxTrackedSourceBytes = 600 * 1024 * 1024;

type CadFormat = 'step' | 'iges' | 'brep';

interface CadCacheRecord {
  key: string;
  result: CadImportResult;
  sourceBytes: number;
  createdAt: number;
  lastAccessedAt: number;
}

type CadCacheRecordMetadata = Pick<CadCacheRecord, 'key' | 'sourceBytes' | 'lastAccessedAt'>;

export interface CadCacheStats {
  entries: number;
  sourceBytes: number;
}

export function cadCacheKeysToEvict(records: readonly CadCacheRecordMetadata[]): string[] {
  let totalBytes = records.reduce((total, record) => total + Math.max(record.sourceBytes, 0), 0);
  const remaining = [...records].sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);
  const keys: string[] = [];
  while (remaining.length > cadCacheMaxEntries || totalBytes > cadCacheMaxTrackedSourceBytes) {
    const oldest = remaining.shift();
    if (!oldest) break;
    keys.push(oldest.key);
    totalBytes -= Math.max(oldest.sourceBytes, 0);
  }
  return keys;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(databaseName, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onabort = () => resolve(false);
    transaction.onerror = () => resolve(false);
  });
}

function isValidNode(value: unknown, meshCount: number): boolean {
  if (!value || typeof value !== 'object') return false;
  const node = value as { name?: unknown; meshes?: unknown; children?: unknown };
  return typeof node.name === 'string'
    && Array.isArray(node.meshes)
    && node.meshes.every((meshIndex) => Number.isInteger(meshIndex) && meshIndex >= 0 && meshIndex < meshCount)
    && Array.isArray(node.children)
    && node.children.every((child) => isValidNode(child, meshCount));
}

export function isValidCadImportResult(value: unknown): value is CadImportResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<CadImportResult>;
  if (result.success !== true || !Array.isArray(result.meshes)) return false;
  const meshesAreValid = result.meshes.length > 0 && result.meshes.every(isRenderableCadMesh);
  return meshesAreValid && isValidNode(result.root, result.meshes.length);
}

export async function createCadCacheKey(buffer: ArrayBuffer, format: CadFormat, signal?: AbortSignal): Promise<string | null> {
  try {
    throwIfLoadCancelled(signal);
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest('SHA-256', buffer);
    throwIfLoadCancelled(signal);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${cadCacheNamespace}:${format}:${hash}`;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export async function readCadCache(key: string): Promise<CadImportResult | null> {
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const record = await requestValue(store.get(key) as IDBRequest<CadCacheRecord>);
    if (!record || !isValidCadImportResult(record.result)) {
      if (record) store.delete(key);
      await transactionDone(transaction);
      return null;
    }
    record.lastAccessedAt = Date.now();
    store.put(record);
    await transactionDone(transaction);
    return record.result;
  } catch {
    return null;
  } finally {
    database.close();
  }
}

export async function writeCadCache(key: string, result: CadImportResult, sourceBytes: number): Promise<boolean> {
  if (!isValidCadImportResult(result)) return false;
  const database = await openDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const now = Date.now();
    store.put({ key, result, sourceBytes, createdAt: now, lastAccessedAt: now } satisfies CadCacheRecord);
    const records = await requestValue(store.getAll() as IDBRequest<CadCacheRecord[]>);
    if (records) {
      cadCacheKeysToEvict(records).forEach((recordKey) => store.delete(recordKey));
    }
    return await transactionDone(transaction);
  } catch {
    return false;
  } finally {
    database.close();
  }
}

export async function clearCadCache(): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).clear();
    return await transactionDone(transaction);
  } catch {
    return false;
  } finally {
    database.close();
  }
}

export async function getCadCacheStats(): Promise<CadCacheStats> {
  const database = await openDatabase();
  if (!database) return { entries: 0, sourceBytes: 0 };
  try {
    const transaction = database.transaction(storeName, 'readonly');
    const records = await requestValue(transaction.objectStore(storeName).getAll() as IDBRequest<CadCacheRecord[]>);
    if (!records) return { entries: 0, sourceBytes: 0 };
    const validRecords = records.filter((record) => isValidCadImportResult(record.result));
    return {
      entries: validRecords.length,
      sourceBytes: validRecords.reduce((total, record) => total + Math.max(record.sourceBytes, 0), 0),
    };
  } catch {
    return { entries: 0, sourceBytes: 0 };
  } finally {
    database.close();
  }
}
