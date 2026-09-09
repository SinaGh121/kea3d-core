import { describe, it, expect } from 'vitest';
import { constrainedJointPosition } from './jointMotion';
import type { Kea3dJoint } from './projectFormat';

describe('Viewer joint constraints', () => {
  const joint: Kea3dJoint = { id: 'joint', type: 'prismatic', axis: 'x', limits: { min: -0.07, max: 0.05 }, state: { position: 0 } };
  it('accepts only bounded position changes', () => {
    expect(constrainedJointPosition(joint, { ...joint, state: { position: 0.05 } }).state.position).toBe(0.05);
    for (const position of [0.051, -0.071, NaN, Infinity]) expect(() => constrainedJointPosition(joint, { ...joint, state: { position } })).toThrow();
  });
  it('rejects changes to authored axes, types, IDs and limits, including fixed connections', () => {
    expect(() => constrainedJointPosition(undefined, joint)).toThrow('fixed');
    expect(() => constrainedJointPosition(joint, undefined)).toThrow('fixed');
    for (const proposed of [{ ...joint, axis: 'y' as const }, { ...joint, type: 'revolute' as const }, { ...joint, id: 'other' }, { ...joint, limits: { min: -1, max: 1 } }]) {
      expect(() => constrainedJointPosition(joint, proposed)).toThrow('assembly');
    }
  });
});
