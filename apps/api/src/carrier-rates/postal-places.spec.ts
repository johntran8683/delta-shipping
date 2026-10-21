import { checkPostalAddress, type PostalPlace } from './postal-places';

const SAMPLE: Record<string, PostalPlace[]> = {
  '10001': [{ city: 'New York', state: 'NY' }],
  '44141': [{ city: 'Brecksville', state: 'OH' }],
  '02368': [{ city: 'Randolph', state: 'MA' }],
  '99999': [
    { city: 'North', state: 'TX' },
    { city: 'South', state: 'TX' },
  ],
};

describe('checkPostalAddress', () => {
  it('quotes immediately when the ZIP, city, and state agree', () => {
    const result = checkPostalAddress(
      {
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
        countryCode: 'US',
      },
      SAMPLE,
    );
    expect(result.status).toBe('ready');
    expect(result.suggestions).toEqual([]);
  });

  it('accepts a blank city when the state matches the ZIP', () => {
    const result = checkPostalAddress(
      { city: '  ', state: 'New York', postalCode: '10001', countryCode: 'US' },
      SAMPLE,
    );
    expect(result.status).toBe('ready');
  });

  it('suggests the ZIP city and state when the ship-to disagrees', () => {
    const result = checkPostalAddress(
      { city: null, state: 'NV', postalCode: '02368', countryCode: 'US' },
      SAMPLE,
    );
    expect(result.status).toBe('confirm');
    expect(result.suggestions).toEqual([
      {
        city: 'Randolph',
        state: 'MA',
        postalCode: '02368',
        countryCode: 'US',
      },
    ]);
  });

  it('lists every city when a ZIP is shared', () => {
    const result = checkPostalAddress(
      { city: 'East', state: 'TX', postalCode: '99999', countryCode: 'US' },
      SAMPLE,
    );
    expect(result.status).toBe('confirm');
    expect(result.suggestions.map((s) => s.city)).toEqual(['North', 'South']);
  });

  it('does not invent a country when the ZIP is unknown', () => {
    const result = checkPostalAddress(
      {
        street: 'PO BOX 35 - 80100 MOMBASA',
        city: 'Mombasa',
        state: 'CA',
        postalCode: '80100',
        countryCode: 'US',
      },
      SAMPLE,
    );
    expect(result.status).toBe('confirm');
    expect(result.suggestions).toEqual([]);
    expect(result.message).toMatch(/not a known United States ZIP code/);
    expect(result.message).not.toMatch(/Kenya|Mombasa/);
    expect(result.current.countryCode).toBe('US');
  });

  it('does not invent a country when the code is not a ZIP', () => {
    const result = checkPostalAddress(
      { state: 'NV', postalCode: '3168', countryCode: 'US' },
      SAMPLE,
    );
    expect(result.status).toBe('confirm');
    expect(result.suggestions).toEqual([]);
    expect(result.message).toMatch(/not a United States ZIP code/);
    expect(result.message).not.toMatch(/Australia/);
  });

  it('suggests the Canadian province from the postal prefix and keeps the city', () => {
    const result = checkPostalAddress(
      {
        city: 'Fredericton',
        state: 'ON',
        postalCode: 'E3B 1A1',
        countryCode: 'CA',
      },
      SAMPLE,
    );
    expect(result.status).toBe('confirm');
    expect(result.suggestions).toEqual([
      {
        city: 'Fredericton',
        state: 'NB',
        postalCode: 'E3B 1A1',
        countryCode: 'CA',
      },
    ]);
    expect(result.message).toMatch(/New Brunswick/);
    expect(result.message).toMatch(/city on the note was left as entered/);
  });

  it('offers both territories when the postal prefix is shared', () => {
    const result = checkPostalAddress(
      {
        city: 'Iqaluit',
        state: 'ON',
        postalCode: 'X0A 0H0',
        countryCode: 'CA',
      },
      SAMPLE,
    );
    expect(result.suggestions.map((s) => s.state)).toEqual(['NT', 'NU']);
  });

  it('accepts a Canadian postal code whose province matches', () => {
    const result = checkPostalAddress(
      {
        city: 'Surrey',
        state: 'British Columbia',
        postalCode: 'V3S 1A1',
        countryCode: 'CA',
      },
      SAMPLE,
    );
    expect(result.status).toBe('ready');
  });

  it('leaves other countries alone', () => {
    const result = checkPostalAddress(
      {
        city: 'Melbourne',
        state: 'VIC',
        postalCode: '3000',
        countryCode: 'AU',
      },
      SAMPLE,
    );
    expect(result.status).toBe('ready');
    expect(result.suggestions).toEqual([]);
  });

  it('blocks a quote when the postal code or country is missing', () => {
    const result = checkPostalAddress(
      { city: 'Austin', state: 'TX', postalCode: '', countryCode: '' },
      SAMPLE,
    );
    expect(result.status).toBe('blocked');
    expect(result.suggestions).toEqual([]);
  });
});
