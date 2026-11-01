/** One recorded outcome for a single successful Shipping IDs Excel row. */
export type ImportCustomerResultRow = {
  customer_id: string | null;
  sold_to_code: string;
  sold_to_name: string;
  outcome: string;
  accounts_upserted: number;
  excel_row: number | null;
};

/** One customer entry for the import report, grouped across its rows. */
export type GroupedCustomerImportResult = {
  customer_id: string | null;
  sold_to_code: string;
  sold_to_name: string;
  outcome: 'CREATED' | 'UPDATED';
  accounts_upserted: number;
  excel_row: number | null;
};

/**
 * Group per-row import outcomes by customer. A customer appearing twice in
 * one file (duplicate sold-to code) keeps a single entry: CREATED wins over
 * UPDATED (the batch did create the customer), account counts sum, the
 * earliest Excel row is kept, and the name is the latest row's (matching
 * what the customer screen shows now). Rows arrive oldest-first; grouping
 * preserves first-seen order.
 */
export function groupCustomerImportResults(
  rows: ImportCustomerResultRow[],
): GroupedCustomerImportResult[] {
  const byKey = new Map<string, GroupedCustomerImportResult>();
  for (const r of rows) {
    const key = r.customer_id ?? `code:${r.sold_to_code}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        customer_id: r.customer_id,
        sold_to_code: r.sold_to_code,
        sold_to_name: r.sold_to_name,
        outcome: r.outcome === 'CREATED' ? 'CREATED' : 'UPDATED',
        accounts_upserted: r.accounts_upserted,
        excel_row: r.excel_row,
      });
      continue;
    }
    if (prev.outcome !== 'CREATED' && r.outcome === 'CREATED') {
      prev.outcome = 'CREATED';
    }
    prev.accounts_upserted += r.accounts_upserted;
    if (
      r.excel_row != null &&
      (prev.excel_row == null || r.excel_row < prev.excel_row)
    ) {
      prev.excel_row = r.excel_row;
    }
    prev.sold_to_name = r.sold_to_name;
  }
  return [...byKey.values()];
}
