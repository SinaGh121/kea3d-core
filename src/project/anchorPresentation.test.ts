import { describe, expect, it } from 'vitest';
import { Euler, Quaternion } from 'three';
import { anchorWorldRotationDegrees } from './anchorPresentation';

describe('anchor orientation presentation', () => {
  it('shows identity as three zero degree angles, not four quaternion components', () => {
    expect(anchorWorldRotationDegrees({ rotation: [0, 0, 0, 1] })).toEqual([0, 0, 0]);
  });
  it('uses XYZ Euler order and degrees for world orientation', () => {
    const rotation = new Quaternion().setFromEuler(new Euler(Math.PI / 6, Math.PI / 4, -Math.PI / 3, 'XYZ')).toArray();
    const angles = anchorWorldRotationDegrees({ rotation });
    [30, 45, -60].forEach((expected, index) => expect(angles[index]).toBeCloseTo(expected));
  });
});
