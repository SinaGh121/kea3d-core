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

export function blenderFileVersion(buffer: ArrayBuffer): string | null {
  const header = new TextDecoder('ascii').decode(buffer.slice(0, 12));
  if (!header.startsWith('BLENDER') || !/^\d{3}$/.test(header.slice(9, 12))) return null;
  const digits = header.slice(9, 12);
  return `${Number(digits[0])}.${digits.slice(1)}`;
}

export function blendCompatibilityMessage(buffer: ArrayBuffer): string {
  const version = blenderFileVersion(buffer);
  const fileDescription = version ? `This Blender ${version} file` : 'This Blender file';
  return `${fileDescription} is not compatible with Kea3D's best-effort BLEND importer. In Blender, use File > Export > glTF 2.0 and choose GLB, then open the GLB in Kea3D. The source file is unchanged.`;
}
