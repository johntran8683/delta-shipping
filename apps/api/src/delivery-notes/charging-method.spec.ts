import { CHARGING_METHODS, parseChargingMethod } from './charging-method';

describe('parseChargingMethod', () => {
  it('accepts each fixed-list value', () => {
    for (const m of CHARGING_METHODS) {
      expect(parseChargingMethod(m)).toBe(m);
    }
  });

  it('matches case-insensitively and trims whitespace', () => {
    expect(parseChargingMethod('  prepaid ')).toBe('Prepaid');
    expect(parseChargingMethod('PREPAID BUT NO CHARGE')).toBe(
      'Prepaid but No charge',
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
      /Expected one of: Prepaid, Added, Collect, Prepaid but No charge/,
    );
    expect(() => parseChargingMethod('Bogus', 'delivery note 123')).toThrow(
      /for delivery note 123/,
    );
  });
});
