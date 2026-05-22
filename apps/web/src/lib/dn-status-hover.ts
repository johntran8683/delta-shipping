import { formatDnStatusLabel } from "@/lib/dn-status";

/** Statuses that show a hover card with notes / outcome when available. */
export const STATUS_HOVER_STATUSES = new Set([
  "PICKED",
  "PACKED",
  "ON_HOLD",
  "CANCELLED",
]);

export type StatusHistoryEntry = {
  from_status?: string | null;
  to_status: string;
  message?: string | null;
  changed_at: string;
  actor_user?: {
    display_name?: string | null;
    email?: string;
  } | null;
  actor_role?: { code?: string; name?: string } | null;
};

export type StatusContextPayload = {
  message: string | null;
  changed_at: string;
  from_status: string | null;
  actor_display: string | null;
  actor_role: string | null;
  pack_completion_note?: string | null;
  pack_box_count?: number | null;
};

export type StatusHoverSection = {
  label: string;
  /** Single block of text (use `lines` for multi-line results). */
  body?: string;
  /** Bulleted lines under the label (pack result, etc.). */
  lines?: string[];
  kind: "note" | "result" | "text";
};

export type StatusHoverContent = {
  title: string;
  sections: StatusHoverSection[];
};

function normStatus(s: string): string {
  return String(s ?? "")
    .trim()
    .toUpperCase();
}

function parseHistory(raw: unknown): StatusHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: StatusHistoryEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const to = r.to_status;
    if (typeof to !== "string" || !to.trim()) continue;
    const changed = r.changed_at;
    out.push({
      from_status:
        typeof r.from_status === "string" ? r.from_status : null,
      to_status: to,
      message: typeof r.message === "string" ? r.message : null,
      changed_at:
        typeof changed === "string"
          ? changed
          : changed instanceof Date
            ? changed.toISOString()
            : "",
      actor_user:
        r.actor_user && typeof r.actor_user === "object"
          ? (r.actor_user as StatusHistoryEntry["actor_user"])
          : null,
      actor_role:
        r.actor_role && typeof r.actor_role === "object"
          ? (r.actor_role as StatusHistoryEntry["actor_role"])
          : null,
    });
  }
  return out;
}

function actorLabel(entry: StatusHistoryEntry): string | null {
  const u = entry.actor_user;
  if (!u) return null;
  const name = u.display_name?.trim();
  if (name) return name;
  return u.email?.trim() || null;
}

function formatWhen(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function latestEntryForStatus(
  history: StatusHistoryEntry[],
  status: string,
): StatusHistoryEntry | null {
  const want = normStatus(status);
  for (const row of history) {
    if (normStatus(row.to_status) === want) return row;
  }
  return null;
}

function contextFromPayload(
  payload: StatusContextPayload | null | undefined,
): StatusHistoryEntry | null {
  if (!payload?.changed_at) return null;
  return {
    from_status: payload.from_status,
    to_status: "",
    message: payload.message,
    changed_at: payload.changed_at,
    actor_user: payload.actor_display
      ? { display_name: payload.actor_display, email: payload.actor_display }
      : null,
    actor_role: payload.actor_role
      ? { code: payload.actor_role, name: payload.actor_role }
      : null,
  };
}

export type BuildStatusHoverInput = {
  statusHistory?: unknown;
  statusContext?: StatusContextPayload | null;
  packCompletionNote?: string | null;
  packBoxCount?: number | null;
};

/**
 * Build hover tooltip sections for the current DN status (PICKED, PACKED, ON_HOLD, CANCELLED).
 */
export function buildStatusHoverContent(
  currentStatus: string,
  input: BuildStatusHoverInput = {},
): StatusHoverContent | null {
  const status = normStatus(currentStatus);
  if (!STATUS_HOVER_STATUSES.has(status)) return null;

  const history = parseHistory(input.statusHistory);
  const entry =
    latestEntryForStatus(history, status) ??
    (input.statusContext
      ? {
          ...contextFromPayload(input.statusContext)!,
          to_status: status,
          message: input.statusContext.message,
        }
      : null);

  const packNote =
    input.packCompletionNote?.trim() ||
    input.statusContext?.pack_completion_note?.trim() ||
    null;
  const packBoxes =
    input.packBoxCount ?? input.statusContext?.pack_box_count ?? null;

  const sections: StatusHoverSection[] = [];
  const note = entry?.message?.trim() || null;

  if (status === "PICKED") {
    if (note) {
      sections.push({ label: "Note", body: note, kind: "note" });
    }
    sections.push({
      label: "Pick result",
      body: "Ready for packing.",
      kind: "result",
    });
  } else if (status === "PACKED") {
    const packLines: string[] = [];
    if (packNote) packLines.push(packNote);
    if (packBoxes != null && packBoxes > 0) {
      packLines.push(
        `${packBoxes} box${packBoxes === 1 ? "" : "es"} in pack session`,
      );
    }
    if (packLines.length === 0) {
      packLines.push("Pack session completed.");
    }
    sections.push({
      label: "Pack result",
      lines: packLines,
      kind: "result",
    });
  } else {
    if (note) {
      sections.push({
        label: status === "ON_HOLD" || status === "CANCELLED" ? "Reason" : "Note",
        body: note,
        kind: "note",
      });
    } else if (status === "ON_HOLD") {
      sections.push({
        label: "Hold",
        body: "Paused in the queue. Resume when ready to release.",
        kind: "text",
      });
    } else if (status === "CANCELLED") {
      sections.push({
        label: "Cancelled",
        body: "Removed from active processing. Resume from cancelled if needed.",
        kind: "text",
      });
    }

    if (entry) {
      const who = actorLabel(entry);
      const role = entry.actor_role?.name || entry.actor_role?.code || null;
      const when = formatWhen(entry.changed_at);
      const meta: string[] = [];
      if (who) meta.push(who);
      if (role) meta.push(role);
      meta.push(when);
      if (entry.from_status) {
        meta.unshift(`From ${formatDnStatusLabel(entry.from_status)}`);
      }
      sections.push({ label: "Recorded", body: meta.join(" · "), kind: "text" });
    }
  }

  if (sections.length === 0) return null;

  return {
    title: formatDnStatusLabel(status),
    sections,
  };
}

/** Hover input for DN detail (full history + latest pack session). */
export function detailStatusHoverInput(detail: {
  status_history?: unknown;
  completed_pack_sessions?: Array<{
    pack_completion_note?: string | null;
    boxes?: unknown[];
  }> | null;
}): BuildStatusHoverInput {
  const session = detail.completed_pack_sessions?.[0];
  return {
    statusHistory: detail.status_history,
    packCompletionNote: session?.pack_completion_note,
    packBoxCount: Array.isArray(session?.boxes) ? session.boxes.length : null,
  };
}
