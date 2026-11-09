import {
  decideAccountUpsert,
  findLocationForRecord,
  parseFedexRecipientReport,
  parseUpsAddressBookText,
  type LocationRow,
} from './location-carrier-accounts';

const FEDEX_REPORT = [
  'Recipient Code: 01824                      Country: US',
  'Contact: Michael Buckley                      Company: Albireo Energy',
  'Address: 100 Apollo Drive',
  '         Suite 101',
  'City: Albany                        St/Pv: NY          Zip/Postal: 12205',
  'Phone: 512 555-0100    Ext:        Delivery Type:  C',
  'FedEx Express Acct#: 123456789            FedEx Express T/C 3rd Party Acct#:',
  'Customs ID/EIN: 12-3456789         Related: N',
  '',
  'Recipient Code: 03048                      Country: US',
  'Contact: Svetlana Lyons                       Company: Cimetrics Inc.',
  'Address: 32 Mill Street',
  'City: Boston                        St/Pv: MA          Zip/Postal: 02110',
  'Phone: 617 555-0100    Ext:        Delivery Type:  C',
  'FedEx Express Acct#:                          FedEx Express T/C 3rd Party Acct#:',
  'Customs ID/EIN: 98-7654321         Related: N',
  '',
].join('\n');

const UPS_CSV = [
  'CustomerID,CompanyOrName,Attention,Address1,Address2,Address3,CityorTown,StateProvinceCounty,PostalCode,CountryTerritory,Telephone,UPSAccountNumber,EmailAddress',
  ',Acme Corp,,1 Ship Way,,,Toronto,ON,M5V1J1,Canada,4165550100,UPS123456,ops@acme.example',
  ',Beta Ltd,,9 Other Rd,,,Vancouver,BC,V6B1A1,Canada,6045550100,,ops@beta.example',
].join('\n');

const LOCATIONS: LocationRow[] = [
  {
    id: 'loc-1',
    customer_id: 'cust-1',
    ship_to_code: 'S-100',
    ship_to_name: 'Albireo Energy',
    street1: '100 Apollo Drive Suite 101',
    postal_code: '12205',
  },
  {
    id: 'loc-2',
    customer_id: 'cust-2',
    ship_to_code: 'S-200',
    ship_to_name: 'Acme Corp',
    street1: '1 Ship Way',
    postal_code: 'M5V 1J1',
  },
  {
    id: 'loc-3',
    customer_id: 'cust-2',
    ship_to_code: 'S-201',
    ship_to_name: 'Acme Corp',
    street1: '1 Ship Way',
    postal_code: 'M5V 1J1',
  },
];

describe('parseFedexRecipientReport', () => {
  it('reads the per-record Express account and address', () => {
    const recs = parseFedexRecipientReport(FEDEX_REPORT);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({
      acct: '01824',
      company: 'Albireo Energy',
      addr1: '100 Apollo Drive',
      addr2: 'Suite 101',
      city: 'Albany',
      state: 'NY',
      postal: '12205',
      fedexAcct: '123456789',
    });
    expect(recs[1]?.fedexAcct).toBe('');
  });
});

describe('parseUpsAddressBookText', () => {
  it('reads the UPS account number per row', () => {
    const recs = parseUpsAddressBookText(UPS_CSV);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({
      company: 'Acme Corp',
      addr1: '1 Ship Way',
      city: 'Toronto',
      postal: 'M5V1J1',
      upsAcct: 'UPS123456',
    });
    expect(recs[1]?.upsAcct).toBe('');
  });

  it('throws when no company column exists', () => {
    expect(() =>
      parseUpsAddressBookText('Foo,Bar\n1,2\n'),
    ).toThrow(/company column/);
  });
});

describe('findLocationForRecord', () => {
  it('matches by company + postal + street', () => {
    expect(
      findLocationForRecord(LOCATIONS, {
        company: 'Albireo Energy',
        addr1: '100 Apollo Drive',
        postal: '12205',
      }),
    ).toMatchObject({ id: 'loc-1' });
  });

  it('matches when the record street carries a unit suffix', () => {
    expect(
      findLocationForRecord(LOCATIONS, {
        company: 'Albireo Energy',
        addr1: '100 Apollo Drive, Suite 101',
        postal: '12205',
      }),
    ).toMatchObject({ id: 'loc-1' });
  });

  it('returns null when the company differs', () => {
    expect(
      findLocationForRecord(LOCATIONS, {
        company: 'Someone Else',
        addr1: '100 Apollo Drive',
        postal: '12205',
      }),
    ).toBeNull();
  });

  it('returns null when the postal code is missing', () => {
    expect(
      findLocationForRecord(LOCATIONS, {
        company: 'Albireo Energy',
        addr1: '100 Apollo Drive',
        postal: '',
      }),
    ).toBeNull();
  });

  it('returns null when several locations match (ambiguous)', () => {
    // loc-2 and loc-3 share company, postal and street.
    expect(
      findLocationForRecord(LOCATIONS, {
        company: 'Acme Corp',
        addr1: '1 Ship Way',
        postal: 'M5V1J1',
      }),
    ).toBeNull();
  });
});

describe('decideAccountUpsert', () => {
  it('creates when no row exists', () => {
    expect(decideAccountUpsert(null, 'loc-1')).toEqual({ action: 'create' });
  });

  it('links a customer-wide row to the location', () => {
    expect(
      decideAccountUpsert({ id: 'a-1', ship_to_location_id: null }, 'loc-1'),
    ).toEqual({ action: 'link', accountId: 'a-1' });
  });

  it('leaves a row already at this location alone', () => {
    expect(
      decideAccountUpsert({ id: 'a-1', ship_to_location_id: 'loc-1' }, 'loc-1'),
    ).toEqual({ action: 'already', accountId: 'a-1' });
  });

  it('reports a conflict when the row belongs to another location', () => {
    expect(
      decideAccountUpsert({ id: 'a-1', ship_to_location_id: 'loc-2' }, 'loc-1'),
    ).toEqual({
      action: 'conflict',
      accountId: 'a-1',
      existingLocationId: 'loc-2',
    });
  });
});
