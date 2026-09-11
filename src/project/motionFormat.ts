export type MotionStep =
  | { type: 'sequence' | 'parallel'; steps: MotionStep[] }
  | { type: 'wait'; durationMs: number }
  | { type: 'joint'; instance: string; to?: number; by?: number; durationMs?: number; speed?: number }
  | { type: 'frame'; instance: string; clip: string; timeMs?: number; frame?: number; fps?: number; durationMs: number };
export interface ProjectMotion { id: string; name: string; repeat: number | 'forever'; steps: MotionStep[] }

export function parseMotions(value: unknown): ProjectMotion[] {
  if (value === undefined) return [];
  const fail = (message: string): never => { throw new Error(`Invalid project motion: ${message}`); };
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('expected an object.');
    return v as Record<string, unknown>;
  };
  const text = (v: unknown): string => typeof v === 'string' && v.trim().length > 0 && v.length <= 256 ? v : fail('invalid name or reference.');
  const number = (v: unknown, min = -1e9, max = 1e9): number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail('number is outside the allowed range.');
  if (!Array.isArray(value) || value.length > 64) return fail('expected at most 64 motions.');
  let count = 0;
  const step = (v: unknown, depth: number): MotionStep => {
    if (++count > 4096 || depth > 16) return fail('too many steps or nesting levels.');
    const r = record(v);
    if (r.type === 'sequence' || r.type === 'parallel') {
      if (!Array.isArray(r.steps) || r.steps.length === 0) return fail('group must have steps.');
      return { type: r.type, steps: r.steps.map(s => step(s, depth + 1)) };
    }
    if (r.type === 'wait') return { type: 'wait', durationMs: number(r.durationMs, 0, 3_600_000) };
    if (r.type === 'joint') {
      if ((r.to === undefined) === (r.by === undefined)) return fail('joint requires exactly one of to or by.');
      if ((r.durationMs === undefined) === (r.speed === undefined)) return fail('joint requires exactly one of durationMs or speed.');
      return { type: 'joint', instance: text(r.instance),
        ...(r.to === undefined ? { by: number(r.by) } : { to: number(r.to) }),
        ...(r.speed === undefined ? { durationMs: number(r.durationMs, 0, 3_600_000) } : { speed: number(r.speed, 1e-9) }) };
    }
    if (r.type === 'frame') {
      if (r.speed !== undefined) return fail('frame transitions use durationMs, not speed.');
      if ((r.timeMs === undefined) === (r.frame === undefined)) return fail('frame requires timeMs or frame with fps.');
      if (r.timeMs !== undefined && r.fps !== undefined) return fail('fps is only valid with frame.');
      if (r.frame !== undefined && !Number.isSafeInteger(r.frame)) return fail('frame must be an integer.');
      return { type: 'frame', instance: text(r.instance), clip: text(r.clip), durationMs: number(r.durationMs, 0, 3_600_000),
        ...(r.timeMs !== undefined ? { timeMs: number(r.timeMs, 0) } : { frame: number(r.frame, 0), fps: number(r.fps, 1e-6, 1000) }) };
    }
    return fail('unknown step type.');
  };
  const ids = new Set<string>();
  return value.map(v => {
    const r = record(v), id = text(r.id);
    if (ids.has(id)) return fail('duplicate motion ID.');
    ids.add(id);
    if (!Array.isArray(r.steps) || r.steps.length === 0) return fail('motion must have steps.');
    const repeat = r.repeat ?? 1;
    if (repeat !== 'forever' && (!Number.isSafeInteger(repeat) || number(repeat, 1, 10000) < 1)) return fail('invalid repeat count.');
    return { id, name: text(r.name), repeat: repeat as number | 'forever', steps: r.steps.map(s => step(s, 0)) };
  });
}
