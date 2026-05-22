import {
  carrierMatchesShippingType,
  filterCarrierAccountsForShippingType,
  inferCarrierCodeFromShippingType,
} from './carrier-match';

describe('carrierMatchesShippingType', () => {
  it('matches FedEx ship type to FEDEX carrier code', () => {
    expect(carrierMatchesShippingType('FEDEX', 'FedEx Ground')).toBe(true);
  });

  it('matches UPS', () => {
    expect(carrierMatchesShippingType('UPS', 'UPS Next Day')).toBe(true);
  });

  it('returns false when unrelated', () => {
    expect(carrierMatchesShippingType('UPS', 'FedEx Ground')).toBe(false);
  });
});

describe('filterCarrierAccountsForShippingType', () => {
  const accounts = [
    { carrier_code: 'FEDEX', account_number: '111' },
    { carrier_code: 'FEDEX', account_number: '222' },
    { carrier_code: 'UPS', account_number: '333' },
  ];

  it('returns all accounts for the matched carrier', () => {
    expect(
      filterCarrierAccountsForShippingType(accounts, 'FedEx Express'),
    ).toEqual([
      { carrier_code: 'FEDEX', account_number: '111' },
      { carrier_code: 'FEDEX', account_number: '222' },
    ]);
  });

  it('returns empty when ship type missing', () => {
    expect(filterCarrierAccountsForShippingType(accounts, null)).toEqual([]);
  });
});

describe('inferCarrierCodeFromShippingType', () => {
  it('maps FedEx ship method', () => {
    expect(inferCarrierCodeFromShippingType('FedEx Ground')).toBe('FEDEX');
  });

  it('returns OTHER when empty', () => {
    expect(inferCarrierCodeFromShippingType('')).toBe('OTHER');
  });
});
