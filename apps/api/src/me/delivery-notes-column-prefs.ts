/** Keep in sync with apps/web/src/lib/delivery-notes-columns.ts */

export const COLUMN_DISPLAY_ORDER = [
  'dn_number',
  'current_priority_no',
  'sold_to_name',
  'so_number',
  'customer_po',
  'po_date',
  'ship_to_address',
  'current_status',
  'shipping_type',
  'requested_delivery_date',
  'projected_ship_date',
] as const;

export type DeliveryNotesColumnKey = (typeof COLUMN_DISPLAY_ORDER)[number];

export const REQUIRED_DELIVERY_NOTES_COLUMNS: DeliveryNotesColumnKey[] = [
  'dn_number',
  'current_status',
];

/** Default when user has never saved: DN, Customer, SO #, PO #, PO date, Ship-to, Ship type, Priority, Req. delivery, Status */
export const DEFAULT_DELIVERY_NOTES_VISIBLE_COLUMNS: DeliveryNotesColumnKey[] =
  [
    'dn_number',
    'sold_to_name',
    'so_number',
    'customer_po',
    'po_date',
    'ship_to_address',
    'shipping_type',
    'current_priority_no',
    'requested_delivery_date',
    'current_status',
  ];

const ALLOWED = new Set<string>(COLUMN_DISPLAY_ORDER);

export function normalizeDeliveryNotesVisibleColumns(
  input: unknown,
): DeliveryNotesColumnKey[] {
  if (!Array.isArray(input)) {
    return [...DEFAULT_DELIVERY_NOTES_VISIBLE_COLUMNS];
  }
  const selected = input.filter(
    (x): x is DeliveryNotesColumnKey => typeof x === 'string' && ALLOWED.has(x),
  );
  const withRequired = new Set<DeliveryNotesColumnKey>([
    ...selected,
    ...REQUIRED_DELIVERY_NOTES_COLUMNS,
  ]);
  const ordered = COLUMN_DISPLAY_ORDER.filter((k) => withRequired.has(k));
  return ordered.length > 0
    ? ordered
    : [...DEFAULT_DELIVERY_NOTES_VISIBLE_COLUMNS];
}
