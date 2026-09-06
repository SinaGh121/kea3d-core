import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KEA3D_PROJECT_SCHEMA, type Kea3dProjectSession } from './projectFormat';
import { saveProjectSession } from './projectSave';

const mocks = vi.hoisted(() => ({ save: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

function session(): Kea3dProjectSession {
  const manifestFile = new File(['{}'], 'original.kea3d');
  Object.defineProperty(manifestFile, 'kea3dSourcePath', { value: 'C:\\models\\original.kea3d' });
  return {
    manifestFile,
    resourceFiles: new Map(),
    document: {
      $schema: KEA3D_PROJECT_SCHEMA, format: 'kea3d-project', version: 1, name: 'Test', rootInstance: 'part',
      resources: [{ id: 'model', uri: 'parts/model.glb' }], instances: [{ id: 'part', resource: 'model' }],
    },
  };
}

describe('project save location safety', () => {
  beforeEach(() => vi.resetAllMocks());

  it('passes the original directory context to the native guard before accepting Save As', async () => {
    mocks.save.mockResolvedValue('C:\\models\\renamed.kea3d');
    const original = session();
    const result = await saveProjectSession({ session: original, fileName: 'original.kea3d', nativeShell: true, desktopNativeShell: true, saveAs: true });
    expect(mocks.invoke).toHaveBeenCalledWith('save_project_file_atomic', expect.objectContaining({
      path: 'C:\\models\\renamed.kea3d', sourcePath: 'C:\\models\\original.kea3d',
    }));
    expect(result.session.document.resources).toEqual(original.document.resources);
  });

  it('retains the current session when the native location guard rejects the save', async () => {
    mocks.save.mockResolvedValue('C:\\elsewhere\\moved.kea3d');
    mocks.invoke.mockRejectedValue(new Error('Use Pack project'));
    const original = session();
    await expect(saveProjectSession({ session: original, fileName: 'original.kea3d', nativeShell: true, desktopNativeShell: true, saveAs: true })).rejects.toThrow('Pack project');
    expect(original.manifestFile.name).toBe('original.kea3d');
  });

  it('cancels without writing and directs mobile manifest saves to Pack', async () => {
    mocks.save.mockResolvedValue(null);
    const options = { session: session(), fileName: 'original.kea3d', nativeShell: true, desktopNativeShell: true, saveAs: true };
    expect((await saveProjectSession(options)).cancelled).toBe(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await expect(saveProjectSession({ ...options, desktopNativeShell: false })).rejects.toThrow('Pack project');
  });
});
