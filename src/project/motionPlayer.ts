import { Quaternion } from 'three';
import type { MotionStep, ProjectMotion } from './motionFormat';
export interface MotionChannel { id: string; quaternion?: boolean; read(): number[]; write(value: number[]): void }
export interface MotionTarget { channel: MotionChannel; value: number[] }
export interface MotionResolver {
  joint(instance: string): { channel: MotionChannel; min: number; max: number };
  frame(step: Extract<MotionStep, { type: 'frame' }>): MotionTarget[];
}
interface Segment { channel: MotionChannel; from: number[]; to: number[]; start: number; end: number }

// Capture the displayed pose once. Seeking and repeat never accumulate relative moves.
export class MotionPlayer {
  readonly duration: number;
  readonly segments: Segment[] = [];
  private readonly baseline = new Map<MotionChannel, number[]>();
  private elapsed = 0;
  private atEndpoint = false;
  playing = false;
  speed = 1;
  repeat: number | 'forever';
  constructor(readonly motion: ProjectMotion, resolver: MotionResolver) {
    this.repeat = motion.repeat;
    const channels = new Map<string, MotionChannel>();
    const add = (channel: MotionChannel, to: number[], start: number, duration: number, state: Map<string, number[]>) => {
      const canonical = channels.get(channel.id) ?? channel;
      channels.set(channel.id, canonical);
      if (!this.baseline.has(canonical)) this.baseline.set(canonical, canonical.read());
      const from = state.get(channel.id) ?? this.baseline.get(canonical)!;
      if (![...from, ...to, start, duration].every(Number.isFinite) || from.length !== to.length) throw new Error('Invalid animation channel values.');
      this.segments.push({ channel: canonical, from: [...from], to, start, end: start + duration });
      state.set(channel.id, to);
    };
    const compile = (steps: MotionStep[], start: number, state: Map<string, number[]>): number => {
      let cursor = start;
      for (const step of steps) {
        if (step.type === 'sequence') cursor = compile(step.steps, cursor, state);
        else if (step.type === 'parallel') {
          const writes = new Set<string>();
          const ends = step.steps.map(child => {
            const first = this.segments.length, branch = new Map(state);
            const end = compile([child], cursor, branch);
            const own = new Set(this.segments.slice(first).map(s => s.channel.id));
            for (const id of own) {
              if (writes.has(id)) throw new Error(`Parallel motion conflicts on ${id}.`);
              writes.add(id);
            }
            return { end, branch, own };
          });
          for (const { branch, own } of ends) for (const id of own) state.set(id, branch.get(id)!);
          cursor = Math.max(...ends.map(e => e.end));
        } else if (step.type === 'wait') cursor += step.durationMs / 1000;
        else if (step.type === 'joint') {
          const { channel, min, max } = resolver.joint(step.instance);
          const from = state.get(channel.id)?.[0] ?? channel.read()[0], to = step.to ?? from + step.by!;
          if (to < min || to > max) throw new Error(`Motion target for ${step.instance} exceeds joint limits.`);
          const duration = step.durationMs !== undefined ? step.durationMs / 1000 : Math.abs(to - from) / step.speed!;
          add(channel, [to], cursor, duration, state); cursor += duration;
        } else if (step.type === 'frame') {
          for (const target of resolver.frame(step)) add(target.channel, target.value, cursor, step.durationMs / 1000, state);
          cursor += step.durationMs / 1000;
        }
        if (cursor > 86400 || this.segments.length > 32768) throw new Error('Motion exceeds playback limits.');
      }
      return cursor;
    };
    this.duration = compile(motion.steps, 0, new Map());
    if (this.duration <= 0) throw new Error('Motion must have a positive duration.');
  }
  get time(): number { return this.atEndpoint ? this.duration : this.elapsed % this.duration; }
  restart(): void { this.elapsed = 0; this.atEndpoint = false; this.playing = false; this.apply(0); }
  seek(time: number): void { this.elapsed = Math.max(0, Math.min(this.duration, time)); this.atEndpoint = this.elapsed === this.duration; this.apply(this.elapsed); }
  play(): void {
    if (this.repeat !== 'forever' && this.elapsed >= this.duration * this.repeat) this.restart();
    this.playing = true;
  }
  update(delta: number): void {
    if (!this.playing || !Number.isFinite(delta) || delta < 0) return;
    this.elapsed += delta * this.speed;
    this.atEndpoint = false;
    if (this.repeat !== 'forever' && this.elapsed >= this.duration * this.repeat) {
      this.elapsed = this.duration * this.repeat; this.atEndpoint = true; this.playing = false; this.apply(this.duration);
    } else this.apply(this.elapsed % this.duration);
  }
  private apply(time: number): void {
    const values = new Map<MotionChannel, number[]>(this.baseline);
    for (const s of this.segments) {
      if (time < s.start) continue;
      const t = s.end === s.start ? 1 : Math.min(1, (time - s.start) / (s.end - s.start));
      const result = t === 1 ? [...s.to] : s.from.map((v, i) => v + (s.to[i] - v) * t);
      if (s.channel.quaternion) Quaternion.slerpFlat(result, 0, s.from, 0, s.to, 0, t);
      values.set(s.channel, result);
    }
    for (const [channel, value] of values) channel.write(value);
  }
}
