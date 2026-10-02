import { dn_status } from '@prisma/client';

/**
 * Circle Count: locate parts on delivery notes that are physically in
 * progress on the floor — PICKED, PACKING, PACKED, or SHIPPING (in progress).
 */
export const CIRCLE_COUNT_STATUSES: dn_status[] = [
  dn_status.PICKED,
  dn_status.PACKING,
  dn_status.PACKED,
  dn_status.SHIPPING_IN_PROGRESS,
];

export type CircleCountUserRow = {
  display_name: string | null;
  email: string;
} | null;

export type CircleCountLineRow = {
  material_code: string | null;
  material_description: string | null;
  shipped_qty: { toString(): string } | null;
  delivery_note: {
    id: string;
    dn_number: string;
    current_status: dn_status;
    current_priority_no: number | null;
    sold_to_code: string;
    customer: { sold_to_name: string } | null;
    packing_started_by: CircleCountUserRow;
    shipping_started_by: CircleCountUserRow;
  };
};

export type CircleCountRow = {
  part: string;
  description: string | null;
  qty: number | null;
  delivery_note_id: string;
  dn_number: string;
  status: dn_status;
  priority: number | null;
  customer: string;
  /** Packer (PACKING) or shipper (SHIPPING) handling the note, else null. */
  processing_by: string | null;
};

/** Trim, drop empties, de-duplicate — keeping the order the user typed. */
export function normalizePartNumbers(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input ?? []) {
    const p = String(raw ?? '').trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function userLabel(u: CircleCountUserRow): string | null {
  if (!u) return null;
  return u.display_name?.trim() || u.email || null;
}

/**
 * Shape raw line rows into the Circle Count result: one row per part found
 * on a note, ordered by the part's position in the searched list, then by
 * priority (lowest first, unset last), then DN number. Searched parts with
 * no matching line come back in `notFound`, in searched order.
 */
export function buildCircleCountResult(
  parts: string[],
  lines: CircleCountLineRow[],
): { rows: CircleCountRow[]; notFound: string[] } {
  const order = new Map<string, number>(parts.map((p, i) => [p, i]));
  const found = new Set<string>();
  const rows: CircleCountRow[] = [];
  for (const l of lines) {
    const part = (l.material_code ?? '').trim();
    if (!part || !order.has(part)) continue;
    found.add(part);
    const dn = l.delivery_note;
    const processor =
      dn.current_status === dn_status.PACKING
        ? dn.packing_started_by
        : dn.current_status === dn_status.SHIPPING_IN_PROGRESS
          ? dn.shipping_started_by
          : null;
    const qtyNum =
      l.shipped_qty == null ? NaN : Number(l.shipped_qty.toString());
    rows.push({
      part,
      description: l.material_description,
      qty: Number.isFinite(qtyNum) ? qtyNum : null,
      delivery_note_id: dn.id,
      dn_number: dn.dn_number,
      status: dn.current_status,
      priority: dn.current_priority_no,
      customer: dn.customer?.sold_to_name ?? dn.sold_to_code,
      processing_by: userLabel(processor),
    });
  }
  rows.sort((a, b) => {
    const byPart = (order.get(a.part) ?? 0) - (order.get(b.part) ?? 0);
    if (byPart !== 0) return byPart;
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.dn_number.localeCompare(b.dn_number);
  });
  return { rows, notFound: parts.filter((p) => !found.has(p)) };
}
