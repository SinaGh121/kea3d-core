import type { ForwardAxis, UpAxis } from './types';

export const forwardAxes: readonly ForwardAxis[] = ['x', '-x', 'y', '-y', 'z', '-z'];

export function forwardAxisCoordinate(axis: ForwardAxis): UpAxis {
  return axis.endsWith('x') ? 'x' : axis.endsWith('y') ? 'y' : 'z';
}

export function isForwardAxisCompatible(upAxis: UpAxis, forwardAxis: ForwardAxis): boolean {
  return forwardAxisCoordinate(forwardAxis) !== upAxis;
}

export function defaultForwardAxis(upAxis: UpAxis): ForwardAxis {
  if (upAxis === 'z') return '-y';
  return 'z';
}
