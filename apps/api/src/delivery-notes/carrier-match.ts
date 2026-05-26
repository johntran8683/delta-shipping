export type CarrierAccountRow = {
  carrier_code: string;
  account_number: string;
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
