export type CarrierAccountRow = {
  carrier_code: string;
  account_number: string;
  /** The ship-to location this account belongs to; null = customer-wide. */
  ship_to_location_id?: string | null;
};

export function normalizeCarrierToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function carrierMatchesShippingType(
  carrierCode: string,
  shippingType: string | null | undefined,
): boolean {
  const carrier = normalizeCarrierToken(carrierCode);
  const ship = normalizeCarrierToken(shippingType ?? '');
  if (!carrier || !ship) return false;
  return ship.includes(carrier) || carrier.includes(ship);
}

export function filterCarrierAccountsForShippingType(
  accounts: readonly CarrierAccountRow[],
  shippingType: string | null | undefined,
): CarrierAccountRow[] {
  if (!shippingType?.trim()) return [];
  return accounts.filter((a) =>
    carrierMatchesShippingType(a.carrier_code, shippingType),
  );
}

/**
 * Accounts for one delivery note, location first. Accounts linked to the
 * note's ship-to location come before customer-wide accounts (those with no
 * location), so the first match is the location's own account when it has
 * one. Accounts linked to a *different* location are excluded: they belong
 * to another site of the same customer.
 */
export function resolveCarrierAccountsForLocation(
  accounts: readonly CarrierAccountRow[],
  shippingType: string | null | undefined,
  shipToLocationId: string | null | undefined,
): CarrierAccountRow[] {
  const matched = filterCarrierAccountsForShippingType(
    accounts,
    shippingType,
  );
  if (!shipToLocationId) return matched;
  const locationAccounts = matched.filter(
    (a) => a.ship_to_location_id === shipToLocationId,
  );
  const customerWideAccounts = matched.filter(
    (a) => a.ship_to_location_id == null,
  );
  return [...locationAccounts, ...customerWideAccounts];
}

/** Best-effort carrier code for shipment records from free-text ship method. */
export function inferCarrierCodeFromShippingType(
  shippingType: string | null | undefined,
): string {
  const ship = normalizeCarrierToken(shippingType ?? '');
  if (!ship) return 'OTHER';
  if (ship.includes('FEDEX')) return 'FEDEX';
  if (ship.includes('UPS')) return 'UPS';
  if (ship.includes('USPS')) return 'USPS';
  if (ship.includes('DHL')) return 'DHL';
  return ship.slice(0, 30);
}
