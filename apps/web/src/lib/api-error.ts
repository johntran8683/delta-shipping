/** NestJS exception JSON often uses `message` as string or string[]. */
export function formatApiErrorPayload(data: unknown): string {
  if (!data || typeof data !== "object") return String(data ?? "");
  const rec = data as Record<string, unknown>;
  const msg = rec.message;
  if (typeof msg === "string") return msg;
  if (Array.isArray(msg)) return msg.filter(Boolean).join(" ");
  return JSON.stringify(data);
}
