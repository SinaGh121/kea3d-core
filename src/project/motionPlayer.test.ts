import { describe, expect, it } from 'vitest';
import { AnimationClip, Group, Mesh, NumberKeyframeTrack, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { parseMotions, type ProjectMotion } from './motionFormat';
import { MotionPlayer, type MotionResolver } from './motionPlayer';
import { sceneMotionResolver } from './motionScene';
import { KEA3D_PROJECT_SCHEMA_V2, type Kea3dProjectDocument } from './projectFormat';
import { buildFixedAssemblyScene } from './assemblyScene';
import { decodeKea3dPackage, encodeKea3dPackage } from './projectPackage';

function jointRig() {
  const values: Record<string, number> = { a: 0, b: 0 };
  const resolver: MotionResolver = {
    joint: id => ({ min: -10, max: 10, channel: { id, read: () => [values[id]], write: v => { values[id] = v[0]; } } }),
    frame: () => [],
  };
  return { values, resolver };
}
function motion(steps: ProjectMotion['steps'], repeat: ProjectMotion['repeat'] = 1): ProjectMotion {
  return parseMotions([{ id: 'demo', name: 'Demo', steps, repeat }])[0];
}
describe('project motion playback', () => {
  it('lands exactly at a rotational limit without floating-point overshoot', () => {
    let value = -Math.PI / 6;
    const max = Math.PI / 18;
    const resolver: MotionResolver = { frame: () => [], joint: () => ({ min: value, max, channel: {
      id: 'rotor', read: () => [value], write: v => { expect(v[0]).toBeLessThanOrEqual(max); value = v[0]; },
    } }) };
    const player = new MotionPlayer(motion([{ type: 'joint', instance: 'rotor', to: max, durationMs: 1000 }]), resolver);
    player.play(); player.update(1); expect(value).toBe(max);
  });
  it('runs parallel barriers, waits, speed and relative moves', () => {
    const { values, resolver } = jointRig();
    const player = new MotionPlayer(motion([
      { type: 'parallel', steps: [{ type: 'joint', instance: 'a', to: 2, durationMs: 1000 }, { type: 'joint', instance: 'b', to: 4, speed: 2 }] },
      { type: 'wait', durationMs: 500 }, { type: 'joint', instance: 'a', by: 2, durationMs: 1000 },
    ]), resolver);
    expect(player.duration).toBe(3.5);
    player.seek(0.5); expect(values).toEqual({ a: 1, b: 1 });
    player.seek(2.25); expect(values).toEqual({ a: 2, b: 4 });
    player.seek(3); expect(values).toEqual({ a: 3, b: 4 });
    player.restart(); expect(values).toEqual({ a: 0, b: 0 });
  });
  it('repeats from captured baseline, pauses and finishes finite repeat', () => {
    const { values, resolver } = jointRig(); values.a = 1;
    const player = new MotionPlayer(motion([{ type: 'joint', instance: 'a', by: 2, durationMs: 1000 }], 2), resolver);
    player.play(); player.update(1.5); expect(values.a).toBe(2);
    player.playing = false; player.update(10); expect(values.a).toBe(2);
    player.play(); player.update(0.5); expect(values.a).toBe(3); expect(player.playing).toBe(false);
    player.restart(); expect(values.a).toBe(1);
    player.repeat = 'forever'; player.play(); player.update(100.5); expect(values.a).toBe(2);
  });
  it('rejects conflicts, limit violations, zero duration and malformed input', () => {
    const { resolver } = jointRig();
    const step = { type: 'joint' as const, instance: 'a', to: 1, durationMs: 1000 };
    expect(() => new MotionPlayer(motion([{ type: 'parallel', steps: [step, step] }]), resolver)).toThrow('conflicts');
    expect(() => new MotionPlayer(motion([{ ...step, to: 11 }]), resolver)).toThrow('limits');
    expect(() => new MotionPlayer(motion([{ type: 'wait', durationMs: 0 }], 'forever'), resolver)).toThrow('positive');
    expect(() => parseMotions([{ id: 'x', name: 'X', steps: [{ ...step, by: 1 }] }])).toThrow('exactly one');
    expect(() => parseMotions([{ id: 'x', name: 'X', steps: [{ type: 'frame', instance: 'a', clip: 'x', frame: 2, durationMs: 200 }] }])).toThrow();
  });
});

describe('direct clip frame transitions', () => {
  const document: Kea3dProjectDocument = { $schema: KEA3D_PROJECT_SCHEMA_V2, format: 'kea3d-project', version: 2, name: 'Frame', rootInstance: 'part', resources: [{ id: 'model', uri: 'model.glb' }], instances: [{ id: 'part', resource: 'model' }] };
  it('retains motion definitions and initial joint state through package save/reopen', async () => {
    const project = { ...document, motions: [motion([{ type: 'wait', durationMs: 500 }], 3)] };
    const bytes = await encodeKea3dPackage({ document: project, manifestFile: new File([JSON.stringify(project)], 'project.kea3d'), resourceFiles: new Map([['model', new File(['glTF'], 'model.glb')]]) });
    expect(decodeKea3dPackage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer).document).toEqual(project);
  });
  it('isolates duplicated clip UUIDs between instances', () => {
    const base = new Group(), anchor = new Group(); anchor.userData = { kea3d: { anchor: { version: 1, id: 'mount' } } }; base.add(anchor);
    const source = new Group(), child = new Group(); source.add(child);
    const clip = new AnimationClip('poses', 1, [new VectorKeyframeTrack(`${child.uuid}.position`, [0, 1], [0, 0, 0, 0, 2, 0])]);
    const doc: Kea3dProjectDocument = { ...document, rootInstance: 'base', resources: [{ id: 'base', uri: 'base.glb' }, ...document.resources], instances: [
      { id: 'base', resource: 'base' }, ...['left', 'right'].map(id => ({ id, resource: 'model', attachment: { targetInstance: 'base', targetAnchor: 'mount' } })),
    ] };
    const assembly = buildFixedAssemblyScene(doc, new Map([['base', base], ['model', source]]));
    const player = new MotionPlayer(motion([{ type: 'frame', instance: 'left', clip: 'poses', timeMs: 1000, durationMs: 200 }]), sceneMotionResolver(assembly, doc, new Map([['model', [clip]]])));
    player.seek(0.2);
    expect(assembly.getObjectByName('left')!.children[0].children[0].position.y).toBe(2);
    expect(assembly.getObjectByName('right')!.children[0].children[0].position.y).toBe(0);
    expect(child.position.y).toBe(0);
  });
  it('goes directly from arbitrary current pose to frame 2, skipping frame 1', () => {
    const root = new Group(), node = new Mesh(); node.name = 'part'; root.add(node); node.position.x = 4;
    node.morphTargetInfluences = [0];
    const clip = new AnimationClip('poses', 2, [
      new VectorKeyframeTrack('part.position', [0, 1, 2], [0, 0, 0, 100, 0, 0, 2, 0, 0]),
      new NumberKeyframeTrack('part.morphTargetInfluences', [0, 1, 2], [0, 10, 1]),
      new QuaternionKeyframeTrack('part.quaternion', [0, 2], [0, 0, 0, 1, 0, 0, 0, -1]),
    ]);
    const player = new MotionPlayer(motion([{ type: 'frame', instance: 'part', clip: 'poses', frame: 2, fps: 1, durationMs: 200 }]), sceneMotionResolver(root, document, new Map([['model', [clip]]])));
    player.seek(0.1); expect(node.position.x).toBeCloseTo(3); expect(node.morphTargetInfluences[0]).toBeCloseTo(0.5);
    expect(Math.abs(node.quaternion.w)).toBeCloseTo(1);
    player.seek(0.2); expect(node.position.x).toBeCloseTo(2);
    player.restart(); expect(node.position.x).toBe(4);
  });
  it('rejects unknown clips and attempts to animate an attachment root', () => {
    const root = new Group(); root.name = 'root';
    const doc = { ...document, instances: [{ ...document.instances[0], attachment: { targetInstance: 'base', targetAnchor: 'mount' } }] };
    const clip = new AnimationClip('poses', 1, [new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 1, 0, 0])]);
    const resolver = sceneMotionResolver(root, doc, new Map([['model', [clip]]]));
    expect(() => resolver.frame({ type: 'frame', instance: 'part', clip: 'poses', timeMs: 500, durationMs: 100 })).toThrow('attachment');
    expect(() => resolver.frame({ type: 'frame', instance: 'part', clip: 'missing', timeMs: 0, durationMs: 100 })).toThrow('unique');
  });
});
