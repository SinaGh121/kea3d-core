import { Boxes, Check, FolderOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProjectResourceRecoveryIssue } from './projectFormat';

export default function ProjectRecoveryPanel({
  issues,
  compact,
  nativeShell,
  android = false,
  folderMissing = [],
  folderMessage,
  folderBusy = false,
  onAllowFolder,
  onClose,
  onLocate,
  onChooseFolder,
  onAcceptChanged,
  onRemoveOptional,
}: {
  issues: ProjectResourceRecoveryIssue[];
  compact: boolean;
  nativeShell: boolean;
  android?: boolean;
  folderMissing?: string[];
  folderMessage?: string;
  folderBusy?: boolean;
  onAllowFolder?: () => void;
  onClose: () => void;
  onLocate: () => void;
  onChooseFolder: () => void;
  onAcceptChanged: () => void;
  onRemoveOptional: () => void;
}) {
  return (
    <aside
      aria-label="Project resources"
      className={cn(
        'z-40 flex flex-col gap-3 border bg-card/96 p-4 text-card-foreground shadow-2xl backdrop-blur-md',
        compact
          ? 'absolute inset-x-0 bottom-0 h-[min(48dvh,30rem)] overflow-y-auto rounded-t-2xl border-x-0 border-b-0'
          : 'absolute top-20 right-5 max-h-[calc(100%_-_100px)] w-[360px] overflow-y-auto rounded-xl',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Project resources</h2><p className="text-[11px] text-muted-foreground">Resolve local components without modifying source files</p></div>
        <Button variant="ghost" size="icon-sm" aria-label="Close project resources" onClick={onClose}><X /></Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">Resolve these resources to open the project. Source files are not modified.</p>
      {android && <div className="rounded-lg border p-3 text-xs leading-relaxed">
        <strong>Project folder access</strong>
        <p>Opening a .kea3d file does not automatically grant access to its companion files. Unresolved files are not confirmed missing until the selected folder is checked.</p>
        <ol className="mt-2 list-decimal pl-4"><li>Choose the folder containing the .kea3d file, not its components subfolder.</li><li>Tap Use this folder, then Allow if Android asks.</li></ol>
        <p className="mt-2">If Android disables folder selection, use a project subfolder instead of the Downloads root, select files with Locate or replace, or open a .kea3dp package.</p>
        {folderMessage && <p role="status" className="mt-2">{folderMessage}</p>}
        {onAllowFolder && <Button className="mt-2 min-h-11 w-full" disabled={folderBusy} onClick={onAllowFolder}><FolderOpen />{folderBusy ? 'Checking folder...' : 'Allow folder access'}</Button>}
      </div>}
      <div className="grid gap-2">
        {issues.map((issue) => (
          <div key={issue.resourceId} className="rounded-lg border bg-muted/30 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <strong className="truncate text-xs">{issue.uri}</strong>
              <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] capitalize text-muted-foreground">{android && issue.kind === 'missing' ? folderMissing.includes(issue.uri) ? 'Not in folder' : 'Access needed' : issue.kind}</span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{android && issue.kind === 'missing' ? folderMissing.includes(issue.uri) ? 'Not found at this path in the folder you selected. Check that you chose the project folder and that this file is present.' : 'Grant access to the project folder or select this resource file. Its presence has not been checked.' : issue.message}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 [&_[data-slot=button]]:min-h-11">
        <Button size="sm" disabled={folderBusy} onClick={onLocate}><FolderOpen /> Locate or replace</Button>
        {!nativeShell && <Button variant="outline" size="sm" onClick={onChooseFolder}><Boxes /> Choose folder</Button>}
        {issues.some((issue) => issue.kind === 'changed') && <Button disabled={folderBusy} variant="outline" size="sm" onClick={onAcceptChanged}><Check /> Use changed files</Button>}
        {issues.some((issue) => !issue.requiredByRoot) && <Button disabled={folderBusy} variant="outline" size="sm" onClick={onRemoveOptional}><X /> Remove optional</Button>}
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">Recovery changes are session-only. The `.kea3d` manifest and referenced GLBs remain untouched.</p>
    </aside>
  );
}
