/**
 * Group-shipping policy: which delivery notes may ship together.
 *
 * Notes ship together when they share the same customer, ship-to, and ship
 * method. This mirrors the `ship_together` SQL used by listShipTogetherPeers
 * (equality on sold_to_code / ship_to_code, null-safe ship_to_location_id,
 * trimmed shipping_type).
 */

export type ShipGroupKeys = {
  sold_to_code: string | null;
  ship_to_code: string | null;
  ship_to_location_id: string | null;
  shipping_type: string | null;
};

/** True when two notes share customer, ship-to, and ship method. */
export function sameShipGroup(a: ShipGroupKeys, b: ShipGroupKeys): boolean {
  return (
    (a.sold_to_code ?? null) === (b.sold_to_code ?? null) &&
    (a.ship_to_code ?? null) === (b.ship_to_code ?? null) &&
    (a.ship_to_location_id ?? null) === (b.ship_to_location_id ?? null) &&
    (a.shipping_type ?? '').trim() === (b.shipping_type ?? '').trim()
  );
}

export type ShipPeerRow = {
  id: string;
  dn_number: string;
  current_status: string;
  total_products: string;
};

/** Statuses that count as "not packed yet" for the wait-or-ship notice. */
export const SHIP_GROUP_NOT_PACKED_STATUSES: ReadonlySet<string> = new Set([
  'NEW',
  'PICKING',
  'PICKED',
  'PACKING',
]);

/**
 * Splits ship-together peers for the start-shipping picker: PACKED notes the
 * shipper may add, and notes that are not packed yet (the wait-or-ship
 * notice). Session mates and notes in other statuses are left out.
 */
export function splitShipGroupOptions(
  peers: ShipPeerRow[],
  sessionMemberIds: ReadonlySet<string>,
): { pickable: ShipPeerRow[]; notPacked: ShipPeerRow[] } {
  const pickable: ShipPeerRow[] = [];
  const notPacked: ShipPeerRow[] = [];
  for (const p of peers) {
    if (sessionMemberIds.has(p.id)) {
      continue;
    }
    if (p.current_status === 'PACKED') {
      pickable.push(p);
    } else if (SHIP_GROUP_NOT_PACKED_STATUSES.has(p.current_status)) {
      notPacked.push(p);
    }
  }
  return { pickable, notPacked };
}
