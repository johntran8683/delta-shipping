/** Mirrors API `dn_status` enum for filter dropdowns (web package does not import Prisma). */
export const DN_STATUS_OPTIONS = [
  "IMPORTED",
  "PRIORITIZED",
  "PICKING",
  "PICKED",
  "PACKING",
  "PACKED",
  "SHIPPING_IN_PROGRESS",
  "SHIPPED",
  "ON_HOLD",
  "CANCELLED",
] as const;

/** Short label for UI (e.g. progress steps). */
export function formatDnStatusLabel(status: string): string {
  const s = status.trim().toUpperCase();
  if (s === "SHIPPING_IN_PROGRESS") return "Shipping";
  return s
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}
