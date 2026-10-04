import { countryCodeFromName } from './country-codes';

describe('countryCodeFromName', () => {
  it('maps full country names', () => {
    expect(countryCodeFromName('United States')).toBe('US');
    expect(countryCodeFromName('Canada')).toBe('CA');
    expect(countryCodeFromName('United Kingdom')).toBe('GB');
    expect(countryCodeFromName('Germany')).toBe('DE');
  });

  it('is case-insensitive and ignores surrounding whitespace and periods', () => {
    expect(countryCodeFromName('  united states ')).toBe('US');
    expect(countryCodeFromName('CANADA')).toBe('CA');
    expect(countryCodeFromName('U.S.A.')).toBe('US');
    expect(countryCodeFromName('U.K.')).toBe('GB');
  });

  it('handles common abbreviations and variants', () => {
    expect(countryCodeFromName('USA')).toBe('US');
    expect(countryCodeFromName('UK')).toBe('GB');
    expect(countryCodeFromName('UAE')).toBe('AE');
    expect(countryCodeFromName('Czechia')).toBe('CZ');
    expect(countryCodeFromName('Turkiye')).toBe('TR');
  });

  it('returns null for unknown or blank names', () => {
    expect(countryCodeFromName('Narnia')).toBeNull();
    expect(countryCodeFromName('')).toBeNull();
    expect(countryCodeFromName('   ')).toBeNull();
    expect(countryCodeFromName(null)).toBeNull();
    expect(countryCodeFromName(undefined)).toBeNull();
  });
});
