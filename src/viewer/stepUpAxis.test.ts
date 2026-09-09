import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { orientationCorrection } from './modelAdjustments';

it('preserves STEP Y-up and original front across platforms', async () => {
  const { stepUpAxis, stepForwardAxis } = await import('./stepUpAxis');
  const rotation = orientationCorrection(stepUpAxis, stepForwardAxis);
  expect(new Vector3(0, 1, 0).applyQuaternion(rotation).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
  expect(new Vector3(0, 0, 1).applyQuaternion(rotation).distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6);
});
