import type { MouseEvent } from 'react';
import { Code2, ExternalLink, FileBox, Scale } from 'lucide-react';
import packageMetadata from '../../package.json';
import { Button } from '@/components/ui/button';

const website = 'https://kea3d.com';
const coreSource = `https://github.com/SinaGh121/kea3d-core/releases/tag/v${packageMetadata.version}`;

export default function AboutContent({
  onOpenExternal,
  onOpenLegal,
}: {
  onOpenExternal: (event: MouseEvent<HTMLAnchorElement>, url: string) => void;
  onOpenLegal: (document: 'license' | 'thirdParty') => void;
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
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="outline" size="sm"><a href={website} target="_blank" rel="noreferrer" onClick={(event) => onOpenExternal(event, website)}><ExternalLink /> Website</a></Button>
        <Button asChild variant="outline" size="sm"><a href={coreSource} target="_blank" rel="noreferrer" onClick={(event) => onOpenExternal(event, coreSource)}><Code2 /> Core source</a></Button>
        <Button variant="outline" size="sm" onClick={() => onOpenLegal('license')}><Scale /> Core license</Button>
        <Button variant="outline" size="sm" onClick={() => onOpenLegal('thirdParty')}><FileBox /> Third-party</Button>
      </div>
      <div className="grid gap-1 text-[10px] leading-relaxed text-muted-foreground"><p>This build contains the MPL-licensed Kea3D Core. No separately licensed Pro features are included.</p><p>Model files are processed locally and are not uploaded by Kea3D.</p></div>
    </div>
  );
}

