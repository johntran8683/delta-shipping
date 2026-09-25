import * as XLSX from 'xlsx';
import { validateShippingIdsExcelHeaders } from './excel-shipping-ids-header.validation';

function workbookBuffer(
  rows: Record<string, unknown>[],
  sheetName = 'Customers',
): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('validateShippingIdsExcelHeaders', () => {
  it('accepts Customers sheet with code and CUSTOMER NAME:', () => {
    const buf = workbookBuffer([
      {
        code: '1001',
        'CUSTOMER NAME:': 'Acme Corp',
        'UPS #': '1Z999',
      },
    ]);
    const result = validateShippingIdsExcelHeaders(buf);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sheetName).toBe('Customers');
    }
  });

  it('rejects workbook missing customer name', () => {
    const buf = workbookBuffer([{ code: '1001', 'UPS #': '1Z999' }]);
    const result = validateShippingIdsExcelHeaders(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingLabels).toContain('CUSTOMER NAME:');
    }
  });
});
