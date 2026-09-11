import { PropertyBinding, type AnimationClip, type Interpolant, type KeyframeTrack, type Mesh, type Object3D } from 'three';
import { applyAssemblyJoint, assemblyComponents, assemblyJointPosition } from './assemblyScene';
import type { Kea3dProjectDocument } from './projectFormat';
import type { MotionResolver } from './motionPlayer';

export function sceneMotionResolver(root: Object3D, document: Kea3dProjectDocument, clips: ReadonlyMap<string, AnimationClip[]>): MotionResolver {
  return {
    joint(id) {
      const joint = document.instances.find(i => i.id === id)?.attachment?.joint;
      if (!joint) throw new Error(`Motion instance "${id}" has no movable joint.`);
      return { min: joint.limits.min, max: joint.limits.max, channel: {
        id: `${id}/joint`, read: () => [assemblyJointPosition(root, id) ?? joint.state.position],
        // Targets are validated by the compiler; clamp floating-point interpolation noise only.
        write: value => applyAssemblyJoint(root, id, { ...joint, state: { position: Math.max(joint.limits.min, Math.min(joint.limits.max, value[0])) } }),
      } };
    },
    frame(step) {
      const instance = document.instances.find(i => i.id === step.instance);
      if (!instance) throw new Error(`Motion instance "${step.instance}" was not found.`);
      const matches = (clips.get(instance.resource) ?? []).filter(c => c.name === step.clip);
      if (matches.length !== 1) throw new Error(`Animation clip "${step.clip}" must have a unique name in ${step.instance}.`);
      const clip = matches[0], time = step.timeMs !== undefined ? step.timeMs / 1000 : step.frame! / step.fps!;
      if (time > clip.duration) throw new Error(`Target frame exceeds clip "${step.clip}" duration.`);
      const pair = assemblyComponents(root)?.get(instance.id) ?? { prototype: root, component: root };
      const originals: Object3D[] = [], copies: Object3D[] = [];
      pair.prototype.traverse(n => originals.push(n)); pair.component.traverse(n => copies.push(n));
      const seen = new Set<string>();
      if (clip.tracks.length === 0 || clip.tracks.length > 4096) throw new Error('Clip has no supported channels or too many channels.');
      return clip.tracks.map(track => {
        const path = PropertyBinding.parseTrackName(track.name);
        const property = path.propertyName;
        if (path.objectName || path.propertyIndex !== undefined || !['position', 'quaternion', 'scale', 'morphTargetInfluences'].includes(property)) throw new Error(`Unsupported frame channel: ${track.name}`);
        const candidates = originals.filter(n => n.name === path.nodeName || n.uuid === path.nodeName);
        const original = !path.nodeName || path.nodeName === '.' ? pair.prototype : candidates.length === 1 ? candidates[0] : undefined;
        const node = original && copies[originals.indexOf(original)];
        if (!node) throw new Error(`Frame channel target is missing or ambiguous: ${track.name}`);
        // Never animate an attachment's coordinate frame (including Anchor ancestors).
        if ((instance.attachment || document.instances.some(i => i.attachment?.targetInstance === instance.id)) && property !== 'morphTargetInfluences') {
          let protectsAnchor = node === pair.component;
          node.traverse(n => { if (n.userData.kea3d?.anchor || /^anchor/i.test(n.name)) protectsAnchor = true; });
          if (protectsAnchor) throw new Error(`Frame channel "${track.name}" would change an attachment frame. Use joint motion instead.`);
        }
        const id = `${instance.id}/${node.uuid}/${property}`;
        if (seen.has(id)) throw new Error('Duplicate frame animation channel.');
        seen.add(id);
        const read = () => property === 'morphTargetInfluences' ? [...((node as Mesh).morphTargetInfluences ?? [])] : node[property as 'position' | 'quaternion' | 'scale'].toArray();
        const size = read().length;
        if (!size) throw new Error(`Missing animation property: ${track.name}`);
        // GLTFLoader installs its own interpolant for CUBICSPLINE tracks.
        const interpolant = (track as KeyframeTrack & { createInterpolant(): Interpolant }).createInterpolant();
        const value = Array.from(interpolant.evaluate(time)).slice(0, size) as number[];
        return { value, channel: { id, quaternion: property === 'quaternion', read,
          write(values: number[]) {
            if (property === 'morphTargetInfluences') (node as Mesh).morphTargetInfluences!.splice(0, size, ...values);
            else node[property as 'position' | 'quaternion' | 'scale'].fromArray(values);
            node.updateMatrix();
          },
        } };
      });
    },
  };
}
