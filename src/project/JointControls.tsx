import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { constrainedJointPosition } from './jointMotion';
import type { Kea3dJoint, Kea3dProjectInstance } from './projectFormat';

const display = (value: number) => String(Number(value.toFixed(6)));
interface Props {
  selectedInstance?: string;
  instances: Kea3dProjectInstance[];
  onPreview: (id: string, joint?: Kea3dJoint) => void;
  onApply: (id: string, joint?: Kea3dJoint) => void | Promise<void>;
  onCancel: () => void;
  onDrag: (id: string, joint: Kea3dJoint, notify: (value: number) => void) => void;
  onStopDrag: () => void;
}

export default function JointControls(props: Props) {
  const connections = props.instances.filter(i => i.attachment);
  const [selection, setSelection] = useState({ external: props.selectedInstance, id: props.selectedInstance ?? connections[0]?.id ?? '' });
  // Resolve external selection before mounting motion effects for another part.
  if (selection.external !== props.selectedInstance) {
    setSelection({ external: props.selectedInstance, id: props.selectedInstance ?? selection.id });
  }
  const id = selection.id;
  const instance = connections.find(i => i.id === id) ?? connections[0];
  if (!instance) return null;
  return <section aria-label="Connection motion" className="grid gap-3 rounded-xl border p-3">
    <h3 className="text-sm font-medium">Connection motion</h3>
    <label className="grid gap-1 text-xs">Part
      <Select value={instance.id} onValueChange={id => setSelection({ external: props.selectedInstance, id })}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{connections.map(i => <SelectItem key={i.id} value={i.id}>{i.id}</SelectItem>)}</SelectContent>
      </Select>
    </label>
    <Motion key={instance.id + JSON.stringify(instance.attachment?.joint)} {...props} instance={instance} />
  </section>;
}

function Motion({ instance, ...props }: Props & { instance: Kea3dProjectInstance }) {
  const joint = instance.attachment?.joint;
  const factor = joint?.type === 'revolute' ? 180 / Math.PI : 100;
  const unit = joint?.type === 'revolute' ? 'deg' : 'cm';
  const [position, setPosition] = useState(display((joint?.state.position ?? 0) * factor));
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const callbacks = useRef(props);
  useEffect(() => { callbacks.current = props; });
  useEffect(() => {
    if (!dirty && joint && joint.limits.min !== joint.limits.max) {
      try { callbacks.current.onDrag(instance.id, joint, value => setPosition(display(value * factor))); }
      catch (e) { setError((e as Error).message); }
    }
  }, [dirty, instance.id, joint, factor]);
  useEffect(() => () => { callbacks.current.onStopDrag(); callbacks.current.onCancel(); }, []);
  const read = (value = position) => constrainedJointPosition(joint, joint && {
    ...joint, state: { position: value.trim() ? Number(value) / factor : NaN },
  });
  const preview = (value: string) => {
    props.onStopDrag();
    setPosition(value); setDirty(true);
    try { props.onPreview(instance.id, read(value)); setError(''); }
    catch (e) { props.onCancel(); setError((e as Error).message); }
  };
  if (!joint) return <p className="text-xs text-muted-foreground">Fixed connection. Movement is disabled by the assembly.</p>;
  return <>
    <p className="text-xs text-muted-foreground">{joint.type === 'revolute' ? 'Rotate R' : 'Slide '}{joint.axis.toUpperCase()}
      {' · '}{display(joint.limits.min * factor)} to {display(joint.limits.max * factor)} {unit}</p>
    <p className="text-xs text-muted-foreground">Axis and limits are defined by the assembly, in the parent Anchor frame.</p>
    <p className="text-xs text-muted-foreground">{dirty ? 'Apply or cancel the numeric edit to resume dragging.' : 'Drag the highlighted child. Release to keep the change. Esc cancels. Drag empty space to orbit.'}</p>
    <label className="grid gap-1 text-xs">Position ({unit})<Input type="number" value={position} onChange={e => preview(e.target.value)} /></label>
    <Slider aria-label="Joint position" disabled={joint.limits.min === joint.limits.max}
      min={joint.limits.min * factor} max={joint.limits.max * factor} step={unit === 'deg' ? 0.1 : 0.01}
      value={[Number(position) || 0]} onValueChange={v => preview(String(v[0]))} />
    {dirty && <div className="grid grid-cols-2 gap-2">
      <Button disabled={!dirty} onClick={async () => { try { await props.onApply(instance.id, read()); setDirty(false); setError(''); } catch (e) { setError((e as Error).message); } }}>Apply</Button>
      <Button variant="outline" disabled={!dirty} onClick={() => { props.onCancel(); setPosition(display(joint.state.position * factor)); setDirty(false); setError(''); }}>Cancel</Button>
    </div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">Movement is temporary. Undo is available. No collision simulation.</p>
  </>;
}
