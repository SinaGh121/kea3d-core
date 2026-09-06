import { MathUtils, Plane, Vector3, type Box3 } from 'three';
import type { UpAxis } from './types';

const axisNormals: Record<UpAxis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};

export function sectionPlaneForBounds(
  bounds: Box3,
  axis: UpAxis,
  position: number,
  flipped: boolean,
): Plane {
  const normal = axisNormals[axis].clone();
  if (flipped) normal.negate();

  const point = bounds.min.clone();
  const axisPosition = MathUtils.lerp(bounds.min[axis], bounds.max[axis], MathUtils.clamp(position, 0, 1));
  point[axis] = axisPosition;
  return new Plane().setFromNormalAndCoplanarPoint(normal, point);
}
