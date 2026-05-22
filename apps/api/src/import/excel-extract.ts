import { Prisma } from '@prisma/client';

/** Normalize header for fuzzy match. */
export function normHeader(s: string): string {
  return s
    .trim()
    .toLowerCase()
    // Excel often uses hyphens ("Ship-to-Street") where we list spaces ("Ship-to Street")
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[#]/g, '#');
}

/** Find value from Excel row using candidate header labels (exact or normalized). */
export function pickCell(
  row: Record<string, unknown>,
  ...labels: string[]
): unknown {
  const keys = Object.keys(row);
  const norms = labels.map((l) => normHeader(l));
  for (const k of keys) {
    const nk = normHeader(k);
    if (labels.includes(k)) return row[k];
    if (norms.includes(nk)) return row[k];
  }
  // Second pass: header contains label (e.g. "Ship-to Name (extra)") matches.
  // Do NOT use want.includes(nk): shorter headers like "Ship-to" would wrongly match
  // before "Ship-to Name" because "ship-to name".includes("ship-to").
  for (const k of keys) {
    const nk = normHeader(k);
    for (const want of norms) {
      if (nk === want || nk.includes(want)) {
        return row[k];
      }
    }
  }
  return undefined;
}

/** Exact/normalized header match only (no partial contains). */
export function pickCellExact(
  row: Record<string, unknown>,
  ...labels: string[]
): unknown {
  const keys = Object.keys(row);
  const norms = labels.map((l) => normHeader(l));
  for (const k of keys) {
    const nk = normHeader(k);
    if (labels.includes(k)) return row[k];
    if (norms.includes(nk)) return row[k];
  }
  return undefined;
}

/** Whether the sheet defines a column that `pickCell` would resolve for these labels. */
export function sheetHasPickCellHeader(
  sheetKeys: string[],
  ...labels: string[]
): boolean {
  const row: Record<string, unknown> = Object.fromEntries(
    sheetKeys.map((k) => [k, true]),
  );
  return pickCell(row, ...labels) !== undefined;
}

/** Whether the sheet defines a column that `pickCellExact` would resolve. */
export function sheetHasPickCellExactHeader(
  sheetKeys: string[],
  ...labels: string[]
): boolean {
  const row: Record<string, unknown> = Object.fromEntries(
    sheetKeys.map((k) => [k, true]),
  );
  return pickCellExact(row, ...labels) !== undefined;
}

/** Column headers that populate `ship_to_locations.street1` during Excel import. */
const STREET_IMPORT_HEADER_LABELS = [
  'Ship-to Street',
  'Ship to Street',
  'Ship-to-Street',
  'Address 1',
  'Address1',
] as const;

/** True if the worksheet defines at least one street column we read for ship-to. */
export function sheetHasStreetImportColumn(keys: string[]): boolean {
  const norms = STREET_IMPORT_HEADER_LABELS.map((l) => normHeader(l));
  for (const k of keys) {
    if (norms.includes(normHeader(k))) return true;
  }
  return false;
}

/** SAP Sold-to partner code column (not customer name). */
export function sheetHasSoldToCodeColumn(keys: string[]): boolean {
  const want = new Set([normHeader('Sold-to'), normHeader('Sold to')]);
  for (const k of keys) {
    if (want.has(normHeader(k))) return true;
  }
  return false;
}

/**
 * SAP Ship-to location code column (not Ship-to Name / Street).
 * Match exact header only — fuzzy "ship to" would match "Ship-to Name".
 */
export function sheetHasShipToCodeColumn(keys: string[]): boolean {
  const want = new Set([normHeader('Ship-to'), normHeader('Ship to')]);
  for (const k of keys) {
    if (want.has(normHeader(k))) return true;
  }
  return false;
}

export function pickCurrency(row: Record<string, unknown>): unknown {
  const cur = pickCell(row, '$', 'Currency', 'currency_code');
  if (cur != null && cur !== '') return cur;
  for (const k of Object.keys(row)) {
    if (k.trim() === '$') return row[k];
  }
  return undefined;
}

export function toDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const d = new Date((value - 25569) * 86400 * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toDateOnly(value: unknown): Date | null {
  const d = toDate(value);
  if (!d) return null;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export function toDecimal(value: unknown): Prisma.Decimal | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return new Prisma.Decimal(String(value));
  }
  const s = String(value).trim().replace(/,/g, '');
  if (!s || s === '-') return null;
  try {
    return new Prisma.Decimal(s);
  } catch {
    return null;
  }
}

export function toInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  const s = String(value).trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

export function toStr(value: unknown, max?: number): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (max != null && s.length > max) return s.slice(0, max);
  return s;
}

/** Parse "P10", "P11" → 10, 11 */
export function parsePriorityLabel(value: unknown): number | null {
  const s = toStr(value, 20);
  if (!s) return null;
  const m = /^p\s*(\d+)$/i.exec(s);
  if (!m) return null;
  return parseInt(m[1], 10);
}
