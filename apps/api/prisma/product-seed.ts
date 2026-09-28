/**
 * Product master backfill helpers (option 2, minimal product table).
 * Seeded from delivery-note line history + the item-weights spreadsheet.
 * Create-only: existing product rows are never overwritten, so re-running
 * the seed (it runs on every deploy) stays idempotent.
 */
import * as path from 'path';
import * as XLSX from 'xlsx';
import type { PrismaClient } from '@prisma/client';

/**
 * Normalize a part number the way product codes are stored:
 * trimmed + uppercased (numeric ITEM # values become plain digit strings).
 */
export function normalizeProductCode(raw: unknown): string {
  if (raw == null) return '';
  const s = typeof raw === 'number' ? String(Math.round(raw)) : String(raw);
  return s.trim().toUpperCase().slice(0, 80);
}

export type ProductHistoryRow = {
  code: string;
  description: string | null;
  unit_price: string | number | null;
};

export type ProductWeightRow = {
  code: string;
  description: string | null;
  weight_lb: number | null;
};

export type ProductSeedRow = {
  code: string;
  description: string | null;
  unit_price: string | number | null;
  weight_lb: number | null;
};

/**
 * Merge DN-line history with the weights spreadsheet into product seed rows.
 * History wins for description/unit price; the spreadsheet contributes
 * weight_lb (and a description when history has none).
 */
export function mergeProductSeedRows(
  history: ProductHistoryRow[],
  weights: ProductWeightRow[],
): ProductSeedRow[] {
  const byCode = new Map<string, ProductSeedRow>();
  for (const h of history) {
    const code = normalizeProductCode(h.code);
    if (!code || byCode.has(code)) continue;
    byCode.set(code, {
      code,
      description: h.description?.trim() || null,
      unit_price: h.unit_price,
      weight_lb: null,
    });
  }
  for (const w of weights) {
    const code = normalizeProductCode(w.code);
    if (!code) continue;
    const existing = byCode.get(code);
    if (existing) {
      if (w.weight_lb != null) existing.weight_lb = w.weight_lb;
      if (!existing.description && w.description?.trim()) {
        existing.description = w.description.trim();
      }
    } else {
      byCode.set(code, {
        code,
        description: w.description?.trim() || null,
        unit_price: null,
        weight_lb: w.weight_lb,
      });
    }
  }
  return [...byCode.values()];
}

/** Read { code, description, weight_lb } from the item-weights spreadsheet. */
export function readWeightRows(): ProductWeightRow[] {
  const file = path.join(__dirname, 'seed-data', 'item-weights.xlsx');
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.readFile(file);
  } catch {
    console.warn(
      `[seed] item-weights.xlsx not found at ${file}; skipping weights.`,
    );
    return [];
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });
  const out: ProductWeightRow[] = [];
  for (const r of rows) {
    const code = normalizeProductCode(
      r['ITEM #'] ?? r['Item #'] ?? r['item #'],
    );
    if (!code) continue;
    const weight =
      typeof r['Weight'] === 'number'
        ? r['Weight']
        : typeof r['weight'] === 'number'
          ? r['weight']
          : null;
    const description =
      r['Description'] != null ? String(r['Description']).trim() : null;
    out.push({
      code,
      description: description || null,
      weight_lb: weight,
    });
  }
  return out;
}

type HistoryQueryRow = {
  code: string;
  description: string | null;
  unit_price: string | null;
};

/** Backfill the product master. Create-only; safe to re-run on every deploy. */
export async function backfillProducts(prisma: PrismaClient): Promise<void> {
  const history = await prisma.$queryRaw<HistoryQueryRow[]>`
    SELECT DISTINCT ON (UPPER(TRIM("material_code")))
      UPPER(TRIM("material_code")) AS code,
      "material_description" AS description,
      "unit_price" AS unit_price
    FROM "delivery_note_lines"
    WHERE "material_code" IS NOT NULL AND TRIM("material_code") <> ''
    ORDER BY UPPER(TRIM("material_code")), "created_at" DESC
  `;
  const weights = readWeightRows();
  const rows = mergeProductSeedRows(history, weights);
  for (const row of rows) {
    await prisma.product.upsert({
      where: { code: row.code },
      update: {},
      create: {
        code: row.code,
        description: row.description,
        unit_price: row.unit_price ?? undefined,
        weight_lb: row.weight_lb,
      },
    });
  }
  console.log(`[seed] products: ensured ${rows.length} product rows`);
}
