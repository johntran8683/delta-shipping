import type { ColumnKey } from "@/lib/delivery-notes-columns";

export type DeliveryNoteSortField =
  | "priority"
  | "customer"
  | "dn_number"
  | "status"
  | "shipping_type";

export type DeliveryNoteSortDir = "asc" | "desc";

/** Column keys that support server-side sort (must match API `sortBy`). */
export const SORTABLE_COLUMN_KEYS: Partial<
  Record<ColumnKey, DeliveryNoteSortField>
> = {
  current_priority_no: "priority",
  sold_to_name: "customer",
  dn_number: "dn_number",
  current_status: "status",
  shipping_type: "shipping_type",
};

export function columnKeyToSortField(
  key: ColumnKey,
): DeliveryNoteSortField | undefined {
  return SORTABLE_COLUMN_KEYS[key];
}

export function sortFieldToColumnKey(
  field: DeliveryNoteSortField,
): ColumnKey | undefined {
  const entry = Object.entries(SORTABLE_COLUMN_KEYS).find(
    ([, v]) => v === field,
  );
  return entry ? (entry[0] as ColumnKey) : undefined;
}
