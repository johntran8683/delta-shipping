import * as XLSX from 'xlsx';
import {
  sheetHasPickCellExactHeader,
  sheetHasPickCellHeader,
} from './excel-extract';

export type ShippingIdsHeaderValidationFailure = {
  ok: false;
  missingLabels: string[];
  message: string;
};

export type ShippingIdsHeaderValidationOk = { ok: true; sheetName: string };

export type ShippingIdsHeaderValidationResult =
  | ShippingIdsHeaderValidationOk
  | ShippingIdsHeaderValidationFailure;

/** Prefer sheet named Customers; else first sheet. */
export function pickShippingIdsSheetName(sheetNames: string[]): string {
  const customers = sheetNames.find(
    (n) => n.trim().toLowerCase() === 'customers',
  );
  return customers ?? sheetNames[0]!;
}

/**
 * Validate Shipping IDs workbook has customer code + name columns.
 * Carrier account columns are optional.
 */
export function validateShippingIdsExcelHeaders(
  buffer: Buffer,
): ShippingIdsHeaderValidationResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (!workbook.SheetNames.length) {
    return {
      ok: false,
      missingLabels: ['(workbook sheets)'],
      message: 'Workbook has no sheets.',
    };
  }

  const sheetName = pickShippingIdsSheetName(workbook.SheetNames);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return {
      ok: false,
      missingLabels: [sheetName],
      message: `Sheet "${sheetName}" not found.`,
    };
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    range: 0,
  });
  const sheetKeys = rows.length > 0 ? Object.keys(rows[0]!) : [];
  // Also try header-only read if first data row empty
  if (sheetKeys.length === 0) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: false,
    }) as unknown[][];
    const headerRow = (aoa[0] ?? []).map((c) =>
      c == null ? '' : String(c),
    );
    sheetKeys.push(...headerRow.filter(Boolean));
  }

  const missing: string[] = [];
  if (
    !sheetHasPickCellExactHeader(sheetKeys, 'code', 'Sold-to', 'Sold to') &&
    !sheetHasPickCellHeader(sheetKeys, 'code')
  ) {
    missing.push('code');
  }
  if (
    !sheetHasPickCellHeader(
      sheetKeys,
      'CUSTOMER NAME:',
      'CUSTOMER NAME',
      'Customer Name',
      'Sold-to Name',
      'Sold to Name',
    )
  ) {
    missing.push('CUSTOMER NAME:');
  }

  if (missing.length > 0) {
    return {
      ok: false,
      missingLabels: missing,
      message: [
        `Shipping IDs sheet "${sheetName}" is missing required column(s): ${missing.join(', ')}.`,
        'Expected customer code (code) and customer name (CUSTOMER NAME:).',
      ].join(' '),
    };
  }

  return { ok: true, sheetName };
}
