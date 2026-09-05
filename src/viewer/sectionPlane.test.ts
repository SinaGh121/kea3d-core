import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { sectionPlaneForBounds } from './sectionPlane';

const bounds = new Box3(new Vector3(-2, 10, 20), new Vector3(6, 30, 50));

describe('sectionPlaneForBounds', () => {
  it('places the plane at the normalized position along an axis', () => {
    const plane = sectionPlaneForBounds(bounds, 'x', 0.25, false);

    expect(plane.normal.toArray()).toEqual([1, 0, 0]);
    expect(plane.distanceToPoint(new Vector3(0, 10, 20))).toBeCloseTo(0);
    expect(plane.distanceToPoint(new Vector3(-1, 10, 20))).toBeLessThan(0);
  });

  it('reverses the clipped side without moving the plane', () => {
    const plane = sectionPlaneForBounds(bounds, 'z', 0.5, true);

    expect(plane.normal.x).toBeCloseTo(0);
    expect(plane.normal.y).toBeCloseTo(0);
    expect(plane.normal.z).toBeCloseTo(-1);
    expect(plane.distanceToPoint(new Vector3(0, 0, 35))).toBeCloseTo(0);
    expect(plane.distanceToPoint(new Vector3(0, 0, 40))).toBeLessThan(0);
  });
});
