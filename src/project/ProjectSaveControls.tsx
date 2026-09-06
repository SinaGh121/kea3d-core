import { useState } from 'react';
import { Archive, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { Kea3dProjectSession } from './projectFormat';
import { packProjectSession, saveProjectSession } from './projectSave';

export default function ProjectSaveControls({
  session,
  fileName,
  nativeShell,
  desktopNativeShell,
  onSessionChange,
  onError,
}: {
  session: Kea3dProjectSession;
  fileName: string;
  nativeShell: boolean;
  desktopNativeShell: boolean;
  onSessionChange: (session: Kea3dProjectSession) => void;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const packaged = Boolean(session.packageFile);
  const run = async (operation: 'save' | 'save-as' | 'pack') => {
    setSaving(true);
    try {
      const result = operation === 'pack'
        ? await packProjectSession({ session, nativeShell, desktopNativeShell })
        : await saveProjectSession({ session, fileName, nativeShell, desktopNativeShell, saveAs: operation === 'save-as' });
      if (!result.cancelled) {
        onSessionChange(result.session);
        toast.success(result.message);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The project could not be saved.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="grid gap-2 rounded-xl border bg-muted/25 p-3">
        <div>
          <p className="text-xs font-medium">{packaged ? 'Packaged Kea3D project' : 'Kea3D project'}</p>
          <p className="text-[10px] text-muted-foreground">{packaged ? 'Self-contained .kea3dp · validated manifest and required GLBs' : 'Validated .kea3d manifest · component GLBs stay separate'}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" disabled={saving} onClick={() => void run('save')}><Download /> {saving ? 'Saving…' : packaged ? 'Save package' : 'Save project'}</Button>
          <Button variant="outline" size="sm" disabled={saving} onClick={() => void run('save-as')}>Save as…</Button>
        </div>
        {!packaged && <Button variant="outline" size="sm" disabled={saving} onClick={() => void run('pack')}><Archive /> Pack project</Button>}
        <p className="text-[10px] leading-relaxed text-muted-foreground">{packaged ? 'Desktop saves replace the package atomically. Source component GLBs remain untouched.' : 'Pack creates one portable .kea3dp containing this manifest and every required GLB. Save As keeps external relative paths unchanged.'}</p>
      </div>
      <Separator />
    </>
  );
}
