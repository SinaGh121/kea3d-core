import { describe, expect, it } from 'vitest';
import { threeMfUnitFromXml } from './threeMfUnit';

describe('threeMfUnitFromXml', () => {
  it('maps declared 3MF units to viewer units', () => {
    expect(threeMfUnitFromXml('<model unit="millimeter">')).toBe('mm');
    expect(threeMfUnitFromXml("<model unit='micron'>")).toBe('um');
    expect(threeMfUnitFromXml('<model unit="inch">')).toBe('in');
  });

  it('uses the 3MF default for missing or unknown units', () => {
    expect(threeMfUnitFromXml('<model>')).toBe('mm');
    expect(threeMfUnitFromXml('<model unit="parsec">')).toBe('mm');
  });
});
