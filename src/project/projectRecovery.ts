import {
  acceptProjectResourceChanges,
  decodeKea3dProject,
  removeProjectResources,
  type Kea3dProjectDocument,
  type ProjectResourceRecoveryIssue,
} from './projectFormat';

type RecoveryState = { files: File[]; issues: ProjectResourceRecoveryIssue[] };

function projectFileWithDocument(projectFile: File, project: Kea3dProjectDocument): File {
  const next = new File([`${JSON.stringify(project, null, 2)}\n`], projectFile.name, {
    type: projectFile.type || 'application/json',
    lastModified: Date.now(),
  });
  if (projectFile.webkitRelativePath) {
    Object.defineProperty(next, 'webkitRelativePath', { value: projectFile.webkitRelativePath });
  }
  const sourcePath = (projectFile as File & { kea3dSourcePath?: string }).kea3dSourcePath;
  if (sourcePath) Object.defineProperty(next, 'kea3dSourcePath', { value: sourcePath });
  return next;
}

function expectedResourcePath(projectFile: File, uri: string): string {
  const projectPath = (projectFile.webkitRelativePath || projectFile.name).replaceAll('\\', '/').replace(/^\.\//, '');
  const slash = projectPath.lastIndexOf('/');
  return `${slash >= 0 ? projectPath.slice(0, slash + 1) : ''}${uri}`;
}

function fileAtPath(file: File, relativePath: string): File {
  const next = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
  Object.defineProperty(next, 'webkitRelativePath', { value: relativePath });
  return next;
}

export function locateProjectResources(recovery: RecoveryState, fileList: FileList | File[]): { files: File[]; matchedAll: boolean } {
  const selected = Array.from(fileList).filter((file) => /\.glb$/i.test(file.name));
  const projectFile = recovery.files.find((file) => /\.kea3d$/i.test(file.name));
  if (!projectFile || selected.length === 0) throw new Error('Choose one or more GLB resource files.');

  const replacements: File[] = [];
  const matchedIds = new Set<string>();
  for (const file of selected) {
    const path = (file.webkitRelativePath || file.name).replaceAll('\\', '/').toLowerCase();
    let matches = recovery.issues.filter((issue) => path.endsWith(issue.uri.toLowerCase()));
    if (matches.length === 0) {
      matches = recovery.issues.filter((issue) => issue.uri.split('/').pop()?.toLowerCase() === file.name.toLowerCase());
    }
    if (matches.length === 0 && recovery.issues.length === 1 && selected.length === 1) matches = recovery.issues;
    if (matches.length !== 1) continue;
    replacements.push(fileAtPath(file, expectedResourcePath(projectFile, matches[0].uri)));
    matchedIds.add(matches[0].resourceId);
  }
  if (replacements.length === 0) throw new Error('The selected GLB files do not match the resources that need attention.');
  return {
    files: [projectFile, ...replacements, ...recovery.files.filter((file) => file !== projectFile)],
    matchedAll: matchedIds.size === recovery.issues.length,
  };
}

export async function rewriteProjectResources(recovery: RecoveryState, mode: 'accept' | 'remove'): Promise<File[]> {
  const projectFile = recovery.files.find((file) => /\.kea3d$/i.test(file.name));
  if (!projectFile) throw new Error('The project manifest is unavailable.');
  const project = decodeKea3dProject(await projectFile.arrayBuffer());
  const resourceIds = new Set(recovery.issues
    .filter((issue) => mode === 'accept' ? issue.kind === 'changed' : !issue.requiredByRoot)
    .map((issue) => issue.resourceId));
  if (resourceIds.size === 0) return recovery.files;
  const nextProject = mode === 'accept'
    ? acceptProjectResourceChanges(project, resourceIds)
    : removeProjectResources(project, resourceIds);
  return [projectFileWithDocument(projectFile, nextProject), ...recovery.files.filter((file) => file !== projectFile)];
}
