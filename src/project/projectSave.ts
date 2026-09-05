import { serializeKea3dProject, type Kea3dProjectSession } from './projectFormat';

type NativeBackedFile = File & { kea3dSourcePath?: string };

export interface ProjectSaveResult {
  cancelled: boolean;
  session: Kea3dProjectSession;
  message: string;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function savePackageSession({
  session,
  nativeShell,
  desktopNativeShell,
  saveAs,
}: {
  session: Kea3dProjectSession;
  nativeShell: boolean;
  desktopNativeShell: boolean;
  saveAs: boolean;
}): Promise<ProjectSaveResult> {
  const [{ encodeKea3dPackage, packageSuggestedName }, { writeFile }] = await Promise.all([
    import('./projectPackage'),
    nativeShell ? import('@tauri-apps/plugin-fs') : Promise.resolve({ writeFile: null }),
  ]);
  const bytes = await encodeKea3dPackage(session);
  const sourcePath = (session.packageFile as NativeBackedFile | undefined)?.kea3dSourcePath ?? null;
  const suggestedName = session.packageFile?.name ?? packageSuggestedName(session);
  if (!nativeShell) {
    const url = URL.createObjectURL(new Blob([exactBuffer(bytes)], { type: 'application/vnd.kea3d.package' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    const packageFile = new File([exactBuffer(bytes)], suggestedName, { type: 'application/vnd.kea3d.package', lastModified: Date.now() });
    return { cancelled: false, session: { ...session, packageFile }, message: 'Packaged project downloaded' };
  }

  let destination = saveAs || !desktopNativeShell ? null : sourcePath;
  if (!destination) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    destination = await save({
      title: saveAs ? 'Save Packaged Project As' : 'Pack Kea3D Project',
      defaultPath: sourcePath ?? suggestedName,
      filters: [{ name: 'Kea3D Packaged Project', extensions: ['kea3dp'] }],
    });
  }
  if (!destination) return { cancelled: true, session, message: '' };
  if (!writeFile) throw new Error('The packaged project writer is unavailable.');
  if (desktopNativeShell) {
    const separator = Math.max(destination.lastIndexOf('/'), destination.lastIndexOf('\\'));
    const directory = separator >= 0 ? destination.slice(0, separator + 1) : '';
    const fileName = separator >= 0 ? destination.slice(separator + 1) : destination;
    const temporaryPath = `${directory}.${fileName}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, bytes);
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('commit_project_package_file', { temporaryPath, destinationPath: destination });
  } else {
    await writeFile(destination, bytes);
  }
  const packageFile = new File([exactBuffer(bytes)], destination.split(/[\\/]/).pop() || suggestedName, {
    type: 'application/vnd.kea3d.package',
    lastModified: Date.now(),
  });
  Object.defineProperty(packageFile, 'kea3dSourcePath', { value: destination });
  return {
    cancelled: false,
    session: { ...session, packageFile },
    message: sourcePath && !saveAs ? 'Packaged project saved' : 'Project packed as a self-contained file',
  };
}

export async function packProjectSession(options: Omit<Parameters<typeof savePackageSession>[0], 'saveAs'>): Promise<ProjectSaveResult> {
  return savePackageSession({ ...options, saveAs: true });
}

export async function saveProjectSession({
  session,
  fileName,
  nativeShell,
  desktopNativeShell,
  saveAs,
}: {
  session: Kea3dProjectSession;
  fileName: string;
  nativeShell: boolean;
  desktopNativeShell: boolean;
  saveAs: boolean;
}): Promise<ProjectSaveResult> {
  if (session.packageFile) {
    return savePackageSession({ session, nativeShell, desktopNativeShell, saveAs });
  }
  const text = serializeKea3dProject(session.document);
  const sourcePath = (session.manifestFile as NativeBackedFile).kea3dSourcePath ?? null;
  const suggestedName = fileName.toLowerCase().endsWith('.kea3d') ? fileName : `${session.document.name}.kea3d`;
  if (!nativeShell) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return { cancelled: false, session, message: 'Manifest downloaded. Keep it beside its component folders, or use Pack project to move it.' };
  }

  if (!desktopNativeShell || !sourcePath) {
    throw new Error('The original project folder cannot be verified. Use Pack project to save a self-contained copy.');
  }
  let destination = saveAs ? null : sourcePath;
  if (!destination) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    destination = await save({
      title: saveAs ? 'Save Kea3D Project As' : 'Save Kea3D Project',
      defaultPath: sourcePath ?? suggestedName,
      filters: [{ name: 'Kea3D Project', extensions: ['kea3d'] }],
    });
  }
  if (!destination) return { cancelled: true, session, message: '' };
  const bytes = new TextEncoder().encode(text);
  if (desktopNativeShell) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_project_file_atomic', { path: destination, sourcePath, contents: Array.from(bytes) });
  } else {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(destination, bytes);
  }
  const manifestFile = new File([text], destination.split(/[\\/]/).pop() || suggestedName, {
    type: 'application/json',
    lastModified: Date.now(),
  });
  Object.defineProperty(manifestFile, 'kea3dSourcePath', { value: destination });
  return {
    cancelled: false,
    session: { ...session, manifestFile },
    message: saveAs || !sourcePath ? 'Project saved as a new file' : 'Project saved',
  };
}
