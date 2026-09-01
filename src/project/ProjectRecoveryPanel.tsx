import { Boxes, Check, FolderOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProjectResourceRecoveryIssue } from './projectFormat';

export default function ProjectRecoveryPanel({
  issues,
  compact,
  nativeShell,
  onClose,
  onLocate,
  onChooseFolder,
  onAcceptChanged,
  onRemoveOptional,
}: {
  issues: ProjectResourceRecoveryIssue[];
  compact: boolean;
  nativeShell: boolean;
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
          : 'absolute top-20 right-5 w-[360px] rounded-xl',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Project resources</h2><p className="text-[11px] text-muted-foreground">Resolve local components without modifying source files</p></div>
        <Button variant="ghost" size="icon-sm" aria-label="Close project resources" onClick={onClose}><X /></Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">The current model was preserved. Resolve these resources, or close this panel to keep working.</p>
      <div className="grid gap-2">
        {issues.map((issue) => (
          <div key={issue.resourceId} className="rounded-lg border bg-muted/30 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <strong className="truncate text-xs">{issue.uri}</strong>
              <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] capitalize text-muted-foreground">{issue.kind}</span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{issue.message}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 [&_[data-slot=button]]:min-h-11">
        <Button size="sm" onClick={onLocate}><FolderOpen /> Locate or replace</Button>
        {!nativeShell && <Button variant="outline" size="sm" onClick={onChooseFolder}><Boxes /> Choose folder</Button>}
        {issues.some((issue) => issue.kind === 'changed') && <Button variant="outline" size="sm" onClick={onAcceptChanged}><Check /> Use changed files</Button>}
        {issues.some((issue) => !issue.requiredByRoot) && <Button variant="outline" size="sm" onClick={onRemoveOptional}><X /> Remove optional</Button>}
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">Recovery changes are session-only. The `.kea3d` manifest and referenced GLBs remain untouched.</p>
    </aside>
  );
}
