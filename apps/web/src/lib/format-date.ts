/**
 * Format a date-only value (YYYY-MM-DD, or an ISO string from a @db.Date
 * column like "2026-03-10T00:00:00.000Z").
 *
 * Parses the calendar date directly instead of `new Date(iso)` so the day
 * never shifts when the viewer is behind UTC (e.g. America/Vancouver).
 * Falls back to the raw value when it cannot be parsed.
 */

/** "Mar 10, 2026" — for detail views. */
export function formatDateOnly(value: string | null | undefined): string {
  const d = parseDateOnly(value);
  if (!d) return value?.trim() ? value.trim() : "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "Mar 10" this year, "Mar 10, '25" otherwise — for dense tables. */
export function formatDateOnlyCompact(
  value: string | null | undefined,
): string {
  const d = parseDateOnly(value);
  if (!d) return value?.trim() ? value.trim() : "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
