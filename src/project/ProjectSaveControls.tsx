import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

export default function ProjectSaveControls({
  saving,
  onSave,
  onSaveAs,
}: {
  saving: boolean;
  onSave: () => void;
  onSaveAs: () => void;
}) {
  return (
    <>
      <div className="grid gap-2 rounded-xl border bg-muted/25 p-3">
        <div>
          <p className="text-xs font-medium">Kea3D project</p>
          <p className="text-[10px] text-muted-foreground">Validated .kea3d manifest · component GLBs stay separate</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" disabled={saving} onClick={onSave}><Download /> {saving ? 'Saving…' : 'Save project'}</Button>
          <Button variant="outline" size="sm" disabled={saving} onClick={onSaveAs}>Save as…</Button>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">Desktop saves use validated atomic replacement. Save As keeps relative component paths, so keep the manifest in its project folder unless those GLBs are copied too.</p>
      </div>
      <Separator />
    </>
  );
}
