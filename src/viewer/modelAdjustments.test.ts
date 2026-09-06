import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { defaultForwardAxis, forwardAxes, isForwardAxisCompatible, orientationCorrection, upAxisCorrection } from './modelAdjustments';
import { calibrationMultiplier, metricDisplayForDimensions, metricDisplayForLength, sourceUnitConversionText, unitToMeters } from './linearUnits';

describe('model adjustment helpers', () => {
  it('converts supported source units to metres', () => {
    expect(unitToMeters.um).toBe(0.000_001);
    expect(unitToMeters.mm).toBe(0.001);
    expect(unitToMeters.in).toBe(0.0254);
    expect(unitToMeters.ft).toBe(0.3048);
    expect(sourceUnitConversionText.in).toBe('1 file unit = 1 in = 2.54 cm = 0.0254 m');
  });

  it('maps source up axes onto glTF Y-up', () => {
    const zUp = new Vector3(0, 0, 1).applyQuaternion(upAxisCorrection('z'));
    const xUp = new Vector3(1, 0, 0).applyQuaternion(upAxisCorrection('x'));
    expect(zUp.y).toBeCloseTo(1);
    expect(xUp.y).toBeCloseTo(1);
  });

  it('maps compatible source forward directions onto Kea3D +Z', () => {
    for (const upAxis of ['x', 'y', 'z'] as const) {
      for (const forwardAxis of forwardAxes.filter((axis) => isForwardAxisCompatible(upAxis, axis))) {
        const correction = orientationCorrection(upAxis, forwardAxis);
        const sourceUp = new Vector3(upAxis === 'x' ? 1 : 0, upAxis === 'y' ? 1 : 0, upAxis === 'z' ? 1 : 0);
        const sign = forwardAxis.startsWith('-') ? -1 : 1;
        const coordinate = forwardAxis.at(-1);
        const sourceForward = new Vector3(coordinate === 'x' ? sign : 0, coordinate === 'y' ? sign : 0, coordinate === 'z' ? sign : 0);
        expect(sourceUp.applyQuaternion(correction).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
        expect(sourceForward.applyQuaternion(correction).distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6);
      }
    }
  });

  it('preserves the previous up-axis corrections through compatible defaults', () => {
    expect(defaultForwardAxis('y')).toBe('z');
    expect(defaultForwardAxis('z')).toBe('-y');
    expect(defaultForwardAxis('x')).toBe('z');
    expect(() => orientationCorrection('y', '-y')).toThrow(/different axis/i);
  });

  it('selects a readable metric unit for model dimensions', () => {
    expect(metricDisplayForDimensions([2, 0.5, 1]).unit).toBe('m');
    expect(metricDisplayForDimensions([0.033, 0.03, 0.033])).toEqual({ factor: 100, unit: 'cm' });
    expect(metricDisplayForDimensions([0.005, 0.002, 0.001])).toEqual({ factor: 1_000, unit: 'mm' });
  });

  it('calculates a uniform calibration multiplier from a known dimension', () => {
    expect(calibrationMultiplier(0.1, 4, 'in')).toBeCloseTo(1.016);
    expect(calibrationMultiplier(1, 0, 'mm')).toBeNull();
    expect(calibrationMultiplier(0, 100, 'mm')).toBeNull();
  });

  it('selects a readable metric unit for measured lengths', () => {
    expect(metricDisplayForLength(1.2)).toEqual({ factor: 1, unit: 'm' });
    expect(metricDisplayForLength(0.125)).toEqual({ factor: 100, unit: 'cm' });
    expect(metricDisplayForLength(0.00125)).toEqual({ factor: 1_000, unit: 'mm' });
  });

  it('honors an explicit display-unit preference', () => {
    expect(metricDisplayForDimensions([0.033, 0.03, 0.033], 'mm')).toEqual({ factor: 1_000, unit: 'mm' });
    expect(metricDisplayForLength(1.25, 'cm')).toEqual({ factor: 100, unit: 'cm' });
  });
});
