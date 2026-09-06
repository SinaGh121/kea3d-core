export const largeFileBytes = 100 * 1024 * 1024;
export const extremeFileBytes = 500 * 1024 * 1024;
export const constrainedCadBytes = 64 * 1024 * 1024;

export function loadCancelledError(): DOMException {
  return new DOMException('Model loading was cancelled.', 'AbortError');
}

export function throwIfLoadCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : loadCancelledError();
}

export function isLoadCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function loadSizeNotice(totalBytes: number): string | null {
  if (totalBytes >= extremeFileBytes) return 'Very large model · parsing may require several gigabytes of memory.';
  if (totalBytes >= largeFileBytes) return 'Large model · parsing may temporarily use several times the file size.';
  return null;
}

export function cadNoGeometryMessage(totalBytes: number, format: string, userAgent = ''): string | null {
  const android = /Android/i.test(userAgent);
  if (!android && totalBytes < constrainedCadBytes) return null;

  const sizeMb = Math.ceil(totalBytes / 1_048_576);
  const platform = android ? 'Android WebAssembly CAD engine' : 'WebAssembly CAD engine';
  return `The ${platform} found this ${sizeMb} MB ${format.toUpperCase()} assembly, but could not tessellate its bodies. Open it in Windows Kea3D and Export GLB, then open the GLB here. The source file is unchanged.`;
}
