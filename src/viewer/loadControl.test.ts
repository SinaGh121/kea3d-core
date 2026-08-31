import { describe, expect, it } from 'vitest';
import { blendCompatibilityMessage, blenderFileVersion, cadNoGeometryMessage, constrainedCadBytes, extremeFileBytes, isLoadCancellation, largeFileBytes, loadSizeNotice, throwIfLoadCancelled } from './loadControl';

describe('load control', () => {
  it('classifies large and extreme local files', () => {
    expect(loadSizeNotice(largeFileBytes - 1)).toBeNull();
    expect(loadSizeNotice(largeFileBytes)).toContain('Large model');
    expect(loadSizeNotice(extremeFileBytes)).toContain('Very large model');
  });

  it('uses AbortError for cancellation', () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => throwIfLoadCancelled(controller.signal)).toThrow();
    try {
      throwIfLoadCancelled(controller.signal);
    } catch (error) {
      expect(isLoadCancellation(error)).toBe(true);
    }
  });

  it('explains the native desktop conversion path for large browser CAD imports', () => {
    const message = cadNoGeometryMessage(constrainedCadBytes, 'step');
    expect(message).toContain('WebAssembly CAD engine');
    expect(message).toContain('Windows Kea3D');
    expect(message).toContain('Export GLB');
  });

  it('uses the actionable Android explanation regardless of source size', () => {
    const message = cadNoGeometryMessage(1024, 'iges', 'Mozilla/5.0 (Linux; Android 16)');
    expect(message).toContain('Android WebAssembly CAD engine');
    expect(message).toContain('IGES');
  });

  it('keeps the original precise error for small non-Android imports', () => {
    expect(cadNoGeometryMessage(constrainedCadBytes - 1, 'brep')).toBeNull();
  });

  it('reads the Blender version from a valid file header', () => {
    const buffer = new TextEncoder().encode('BLENDER-v400').buffer;
    expect(blenderFileVersion(buffer)).toBe('4.00');
    expect(blenderFileVersion(new TextEncoder().encode('not a blend file').buffer)).toBeNull();
  });

  it('explains the reliable GLB conversion path after a BLEND compatibility failure', () => {
    const buffer = new TextEncoder().encode('BLENDER-v420').buffer;
    const message = blendCompatibilityMessage(buffer);
    expect(message).toContain('Blender 4.20');
    expect(message).toContain('best-effort BLEND importer');
    expect(message).toContain('File > Export > glTF 2.0');
    expect(message).toContain('GLB');
  });
});
