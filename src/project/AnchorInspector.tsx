import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';

type AnchorInspectorProps = {
  mode: 'rows';
  rows: Array<[string, string]>;
} | {
  mode: 'selection';
  id: string;
  parent: string;
  position: string;
  rotation: string;
} | {
  mode: 'visibility';
  count: number;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
};

export default function AnchorInspector(props: AnchorInspectorProps) {
  if (props.mode === 'rows') {
    return (
      <dl className="grid gap-1">
        {props.rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[94px_minmax(0,1fr)] gap-3 text-xs leading-5">
            <dt className="text-muted-foreground">{label}</dt><dd className="m-0 [overflow-wrap:anywhere] text-right font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  if (props.mode === 'visibility') {
    return (
      <>
        <div className="flex min-h-8 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium">Show Anchors</p>
            <p className="text-[10px] text-muted-foreground">{props.count} {props.count === 1 ? 'frame' : 'frames'} in this model</p>
          </div>
          <Switch checked={props.visible} aria-label="Show Anchors" onCheckedChange={props.onVisibleChange} />
        </div>
        <Separator />
      </>
    );
  }

  return (
    <dl className="grid gap-1 text-[10px] leading-4">
      <div className="grid grid-cols-[62px_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">ID</dt><dd className="truncate font-semibold" title={props.id}>{props.id}</dd></div>
      <div className="grid grid-cols-[62px_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">Parent</dt><dd className="truncate font-semibold" title={props.parent}>{props.parent}</dd></div>
      <div className="grid grid-cols-[62px_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">Position</dt><dd className="font-semibold tabular-nums [overflow-wrap:anywhere]">{props.position}</dd></div>
      <div className="grid grid-cols-[62px_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">Rotation</dt><dd className="font-semibold tabular-nums [overflow-wrap:anywhere]">{props.rotation}</dd></div>
    </dl>
  );
}
