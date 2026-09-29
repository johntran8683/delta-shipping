import * as XLSX from 'xlsx';
import {
  sheetHasPickCellExactHeader,
  sheetHasPickCellHeader,
} from './excel-extract';

export type DailyDnHeaderValidationFailure = {
  ok: false;
  missingLabels: string[];
  message: string;
};

export type DailyDnHeaderValidationOk = { ok: true };

export type DailyDnHeaderValidationResult =
  | DailyDnHeaderValidationOk
  | DailyDnHeaderValidationFailure;

/** Human-facing names + aliases aligned with `ExcelIngestService` / `excel-extract`. */
const MANDATORY_HEADER_RULES: {
  label: string;
  exact: boolean;
  aliases: string[];
}[] = [
  {
    label: 'Delivery note number (DN#)',
    exact: false,
    aliases: ['DN#', 'DN'],
  },
  {
    label: 'Sold-to',
    exact: true,
    aliases: ['Sold-to', 'Sold to'],
  },
  {
    label: 'Sold-to Name',
    exact: false,
    aliases: [
      'Sold-to Name',
      'Sold to Name',
      'Customer Name',
      'Bill-to Name',
      'Bill to Name',
    ],
  },
  {
    label: 'Ship-to',
    exact: true,
    aliases: ['Ship-to', 'Ship to'],
  },
  {
    label: 'Ship-to Name',
    exact: false,
    aliases: ['Ship-to Name', 'Ship to Name', 'Ship To Name'],
  },
  {
    label: 'Ship-to Street',
    exact: true,
    aliases: [
      'Ship-to Street',
      'Ship to Street',
      'Ship-to-Street',
      'Address 1',
      'Address1',
    ],
  },
  {
    label: 'SO number',
    exact: false,
    aliases: ['SO#', 'SO', 'Sales Order'],
  },
  {
    label: 'Customer PO',
    exact: false,
    aliases: ['Customer PO'],
  },
  {
    label: 'Shipped QTY',
    exact: false,
    aliases: ['Shipped QTY', 'Shipped Qty', 'Shipped ATY', 'Shipped Aty'],
  },
  {
    label: 'Material',
    exact: false,
    aliases: ['Material', 'Material Code', 'Mat.', 'SAP P/N'],
  },
  {
    label: 'Material Desc',
    exact: false,
    aliases: ['Material Desc.', 'Material Desc', 'Material Description'],
  },
  {
    label: 'Ship-to Region/State',
    exact: false,
    aliases: [
      'Ship-to Region/State',
      'Ship-to Region',
      'Ship to Region/State',
      'Ship to Region',
    ],
  },
  {
    label: 'Shipping Type',
    exact: false,
    aliases: ['Shipping Type'],
  },
  // NOTE: 'Ship method' (charging method) is intentionally NOT mandatory.
  // The team's Excel files do not have this column; when present it is
  // parsed and validated, otherwise charging_method stays null and can be
  // filled in on the edit screen while the DN is NEW.
];

/**
 * Validates the first worksheet has all mandatory columns before queuing import.
 * Uses the same header matching rules as the ingest service (exact vs fuzzy where applicable).
 */
export function validateDailyDnExcelHeaders(
  buffer: Buffer,
): DailyDnHeaderValidationResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (!workbook.SheetNames.length) {
    return {
      ok: false,
      missingLabels: MANDATORY_HEADER_RULES.map((r) => r.label),
      message:
        'The workbook has no sheets. Add a data sheet with the required columns.',
    };
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });

  if (rows.length === 0) {
    return {
      ok: false,
      missingLabels: MANDATORY_HEADER_RULES.map((r) => r.label),
      message: `Sheet "${sheetName}" is empty. Add a header row and data rows.`,
    };
  }

  const sheetKeys = Object.keys(rows[0]!);
  const missingLabels: string[] = [];

  for (const rule of MANDATORY_HEADER_RULES) {
    const has = rule.exact
      ? sheetHasPickCellExactHeader(sheetKeys, ...rule.aliases)
      : sheetHasPickCellHeader(sheetKeys, ...rule.aliases);
    if (!has) missingLabels.push(rule.label);
  }

  if (missingLabels.length > 0) {
    const list = missingLabels.map((l) => `• ${l}`).join('\n');
    return {
      ok: false,
      missingLabels,
      message: [
        'This Excel file is missing required column(s). Fix the header row on the first sheet, then upload again.',
        '',
        'Missing:',
        list,
        '',
        `Sheet used: "${sheetName}" (first sheet only).`,
      ].join('\n'),
    };
  }

  return { ok: true };
}
