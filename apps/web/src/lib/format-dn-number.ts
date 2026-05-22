/**
 * Formats delivery note numbers for readability: groups of 3 digits from the
 * left, then the last 4 digits together (e.g. `8113229852` → `811 322 9852`).
 * Values that already use `-`, `/`, or `_` are left as-is (aside from
 * normalizing whitespace).
 */
export function formatDeliveryNoteNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  if (/[-_/]/.test(trimmed)) {
    return trimmed.replace(/\s+/g, " ").trim();
  }

  const core = trimmed.replace(/\s+/g, "");
  if (core.length <= 4) return core;

  const suffix = core.slice(-4);
  const prefix = core.slice(0, -4);
  const prefixChunks: string[] = [];
  for (let i = 0; i < prefix.length; i += 3) {
    prefixChunks.push(prefix.slice(i, i + 3));
  }
  return [...prefixChunks, suffix].join(" ");
}
