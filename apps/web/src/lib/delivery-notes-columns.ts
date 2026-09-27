/**
 * Delivery notes list column visibility.
 * Keep column keys and order in sync with apps/api/src/me/delivery-notes-column-prefs.ts
 */

export type ColumnKey =
  | "dn_number"
  | "current_priority_no"
  | "sold_to_name"
  | "so_number"
  | "customer_po"
  | "po_date"
  | "ship_to_address"
  | "current_status"
  | "shipping_type"
  | "requested_delivery_date"
  | "projected_ship_date";

export const COLUMN_DISPLAY_ORDER: ColumnKey[] = [
  "dn_number",
  "current_priority_no",
  "sold_to_name",
  "so_number",
  "customer_po",
  "po_date",
  "ship_to_address",
  "current_status",
  "shipping_type",
  "requested_delivery_date",
  "projected_ship_date",
];

export const REQUIRED_COLUMNS: ColumnKey[] = [
  "dn_number",
  "current_status",
];

/** Default for new users / empty server preference */
export const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = [
  "dn_number",
  "sold_to_name",
  "so_number",
  "customer_po",
  "po_date",
  "ship_to_address",
  "shipping_type",
  "current_priority_no",
  "requested_delivery_date",
  "current_status",
];

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  dn_number: "DN #",
  current_priority_no: "Priority",
  sold_to_name: "Customer",
  so_number: "SO #",
  customer_po: "PO #",
  po_date: "PO date",
  ship_to_address: "Ship-to",
  current_status: "Status",
  shipping_type: "Ship type",
  requested_delivery_date: "Req. delivery",
  projected_ship_date: "Proj. ship",
};

const ALLOWED = new Set<ColumnKey>(COLUMN_DISPLAY_ORDER);

export function normalizeVisibleColumns(input: unknown): ColumnKey[] {
  if (!Array.isArray(input)) {
    return [...DEFAULT_VISIBLE_COLUMNS];
  }
  const selected = input.filter(
    (x): x is ColumnKey => typeof x === "string" && ALLOWED.has(x as ColumnKey),
  );
  const withRequired = new Set<ColumnKey>([...selected, ...REQUIRED_COLUMNS]);
  const ordered = COLUMN_DISPLAY_ORDER.filter((k) => withRequired.has(k));
  return ordered.length > 0 ? ordered : [...DEFAULT_VISIBLE_COLUMNS];
}
