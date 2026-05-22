import {
  pickCell,
  sheetHasShipToCodeColumn,
  sheetHasSoldToCodeColumn,
  sheetHasStreetImportColumn,
} from './excel-extract';

describe('pickCell', () => {
  it('does not map Ship-to Name to the Ship-to code column', () => {
    const row = {
      'Ship-to': '104755',
      'Ship-to Name': 'ACME Distribution Center',
      Sold: 'x',
    };
    expect(pickCell(row, 'Ship-to Name', 'Ship to Name')).toBe(
      'ACME Distribution Center',
    );
  });

  it('does not map Sold-to Name to the Sold-to code column', () => {
    const row = {
      'Sold-to': '200055',
      'Sold-to Name': 'Example Corp',
    };
    expect(
      pickCell(row, 'Sold-to Name', 'Sold to Name', 'Customer Name'),
    ).toBe('Example Corp');
  });

  it('still matches when the Excel header is longer than the label', () => {
    const row = {
      'Ship-to Name (delivery)': 'Warehouse 7',
    };
    expect(pickCell(row, 'Ship-to Name')).toBe('Warehouse 7');
  });

  it('matches Ship-to-Street (hyphenated) to Ship-to Street', () => {
    const row = {
      'Ship-to-Street': '100 Industrial Way',
      'Ship-to': '104755',
    };
    expect(
      pickCell(
        row,
        'Ship-to Street',
        'Ship to Street',
        'Street',
        'Address 1',
        'Address1',
      ),
    ).toBe('100 Industrial Way');
  });
});

describe('sheetHasStreetImportColumn', () => {
  it('is false when no street mapping headers exist', () => {
    expect(
      sheetHasStreetImportColumn([
        'DN#',
        'Ship-to',
        'Ship-to Name',
        'Ship-to Region/State',
      ]),
    ).toBe(false);
  });

  it('is true when Ship-to Street is present', () => {
    expect(sheetHasStreetImportColumn(['Ship-to Street', 'DN#'])).toBe(true);
  });

  it('is true for Address 1 alias', () => {
    expect(sheetHasStreetImportColumn(['Address 1'])).toBe(true);
  });
});

describe('sold-to / ship-to code columns', () => {
  it('detects Sold-to and Ship-to code headers', () => {
    expect(
      sheetHasSoldToCodeColumn(['DN#', 'Sold-to', 'Ship-to', 'Ship-to Name']),
    ).toBe(true);
    expect(
      sheetHasShipToCodeColumn(['DN#', 'Sold-to', 'Ship-to', 'Ship-to Name']),
    ).toBe(true);
  });

  it('does not treat Ship-to Name as the ship-to code column', () => {
    expect(sheetHasShipToCodeColumn(['Ship-to Name', 'Ship-to Street'])).toBe(
      false,
    );
  });
});
