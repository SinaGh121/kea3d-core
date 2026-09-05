import { Matrix4, Quaternion, Vector3 } from 'three';
import type { ForwardAxis, UpAxis } from './types';
import { defaultForwardAxis, isForwardAxisCompatible } from './orientationAxes';
export { defaultForwardAxis, forwardAxes, forwardAxisCoordinate, isForwardAxisCompatible } from './orientationAxes';

const axisVectors: Record<ForwardAxis, Vector3> = {
  x: new Vector3(1, 0, 0),
  '-x': new Vector3(-1, 0, 0),
  y: new Vector3(0, 1, 0),
  '-y': new Vector3(0, -1, 0),
  z: new Vector3(0, 0, 1),
  '-z': new Vector3(0, 0, -1),
};

export function orientationCorrection(upAxis: UpAxis, forwardAxis: ForwardAxis): Quaternion {
  if (!isForwardAxisCompatible(upAxis, forwardAxis)) {
    throw new Error('Forward direction must use a different axis than Up.');
  }

  const up = axisVectors[upAxis].clone();
  const forward = axisVectors[forwardAxis].clone();
  const right = up.clone().cross(forward).normalize();
  const sourceBasis = new Matrix4().makeBasis(right, up, forward);
  return new Quaternion().setFromRotationMatrix(sourceBasis.invert()).normalize();
}

export function upAxisCorrection(axis: UpAxis): Quaternion {
  return orientationCorrection(axis, defaultForwardAxis(axis));
}
