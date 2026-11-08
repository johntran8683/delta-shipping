import { ExcelIngestService } from './excel-ingest.service';
import { sheetHasSoldToStreetImportColumn } from './excel-extract';

function makeService() {
  return new ExcelIngestService({} as never);
}

function extract(service: ExcelIngestService, header: Record<string, unknown>) {
  return (service as unknown as {
    extractPartyMasterFields: (
      header: Record<string, unknown>,
    ) => Record<string, unknown>;
  }).extractPartyMasterFields(header);
}

describe('sheetHasSoldToStreetImportColumn', () => {
  it('recognizes sold-to and bill-to street headers', () => {
    expect(
      sheetHasSoldToStreetImportColumn(['DN#', 'Sold-to', 'Sold-to Street']),
    ).toBe(true);
    expect(
      sheetHasSoldToStreetImportColumn(['DN#', 'Bill-to Street']),
    ).toBe(true);
    expect(
      sheetHasSoldToStreetImportColumn(['DN#', 'Sold-to Address 1']),
    ).toBe(true);
  });

  it('does not match the ship-to street column', () => {
    expect(
      sheetHasSoldToStreetImportColumn(['DN#', 'Ship-to Street']),
    ).toBe(false);
    expect(sheetHasSoldToStreetImportColumn(['DN#', 'Address 1'])).toBe(
      false,
    );
  });
});

describe('extractPartyMasterFields — sold-to address', () => {
  const baseHeader = {
    'Sold-to': 'A-001',
    'Sold-to Name': 'Acme Corp',
    'Ship-to': 'S-100',
    'Ship-to Name': 'Acme DC',
    'Ship-to Street': '1 Ship Way',
    'Ship-to City': 'Toronto',
    'Ship-to State': 'ON',
    'Postal Code': 'M5V 1J1',
    Country: 'Canada',
  };

  it('reads sold-to address columns and keeps ship-to fields separate', () => {
    const m = extract(makeService(), {
      ...baseHeader,
      'Sold-to Street': '9 Head Office Rd',
      'Sold-to City': 'Vancouver',
      'Sold-to State': 'BC',
      'Sold-to Postal Code': 'V6B 1A1',
      'Sold-to Country': 'Canada',
    });
    expect(m.sold_to_street1).toBe('9 Head Office Rd');
    expect(m.sold_to_street1_provided).toBe(true);
    expect(m.sold_to_city).toBe('Vancouver');
    expect(m.sold_to_state_region).toBe('BC');
    expect(m.sold_to_postal_code).toBe('V6B 1A1');
    expect(m.sold_to_country_name).toBe('Canada');
    expect(m.sold_to_country_code).toBe('CA');
    // Ship-to side untouched by the sold-to columns.
    expect(m.street1).toBe('1 Ship Way');
    expect(m.city).toBe('Toronto');
    expect(m.state_region).toBe('ON');
    expect(m.postal_code).toBe('M5V 1J1');
    expect(m.country_code).toBe('CA');
  });

  it('does not let a sold-to column fill a missing ship-to field', () => {
    const m = extract(makeService(), {
      'Sold-to': 'A-001',
      'Sold-to Name': 'Acme Corp',
      'Ship-to': 'S-100',
      'Ship-to Name': 'Acme DC',
      'Ship-to Street': '1 Ship Way',
      'Sold-to City': 'Vancouver',
      'Sold-to State': 'BC',
      'Sold-to Postal Code': 'V6B 1A1',
      'Sold-to Country': 'Canada',
    });
    expect(m.sold_to_city).toBe('Vancouver');
    expect(m.city).toBeNull();
    expect(m.state_region).toBeNull();
    expect(m.postal_code).toBeNull();
    expect(m.country_name).toBeNull();
    expect(m.country_code).toBeNull();
  });

  it('reads Bill-to aliases', () => {
    const m = extract(makeService(), {
      ...baseHeader,
      'Bill-to Street': '5 Billing Ave',
      'Bill-to City': 'Calgary',
      'Bill-to Country': 'Canada',
    });
    expect(m.sold_to_street1).toBe('5 Billing Ave');
    expect(m.sold_to_city).toBe('Calgary');
    expect(m.sold_to_country_code).toBe('CA');
  });

  it('reports no sold-to address when the columns are absent', () => {
    const m = extract(makeService(), baseHeader);
    expect(m.sold_to_street1).toBeNull();
    expect(m.sold_to_street1_provided).toBe(false);
    expect(m.sold_to_street2).toBeNull();
    expect(m.sold_to_city).toBeNull();
    expect(m.sold_to_state_region).toBeNull();
    expect(m.sold_to_postal_code).toBeNull();
    expect(m.sold_to_country_code).toBeNull();
    expect(m.sold_to_country_name).toBeNull();
  });
});

describe('ensureCustomerAndShipTo — sold-to location', () => {
  function makeTx() {
    return {
      customer: {
        upsert: jest.fn().mockResolvedValue({ id: 'cust-1' }),
      },
      shipToLocation: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
  }

  function ensure(
    service: ExcelIngestService,
    tx: ReturnType<typeof makeTx>,
    header: Record<string, unknown>,
  ) {
    return (service as unknown as {
      ensureCustomerAndShipTo: (
        tx: unknown,
        header: Record<string, unknown>,
        sold: string,
        ship: string,
      ) => Promise<unknown>;
    }).ensureCustomerAndShipTo(tx, header, 'A-001', 'S-100');
  }

  const headerWithSoldTo = {
    'Sold-to Name': 'Acme Corp',
    'Ship-to Name': 'Acme DC',
    'Ship-to Street': '1 Ship Way',
    'Ship-to City': 'Toronto',
    'Sold-to Street': '9 Head Office Rd',
    'Sold-to City': 'Vancouver',
    'Sold-to State': 'BC',
    'Sold-to Postal Code': 'V6B 1A1',
    'Sold-to Country': 'Canada',
  };

  it("upserts the sold-to location as the customer's own location", async () => {
    const tx = makeTx();
    await ensure(makeService(), tx, headerWithSoldTo);
    expect(tx.shipToLocation.upsert).toHaveBeenCalledTimes(2);
    const soldToCall = tx.shipToLocation.upsert.mock.calls[1]![0] as {
      where: { customer_id_ship_to_code: { ship_to_code: string } };
      create: Record<string, unknown>;
    };
    expect(
      soldToCall.where.customer_id_ship_to_code.ship_to_code,
    ).toBe('A-001');
    expect(soldToCall.create.street1).toBe('9 Head Office Rd');
    expect(soldToCall.create.city).toBe('Vancouver');
    expect(soldToCall.create.state_region).toBe('BC');
    expect(soldToCall.create.postal_code).toBe('V6B 1A1');
    expect(soldToCall.create.country_code).toBe('CA');
  });

  it('skips the sold-to location when the file carries no sold-to address', async () => {
    const tx = makeTx();
    await ensure(makeService(), tx, {
      'Sold-to Name': 'Acme Corp',
      'Ship-to Name': 'Acme DC',
      'Ship-to Street': '1 Ship Way',
      'Ship-to City': 'Toronto',
    });
    expect(tx.shipToLocation.upsert).toHaveBeenCalledTimes(1);
  });

  it('does not store the sold-to code itself as the street', async () => {
    const tx = makeTx();
    await ensure(makeService(), tx, {
      ...headerWithSoldTo,
      'Sold-to Street': 'A-001',
    });
    expect(tx.shipToLocation.upsert).toHaveBeenCalledTimes(2);
    const soldToCall = tx.shipToLocation.upsert.mock.calls[1]![0] as {
      create: Record<string, unknown>;
    };
    expect(soldToCall.create.street1).toBeNull();
  });
});
