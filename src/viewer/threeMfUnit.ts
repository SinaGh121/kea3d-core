import type { LinearUnit } from './types';

const threeMfUnits: Record<string, LinearUnit> = {
  micron: 'um',
  millimeter: 'mm',
  centimeter: 'cm',
  meter: 'm',
  inch: 'in',
  foot: 'ft',
};

export function threeMfUnitFromXml(xml: string): LinearUnit {
  const declaredUnit = xml.match(/<model\b[^>]*\bunit\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
  return declaredUnit ? threeMfUnits[declaredUnit] ?? 'mm' : 'mm';
}
