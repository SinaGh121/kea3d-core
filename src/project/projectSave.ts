import { serializeKea3dProject, type Kea3dProjectSession } from './projectFormat';

type NativeBackedFile = File & { kea3dSourcePath?: string };

export interface ProjectSaveResult {
  cancelled: boolean;
  session: Kea3dProjectSession;
  message: string;
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
    return { cancelled: false, session, message: 'Project downloaded' };
  }

  let destination = saveAs || !desktopNativeShell ? null : sourcePath;
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
    await invoke('save_project_file_atomic', { path: destination, contents: Array.from(bytes) });
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
