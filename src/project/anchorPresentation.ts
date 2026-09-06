import { Euler, MathUtils, Quaternion } from 'three';
import type { AnchorInfo } from '../viewer/types';

export function anchorWorldRotationDegrees(anchor: Pick<AnchorInfo, 'rotation'>): [number, number, number] {
  const euler = new Euler().setFromQuaternion(new Quaternion(...anchor.rotation).normalize(), 'XYZ');
  return [euler.x, euler.y, euler.z].map((value) => MathUtils.radToDeg(value) || 0) as [number, number, number];
}
