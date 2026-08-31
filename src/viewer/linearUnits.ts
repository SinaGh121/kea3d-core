import type { LinearUnit } from './types';

export type MetricDisplayUnit = 'mm' | 'cm' | 'm';
export type MetricDisplayPreference = MetricDisplayUnit | 'auto';

export const unitToMeters: Record<LinearUnit, number> = {
  um: 0.000_001,
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
};

export const linearUnitSymbols: Record<LinearUnit, string> = {
  um: 'µm',
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  in: 'in',
  ft: 'ft',
};

export const sourceUnitConversionText: Record<LinearUnit, string> = {
  um: '1 file unit = 1 µm = 0.000001 m',
  mm: '1 file unit = 1 mm = 0.001 m',
  cm: '1 file unit = 1 cm = 0.01 m',
  m: '1 file unit = 1 m',
  in: '1 file unit = 1 in = 2.54 cm = 0.0254 m',
  ft: '1 file unit = 1 ft = 12 in = 0.3048 m',
};

export function calibrationMultiplier(currentMeters: number, targetValue: number, targetUnit: LinearUnit): number | null {
  if (!Number.isFinite(currentMeters) || currentMeters <= 0 || !Number.isFinite(targetValue) || targetValue <= 0) return null;
  return (targetValue * unitToMeters[targetUnit]) / currentMeters;
}

export function metricDisplayForDimensions(dimensions: [number, number, number], preference: MetricDisplayPreference = 'auto'): {
  factor: number;
  unit: MetricDisplayUnit;
} {
  const largest = Math.max(...dimensions.map((value) => Math.abs(value)));
  return metricDisplayForLength(largest, preference);
}

export function metricDisplayForLength(length: number, preference: MetricDisplayPreference = 'auto'): {
  factor: number;
  unit: MetricDisplayUnit;
} {
  if (preference === 'm') return { factor: 1, unit: 'm' };
  if (preference === 'cm') return { factor: 100, unit: 'cm' };
  if (preference === 'mm') return { factor: 1_000, unit: 'mm' };
  const largest = Math.abs(length);
  if (largest >= 1) return { factor: 1, unit: 'm' };
  if (largest >= 0.01) return { factor: 100, unit: 'cm' };
  return { factor: 1_000, unit: 'mm' };
}
