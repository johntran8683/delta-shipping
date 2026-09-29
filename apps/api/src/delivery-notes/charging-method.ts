/**
 * Charging method for a delivery note.
 * Optional Excel column; recognized headers are listed in
 * CHARGING_METHOD_HEADERS. Fixed list agreed with the shipping team.
 */
export const CHARGING_METHODS = [
  'Prepaid and Added',
  'Collect',
  'Prepaid but No Charge',
] as const;

/** Excel header names recognized for the charging method column. */
export const CHARGING_METHOD_HEADERS = ['Ship method', 'Charging Method'];

export type ChargingMethod = (typeof CHARGING_METHODS)[number];

/**
 * Normalize a raw value to the fixed list (case-insensitive, trimmed).
 * Returns the canonical value, or null when the input is blank/missing.
 * Throws when the value is present but not on the fixed list.
 */
export function parseChargingMethod(
  raw: unknown,
  context?: string,
): ChargingMethod | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  const hit = CHARGING_METHODS.find(
    (m) => m.toLowerCase() === text.toLowerCase(),
  );
  if (!hit) {
    const where = context ? ` for ${context}` : '';
    throw new Error(
      `Invalid charging method "${text}"${where}. ` +
        `Expected one of: ${CHARGING_METHODS.join(', ')}.`,
    );
  }
  return hit;
}
