import {
  CHARGING_METHODS,
  CHARGING_METHOD_HEADERS,
  parseChargingMethod,
} from './charging-method';
import { pickCell } from '../import/excel-extract';

describe('parseChargingMethod', () => {
  it('accepts each fixed-list value', () => {
    for (const m of CHARGING_METHODS) {
      expect(parseChargingMethod(m)).toBe(m);
    }
  });

  it('matches case-insensitively and trims whitespace', () => {
    expect(parseChargingMethod('  prepaid and added ')).toBe(
      'Prepaid and Added',
    );
    expect(parseChargingMethod('PREPAID BUT NO CHARGE')).toBe(
      'Prepaid but No Charge',
    );
  });

  it('returns null for blank or missing values', () => {
    expect(parseChargingMethod('')).toBeNull();
    expect(parseChargingMethod('   ')).toBeNull();
    expect(parseChargingMethod(undefined)).toBeNull();
    expect(parseChargingMethod(null)).toBeNull();
  });

  it('throws for values outside the fixed list, naming the DN when given', () => {
    expect(() => parseChargingMethod('Freight collect')).toThrow(
      /Invalid charging method "Freight collect"/,
    );
    expect(() => parseChargingMethod('Freight collect')).toThrow(
      /Expected one of: Prepaid and Added, Collect, Prepaid but No Charge/,
    );
    expect(() => parseChargingMethod('Bogus', 'delivery note 123')).toThrow(
      /for delivery note 123/,
    );
  });
});

describe('charging method Excel header', () => {
  it('recognizes the team\'s "Charging Method" header', () => {
    expect(CHARGING_METHOD_HEADERS).toContain('Charging Method');
  });

  it('extracts the value from a row using the team header', () => {
    const row = { 'Charging Method': 'Prepaid and Added' };
    expect(parseChargingMethod(pickCell(row, ...CHARGING_METHOD_HEADERS))).toBe(
      'Prepaid and Added',
    );
  });

  it('does not confuse "Shipping Type" with the charging method column', () => {
    const row = { 'Shipping Type': 'FedEx Ground' };
    expect(
      parseChargingMethod(pickCell(row, ...CHARGING_METHOD_HEADERS)),
    ).toBeNull();
  });
});
