import { validateJoint, type Kea3dJoint } from './projectFormat';

export function constrainedJointPosition(original: Kea3dJoint | undefined, proposed: Kea3dJoint | undefined): Kea3dJoint {
  if (!original || !proposed) throw new Error('This connection is fixed.');
  if (original.id !== proposed.id || original.type !== proposed.type || original.axis !== proposed.axis ||
      original.limits.min !== proposed.limits.min || original.limits.max !== proposed.limits.max) {
    throw new Error('Movement axis and limits are defined by the assembly.');
  }
  return validateJoint(proposed);
}
