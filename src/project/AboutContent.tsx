import type { MouseEvent } from 'react';
import { Code2, ExternalLink, FileBox, Scale } from 'lucide-react';
import packageMetadata from '../../package.json';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { useReleaseUpdates } from './useReleaseUpdates';
import { releaseDestination } from './releaseUpdates';

const website = 'https://kea3d.com';
const source = `https://github.com/SinaGh121/kea3d-core/releases/tag/v${packageMetadata.version}`;

export default function AboutContent({
  onOpenExternal,
  onOpenLegal,
  updates,
}: {
  onOpenExternal: (event: MouseEvent<HTMLAnchorElement>, url: string) => void;
  onOpenLegal: (document: 'license' | 'thirdParty') => void;
  updates?: ReturnType<typeof useReleaseUpdates>;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
        <img className="size-12 shrink-0" src={`${import.meta.env.BASE_URL}kea3d-icon.svg`} alt="" />
        <div className="min-w-0"><p className="kea3d-wordmark text-lg font-semibold text-foreground">Kea3D</p><p className="text-[10px] leading-relaxed text-muted-foreground">Fast, private, local-first 3D and CAD viewer.</p></div>
      </div>
      <dl className="grid gap-1.5 text-[11px]">
        <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Version</dt><dd className="font-medium tabular-nums">{packageMetadata.version}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Edition</dt><dd className="text-right font-medium">Free / Core</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Processing</dt><dd className="text-right font-medium">Local on this device</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Core license</dt><dd className="font-medium">MPL 2.0</dd></div>
      </dl>
      {updates && <div className="grid gap-2 rounded-lg border p-3 text-xs">
        <label className="flex items-center justify-between gap-3">Check for updates at startup<Switch checked={updates.enabled} onCheckedChange={updates.toggle} /></label>
        <p className="text-muted-foreground">Contacts kea3d.com for release information. No model files are sent. Installation is always manual.</p>
        <Button variant="outline" size="sm" disabled={updates.status === 'checking'} onClick={() => void updates.check()}>{updates.status === 'checking' ? 'Checking…' : 'Check for updates'}</Button>
        <p role="status">{updates.status === 'current' ? 'No newer public version is available.' : updates.status === 'error' ? 'Could not check. You can try again when online.' : updates.status === 'unpublished' ? 'No public release is available for this platform yet.' : updates.status === 'available' ? `Version ${updates.version} is available.` : ''}</p>
        {updates.status === 'available' && <><Button asChild size="sm"><a href={releaseDestination(updates.platform)} target="_blank" rel="noreferrer" onClick={(event) => onOpenExternal(event, releaseDestination(updates.platform))}>{updates.platform === 'android' ? 'Open Google Play' : 'View downloads'}</a></Button><p className="text-muted-foreground">Save your work before updating. For portable apps, extract the complete new package into a new folder; keep the old folder until the new version works.</p></>}
      </div>}
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="outline" size="sm"><a href={website} target="_blank" rel="noreferrer" onClick={(event) => onOpenExternal(event, website)}><ExternalLink /> Website</a></Button>
        <Button asChild variant="outline" size="sm"><a href={source} target="_blank" rel="noreferrer" onClick={(event) => onOpenExternal(event, source)}><Code2 /> Core source</a></Button>
        <Button variant="outline" size="sm" onClick={() => onOpenLegal('license')}><Scale /> Core license</Button>
        <Button variant="outline" size="sm" onClick={() => onOpenLegal('thirdParty')}><FileBox /> Third-party</Button>
      </div>
      <div className="grid gap-1 text-[10px] leading-relaxed text-muted-foreground"><p>This build contains the MPL-licensed Kea3D Core. No separately licensed Pro features are included.</p><p>The Core source link provides source for this version. Third-party components retain their own licenses.</p><p>Model files are processed locally and are not uploaded by Kea3D.</p></div>
    </div>
  );
}
