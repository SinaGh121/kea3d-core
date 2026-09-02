import { useState, type FormEvent } from 'react';
import { Check, Plus, Redo2, Trash2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import type { AnchorEditInput } from './componentAnchors';

type AnchorInspectorProps = {
  mode: 'rows';
  rows: Array<[string, string]>;
} | {
  mode: 'selection';
  id: string;
  parent: string;
  position: string;
  rotation: string;
  onEdit?: () => void;
} | {
  mode: 'visibility';
  count: number;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  onCreate?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
} | {
  mode: 'editor';
  value: AnchorEditInput;
  parent: string;
  onApply: (value: AnchorEditInput) => void;
  onDelete: () => void;
  onCancel: () => void;
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
        {(props.onCreate || props.onUndo || props.onRedo) && (
          <div className="grid grid-cols-3 gap-1.5">
            <Button size="sm" variant="outline" disabled={!props.onCreate} onClick={props.onCreate}><Plus /> Create</Button>
            <Button aria-label="Revert scene change" size="sm" variant="outline" disabled={!props.canUndo} onClick={props.onUndo}><Undo2 /> Undo</Button>
            <Button aria-label="Repeat scene change" size="sm" variant="outline" disabled={!props.canRedo} onClick={props.onRedo}><Redo2 /> Redo</Button>
          </div>
        )}
        <Separator />
      </>
    );
  }

  if (props.mode === 'editor') return <AnchorEditor {...props} />;

  return (
    <div className="grid gap-2">
      <dl className="grid gap-1 text-[10px] leading-4">
        <div className="grid grid-cols-[62px_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">ID</dt><dd className="truncate font-semibold" title={props.id}>{props.id}</dd></div>
        <div className="grid grid-cols-[62px_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">Parent</dt><dd className="truncate font-semibold" title={props.parent}>{props.parent}</dd></div>
        <div className="grid grid-cols-[62px_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">Position</dt><dd className="font-semibold tabular-nums [overflow-wrap:anywhere]">{props.position}</dd></div>
        <div className="grid grid-cols-[62px_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">Rotation</dt><dd className="font-semibold tabular-nums [overflow-wrap:anywhere]">{props.rotation}</dd></div>
      </dl>
      {props.onEdit && <Button size="sm" variant="outline" onClick={props.onEdit}>Edit Anchor</Button>}
    </div>
  );
}

function AnchorEditor(props: Extract<AnchorInspectorProps, { mode: 'editor' }>) {
  const [id, setId] = useState(props.value.id);
  const [name, setName] = useState(props.value.name);
  const [position, setPosition] = useState(props.value.position.map(String));
  const [rotation, setRotation] = useState(props.value.rotation.map((value) => String(Math.round(value * 1e6) / 1e6)));
  const validNumbers = [...position, ...rotation].every((value) => value.trim() !== '' && Number.isFinite(Number(value)));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!validNumbers) return;
    props.onApply({
      id,
      name,
      position: position.map(Number) as [number, number, number],
      rotation: rotation.map(Number) as [number, number, number],
    });
  };
  const vectorFields = (label: string, values: string[], setValues: (values: string[]) => void) => (
    <fieldset className="grid gap-1">
      <legend className="text-[10px] text-muted-foreground">{label}</legend>
      <div className="grid grid-cols-3 gap-1.5">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <label key={axis} className="grid gap-0.5 text-[9px] text-muted-foreground">{axis}
            <Input aria-label={`${label} ${axis}`} inputMode="decimal" value={values[index]} onChange={(event) => setValues(values.map((value, valueIndex) => valueIndex === index ? event.target.value : value))} className="h-8 px-2 text-xs tabular-nums" />
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <form className="grid gap-2" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="grid gap-0.5 text-[9px] text-muted-foreground">Name<Input aria-label="Anchor name" value={name} maxLength={128} onChange={(event) => setName(event.target.value)} className="h-8 px-2 text-xs" /></label>
        <label className="grid gap-0.5 text-[9px] text-muted-foreground">Stable ID<Input aria-label="Anchor ID" value={id} maxLength={128} onChange={(event) => setId(event.target.value)} className="h-8 px-2 font-mono text-xs" /></label>
      </div>
      <p className="truncate text-[9px] text-muted-foreground" title={props.parent}>Parent: {props.parent}</p>
      {vectorFields('Local position', position, setPosition)}
      {vectorFields('Local rotation °', rotation, setRotation)}
      <div className="grid grid-cols-3 gap-1.5">
        <Button type="button" size="sm" variant="destructive" onClick={props.onDelete}><Trash2 /> Delete</Button>
        <Button type="button" size="sm" variant="outline" onClick={props.onCancel}><X /> Cancel</Button>
        <Button type="submit" size="sm" disabled={!validNumbers || !id.trim() || !name.trim()}><Check /> Apply</Button>
      </div>
    </form>
  );
}
