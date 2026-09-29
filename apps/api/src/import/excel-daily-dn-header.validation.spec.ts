import * as XLSX from 'xlsx';
import { validateDailyDnExcelHeaders } from './excel-daily-dn-header.validation';

function workbookBufferFromRow(row: Record<string, unknown>): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([row]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const FULL_HEADER_ROW: Record<string, unknown> = {
  'DN#': '1',
  'Sold-to': 'S1',
  'Sold-to Name': 'Customer',
  'Ship-to': 'ST1',
  'Ship-to Name': 'Ship name',
  'Ship-to Street': '1 Main St',
  'SO#': 'SO1',
  'Customer PO': 'PO1',
  'Shipped QTY': '1',
  Material: 'MAT',
  'Material Desc.': 'Desc',
  'Ship-to Region/State': 'CA',
  'Shipping Type': 'UPS',
  'Ship method': 'Prepaid',
};

describe('validateDailyDnExcelHeaders', () => {
  it('accepts a sheet with all required columns', () => {
    const buf = workbookBufferFromRow(FULL_HEADER_ROW);
    expect(validateDailyDnExcelHeaders(buf)).toEqual({ ok: true });
  });

  it('rejects when Sold-to is missing', () => {
    const { 'Sold-to': _, ...rest } = FULL_HEADER_ROW;
    const buf = workbookBufferFromRow(rest as Record<string, unknown>);
    const r = validateDailyDnExcelHeaders(buf);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missingLabels).toContain('Sold-to');
    }
  });

  it('rejects when Ship-to code column is missing (Ship-to Name alone is not enough)', () => {
    const { 'Ship-to': _, ...rest } = FULL_HEADER_ROW;
    const buf = workbookBufferFromRow(rest as Record<string, unknown>);
    const r = validateDailyDnExcelHeaders(buf);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missingLabels).toContain('Ship-to');
    }
  });

  it('rejects when the Ship method column is missing', () => {
    const { 'Ship method': _, ...rest } = FULL_HEADER_ROW;
    const buf = workbookBufferFromRow(rest as Record<string, unknown>);
    const r = validateDailyDnExcelHeaders(buf);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missingLabels).toContain('Ship method');
    }
  });

  it('accepts Shipped ATY as shipped quantity alias', () => {
    const row = { ...FULL_HEADER_ROW };
    delete row['Shipped QTY'];
    row['Shipped ATY'] = '2';
    const buf = workbookBufferFromRow(row);
    expect(validateDailyDnExcelHeaders(buf)).toEqual({ ok: true });
  });

  it('accepts SAP P/N as material alias', () => {
    const row = { ...FULL_HEADER_ROW };
    delete row['Material'];
    row['SAP P/N'] = 'PN1';
    const buf = workbookBufferFromRow(row);
    expect(validateDailyDnExcelHeaders(buf)).toEqual({ ok: true });
  });
});
