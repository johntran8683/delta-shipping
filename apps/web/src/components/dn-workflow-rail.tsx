"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { getActiveRoleCode } from "@/lib/auth-storage";
import { formatDnStatusLabel } from "@/lib/dn-status";
import type { StatusHistoryEntry } from "@/lib/dn-status-hover";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type RailActor = {
  display_name?: string | null;
  email?: string | null;
} | null;

export type RailHandoff = {
  picked_by: RailActor;
  packed_by: RailActor;
  shipped_by: RailActor;
} | null;

export type PrimaryActionKey =
  | "START_PICKING"
  | "MARK_PICKED"
  | "START_PACKING"
  | "MARK_PACKED"
  | "START_SHIPPING"
  | "MARK_SHIPPED";

export type DnWorkflowRailProps = {
  status: string;
  onHoldFromStatus?: string | null;
  isRushed: boolean;
  rushReason?: string | null;
  currentPriorityNo: number | null;
  allowedNextStatuses: string[];
  canSetPriority: boolean;
  canMarkRush: boolean;
  canClearRush: boolean;
  busy: boolean;
  onPrimaryAction: (key: PrimaryActionKey) => void;
  onTransition: (toStatus: string, message: string) => Promise<boolean>;
  onPrioritySave: (toPriorityNo: number, reason: string) => Promise<boolean>;
  onRushSave: (rushed: boolean, reason: string) => Promise<boolean>;
  handoff?: RailHandoff | null;
  statusHistory: StatusHistoryEntry[];
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function normStatus(s: string): string {
  return String(s ?? "")
    .trim()
    .toUpperCase();
}

function activeRoleCode(): string {
  return (getActiveRoleCode() ?? "").trim().toUpperCase();
}

function isPackerRole(): boolean {
  return activeRoleCode() === "PACKER";
}

function actorLabel(actor: RailActor): string | null {
  if (!actor) return null;
  return (
    actor.display_name?.trim() || actor.email?.trim() || null
  );
}

function formatChangedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const btnBase =
  "inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
const btnPrimary =
  "btn-delta-primary w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40";
const btnSecondary =
  "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/80";
const btnDangerSecondary =
  "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40";
const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

const cardCls =
  "rounded-xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:shadow-none";
const cardTitleCls =
  "text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400";

/* ------------------------------------------------------------------ */
/* Pipeline stepper                                                    */
/* ------------------------------------------------------------------ */

const PIPELINE_STAGES = [
  "NEW",
  "PICKING",
  "PICKED",
  "PACKING",
  "PACKED",
  "SHIPPING_IN_PROGRESS",
  "SHIPPED",
] as const;

const STAGE_SHORT_LABEL: Record<string, string> = {
  NEW: "New",
  PICKING: "Picking",
  PICKED: "Picked",
  PACKING: "Packing",
  PACKED: "Packed",
  SHIPPING_IN_PROGRESS: "Shipping",
  SHIPPED: "Shipped",
};

export function PipelineStepper({ status }: { status: string }) {
  const s = normStatus(status);
  if (s === "CANCELLED") {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
          Cancelled
        </span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Terminal — no further actions.
        </span>
      </div>
    );
  }
  const onHold = s === "ON_HOLD";
  // When on hold, highlight the pipeline position as unknown; show hold badge.
  const currentIdx = onHold
    ? -1
    : PIPELINE_STAGES.indexOf(s as (typeof PIPELINE_STAGES)[number]);

  return (
    <div>
      <ol className="flex items-start" aria-label="Delivery note pipeline">
        {PIPELINE_STAGES.map((stage, i) => {
          const done = currentIdx > i;
          const current = currentIdx === i;
          return (
            <li
              key={stage}
              className={`flex min-w-0 items-start ${i < PIPELINE_STAGES.length - 1 ? "flex-1" : ""}`}
            >
              <div className="flex min-w-0 flex-col items-center gap-1">
                <span
                  title={STAGE_SHORT_LABEL[stage]}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition ${
                    done
                      ? "border-emerald-600 bg-emerald-600 dark:border-emerald-500 dark:bg-emerald-500"
                      : current
                        ? "border-sky-600 bg-sky-600 ring-4 ring-sky-600/20 dark:border-sky-400 dark:bg-sky-400 dark:ring-sky-400/20"
                        : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900"
                  }`}
                  aria-current={current ? "step" : undefined}
                >
                  {done ? (
                    <svg
                      className="h-2.5 w-2.5 text-white"
                      viewBox="0 0 10 10"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M2 5.2l2 2 4-4.4"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </span>
                <span
                  className={`max-w-full truncate text-[9px] leading-tight ${
                    current
                      ? "font-semibold text-slate-900 dark:text-slate-100"
                      : done
                        ? "text-slate-500 dark:text-slate-400"
                        : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {STAGE_SHORT_LABEL[stage]}
                </span>
              </div>
              {i < PIPELINE_STAGES.length - 1 ? (
                <span
                  className={`mx-0.5 mt-2 h-0.5 min-w-2 flex-1 rounded-full ${
                    currentIdx > i
                      ? "bg-emerald-600/70 dark:bg-emerald-500/70"
                      : "bg-slate-200 dark:bg-slate-700"
                  }`}
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex items-center gap-2">
        {onHold ? (
          <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            On hold
          </span>
        ) : null}
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {onHold
            ? "Paused — resume returns it to its previous step."
            : currentIdx >= 0
              ? `Step ${currentIdx + 1} of ${PIPELINE_STAGES.length} · ${STAGE_SHORT_LABEL[PIPELINE_STAGES[currentIdx]]}`
              : `Status: ${formatDnStatusLabel(s)}`}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

function RailModal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open ]);
  if (!mounted || !open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[240] flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-[1px] dark:bg-black/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-2xl sm:rounded-2xl"
      >
        <div className="border-b border-[color:var(--app-border)] px-5 py-4">
          <h2
            id={titleId}
            className="text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {description}
            </p>
          ) : null}
        </div>
        <div className="px-5 py-4">{children}</div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--app-border)] px-5 py-4">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const HOLD_DIALOG_COPY: Record<
  string,
  { title: string; description: string; confirm: string; danger?: boolean }
> = {
  ON_HOLD: {
    title: "Put on hold",
    description:
      "The note stays in the system but is paused in the queue. A reason is required for the audit trail.",
    confirm: "Put on hold",
  },
  CANCELLED: {
    title: "Cancel delivery note",
    description:
      "This marks the delivery note as cancelled. This cannot be undone. A reason is required for the audit trail.",
    confirm: "Cancel delivery note",
    danger: true,
  },
  RESUME: {
    title: "Resume delivery note",
    description:
      "Returns the note to the status it was in before being put on hold. A reason is required for the audit trail.",
    confirm: "Resume",
  },
};

/* ------------------------------------------------------------------ */
/* Workflow rail                                                       */
/* ------------------------------------------------------------------ */

type PrimaryActionDef = {
  key: PrimaryActionKey;
  label: string;
  hint: string;
  enabled: boolean;
  disabledReason: string;
} | null;

function primaryActionForStatus(
  status: string,
  allowed: Set<string>,
): PrimaryActionDef {
  const s = normStatus(status);
  switch (s) {
    case "NEW":
      return {
        key: "START_PICKING",
        label: "Start picking",
        hint: "Claim this note and begin picking its lines.",
        enabled: allowed.has("PICKING"),
        disabledReason: "Requires the Picker role",
      };
    case "PICKING":
      return {
        key: "MARK_PICKED",
        label: "Mark picked",
        hint: "All lines are picked and ready for packing.",
        enabled: allowed.has("PICKED"),
        disabledReason: "Requires the Picker role",
      };
    case "PICKED":
      return {
        key: "START_PACKING",
        label: "Start packing",
        hint: "Open a pack session — combine with other picked notes if needed.",
        enabled: isPackerRole(),
        disabledReason: "Requires the Packer role",
      };
    case "PACKING":
      return {
        key: "MARK_PACKED",
        label: "Mark packed",
        hint: "Enter boxes (weight and dimensions), then complete the session.",
        enabled: isPackerRole(),
        disabledReason: "Requires the Packer role",
      };
    case "PACKED":
      return {
        key: "START_SHIPPING",
        label: "Start shipping",
        hint: "Hand the packed note to shipping.",
        enabled: allowed.has("SHIPPING_IN_PROGRESS"),
        disabledReason: "Requires the Shipper role",
      };
    case "SHIPPING_IN_PROGRESS":
      return {
        key: "MARK_SHIPPED",
        label: "Mark shipped",
        hint: "Record the tracking number to close the note.",
        enabled: allowed.has("SHIPPED"),
        disabledReason: "Requires the Shipper role",
      };
    default:
      return null;
  }
}

function actorRow(label: string, actor: RailActor) {
  const name = actorLabel(actor);
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
        {name ?? <span className="font-normal text-slate-400">—</span>}
      </span>
    </div>
  );
}

export function DnWorkflowRail(props: DnWorkflowRailProps) {
  const {
    status,
    onHoldFromStatus,
    isRushed,
    rushReason,
    currentPriorityNo,
    allowedNextStatuses,
    canSetPriority,
    canMarkRush,
    canClearRush,
    busy,
    onPrimaryAction,
    onTransition,
    onPrioritySave,
    onRushSave,
    handoff,
    statusHistory,
  } = props;

  const s = normStatus(status);
  const allowed = new Set(allowedNextStatuses.map((x) => normStatus(x)));

  const [reasonTarget, setReasonTarget] = useState<
    "ON_HOLD" | "CANCELLED" | "RESUME" | null
  >(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [rushOpen, setRushOpen] = useState(false);
  const [rushTarget, setRushTarget] = useState<boolean | null>(null);
  const [rushFormReason, setRushFormReason] = useState("");
  const [rushError, setRushError] = useState<string | null>(null);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [priorityNo, setPriorityNo] = useState(
    currentPriorityNo != null ? currentPriorityNo : 1,
  );
  const [priorityReason, setPriorityReason] = useState("");
  const [priorityError, setPriorityError] = useState<string | null>(null);

  useEffect(() => {
    if (reasonTarget) {
      setReason("");
      setReasonError(null);
    }
  }, [reasonTarget]);
  useEffect(() => {
    if (rushOpen) {
      setRushFormReason("");
      setRushError(null);
    }
  }, [rushOpen]);
  useEffect(() => {
    if (priorityOpen) {
      setPriorityNo(currentPriorityNo != null ? currentPriorityNo : 1);
      setPriorityReason("");
      setPriorityError(null);
    }
  }, [priorityOpen, currentPriorityNo]);

  const onHold = s === "ON_HOLD";
  const canHold = allowed.has("ON_HOLD");
  const canCancel = allowed.has("CANCELLED");
  const canResume =
    onHold && !!onHoldFromStatus && allowed.has(normStatus(onHoldFromStatus));

  // Primary action: resume when on hold, otherwise the workflow step.
  const primary: PrimaryActionDef =
    onHold && onHoldFromStatus
      ? {
          key: "START_PICKING", // unused — resume goes through the reason dialog
          label: `Resume to ${formatDnStatusLabel(onHoldFromStatus)}`,
          hint: "Returns the note to the status it was in before being held.",
          enabled: canResume,
          disabledReason: "Requires Supervisor, Team lead, or CSA",
        }
      : primaryActionForStatus(s, allowed);

  function handlePrimary() {
    if (!primary || !primary.enabled || busy) return;
    if (onHold && onHoldFromStatus) {
      setReasonTarget("RESUME");
      return;
    }
    onPrimaryAction(primary.key);
  }

  async function submitReason() {
    if (!reasonTarget) return;
    const msg = reason.trim();
    if (!msg) {
      setReasonError("A reason is required.");
      return;
    }
    setReasonError(null);
    const actualTarget =
      reasonTarget === "RESUME" ? (onHoldFromStatus ?? "NEW") : reasonTarget;
    const ok = await onTransition(actualTarget, msg);
    if (ok) setReasonTarget(null);
  }

  async function submitRush() {
    if (rushTarget === null) return;
    const msg = rushFormReason.trim();
    if (!msg) {
      setRushError("A reason is required.");
      return;
    }
    setRushError(null);
    const ok = await onRushSave(rushTarget, msg);
    if (ok) {
      setRushOpen(false);
      setRushTarget(null);
    }
  }

  async function submitPriority() {
    const msg = priorityReason.trim();
    if (!Number.isInteger(priorityNo) || priorityNo < 1) {
      setPriorityError("Enter a priority number of 1 or higher.");
      return;
    }
    if (!msg) {
      setPriorityError("A reason is required.");
      return;
    }
    setPriorityError(null);
    const ok = await onPrioritySave(priorityNo, msg);
    if (ok) setPriorityOpen(false);
  }

  const reasonCopy = reasonTarget ? HOLD_DIALOG_COPY[reasonTarget] : null;
  const history = [...statusHistory]
    .filter((h) => h && h.to_status)
    .sort(
      (a, b) =>
        new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime(),
    );

  const holdResumeAction = onHold ? (
    <button
      type="button"
      disabled={busy || !canResume}
      title={canResume ? undefined : "Requires Supervisor, Team lead, or CSA"}
      onClick={() => setReasonTarget("RESUME")}
      className={`${btnBase} ${btnSecondary} flex-1`}
    >
      Resume
    </button>
  ) : (
    <button
      type="button"
      disabled={busy || !canHold}
      title={canHold ? undefined : "Requires Supervisor, Team lead, or CSA"}
      onClick={() => setReasonTarget("ON_HOLD")}
      className={`${btnBase} ${btnSecondary} flex-1`}
    >
      Hold
    </button>
  );

  return (
    <div className="space-y-4">
      {/* -------- Status & actions -------- */}
      <section className={`${cardCls} p-4`} aria-label="Workflow">
        <h2 className={cardTitleCls}>Workflow</h2>
        <div className="mt-3">
          <PipelineStepper status={status} />
        </div>

        {primary ? (
          <div className="mt-4">
            <button
              type="button"
              disabled={busy || !primary.enabled}
              title={
                primary.enabled ? primary.hint : primary.disabledReason
              }
              onClick={handlePrimary}
              className={btnPrimary}
            >
              {busy ? "Working…" : primary.label}
            </button>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {primary.enabled ? primary.hint : primary.disabledReason}
            </p>
          </div>
        ) : s === "SHIPPED" ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            Shipped — this note is complete.
          </p>
        ) : null}

        <div className="mt-4 border-t border-[color:var(--app-border)] pt-3">
          <div className="flex gap-2">
            {holdResumeAction}
            <button
              type="button"
              disabled={busy || !canCancel}
              title={
                canCancel ? undefined : "Requires Supervisor, Team lead, or CSA"
              }
              onClick={() => setReasonTarget("CANCELLED")}
              className={`${btnBase} ${btnDangerSecondary} flex-1`}
            >
              Cancel DN
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy || (!canMarkRush && !canClearRush)}
              title={
                canMarkRush || canClearRush
                  ? undefined
                  : "Requires Supervisor, Team lead, or CSA"
              }
              onClick={() => {
                setRushTarget(!isRushed);
                setRushOpen(true);
              }}
              className={`${btnBase} ${btnSecondary} flex-1`}
            >
              {isRushed ? "Clear rush" : "Mark rush"}
            </button>
            <button
              type="button"
              disabled={busy || !canSetPriority}
              title={canSetPriority ? undefined : "Requires the Supervisor role"}
              onClick={() => setPriorityOpen(true)}
              className={`${btnBase} ${btnSecondary} flex-1`}
            >
              Set priority
            </button>
          </div>
          {(isRushed || currentPriorityNo != null) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {isRushed ? (
                <span
                  className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                  title={rushReason ?? undefined}
                >
                  Rushed{rushReason ? ` — ${rushReason}` : ""}
                </span>
              ) : null}
              {currentPriorityNo != null ? (
                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  P{currentPriorityNo}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {/* -------- Ownership -------- */}
      <section className={`${cardCls} px-4 py-3`} aria-label="Ownership">
        <h2 className={cardTitleCls}>Handled by</h2>
        <div className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
          {actorRow("Picked", handoff?.picked_by ?? null)}
          {actorRow("Packed", handoff?.packed_by ?? null)}
          {actorRow("Shipped", handoff?.shipped_by ?? null)}
        </div>
      </section>

      {/* -------- Activity -------- */}
      <section className={`${cardCls} px-4 py-3`} aria-label="Activity">
        <h2 className={cardTitleCls}>Activity</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            No status changes recorded yet.
          </p>
        ) : (
          <ol className="mt-2 space-y-0">
            {history.map((h, i) => {
              const actor =
                h.actor_user?.display_name?.trim() ||
                h.actor_user?.email?.trim() ||
                null;
              const last = i === history.length - 1;
              return (
                <li key={`${h.changed_at}-${h.to_status}-${i}`} className="relative flex gap-2.5 pb-4 last:pb-0">
                  <span className="flex flex-col items-center" aria-hidden>
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        i === 0
                          ? "bg-sky-600 dark:bg-sky-400"
                          : "bg-slate-300 dark:bg-slate-600"
                      }`}
                    />
                    {!last ? (
                      <span className="w-px flex-1 bg-slate-200 dark:bg-slate-700" />
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-100">
                      {formatDnStatusLabel(h.to_status)}
                      {actor ? (
                        <span className="font-normal text-slate-500 dark:text-slate-400">
                          {" "}
                          · {actor}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                      {formatChangedAt(h.changed_at)}
                      {h.message?.trim() ? ` · ${h.message.trim()}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* -------- Dialogs -------- */}
      <RailModal
        open={reasonTarget !== null}
        onClose={() => {
          if (!busy) setReasonTarget(null);
        }}
        title={reasonCopy?.title ?? ""}
        description={reasonCopy?.description}
        footer={
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setReasonTarget(null)}
              className={`${btnBase} ${btnSecondary}`}
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitReason()}
              className={`${btnBase} ${reasonCopy?.danger ? "bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-500" : "btn-delta-primary"}`}
            >
              {busy ? "Saving…" : (reasonCopy?.confirm ?? "Confirm")}
            </button>
          </>
        }
      >
        <label
          className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
          htmlFor="rail-status-reason"
        >
          Reason
        </label>
        <textarea
          id="rail-status-reason"
          rows={3}
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Required for the audit trail"
          className={inputCls}
        />
        {reasonError ? (
          <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">
            {reasonError}
          </p>
        ) : null}
      </RailModal>

      <RailModal
        open={rushOpen}
        onClose={() => {
          if (!busy) {
            setRushOpen(false);
            setRushTarget(null);
          }
        }}
        title={rushTarget ? "Mark as rush" : "Clear rush"}
        description={
          rushTarget
            ? "Rush notes sort first in every queue. A reason is required for the audit trail."
            : "Remove the rush flag from this note. A reason is required for the audit trail."
        }
        footer={
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRushOpen(false);
                setRushTarget(null);
              }}
              className={`${btnBase} ${btnSecondary}`}
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitRush()}
              className={`${btnBase} btn-delta-primary`}
            >
              {busy ? "Saving…" : rushTarget ? "Mark rush" : "Clear rush"}
            </button>
          </>
        }
      >
        <label
          className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
          htmlFor="rail-rush-reason"
        >
          Reason
        </label>
        <textarea
          id="rail-rush-reason"
          rows={3}
          value={rushFormReason}
          disabled={busy}
          onChange={(e) => setRushFormReason(e.target.value)}
          placeholder="Required for the audit trail"
          className={inputCls}
        />
        {rushError ? (
          <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">
            {rushError}
          </p>
        ) : null}
      </RailModal>

      <RailModal
        open={priorityOpen}
        onClose={() => {
          if (!busy) setPriorityOpen(false);
        }}
        title="Set priority"
        description="Lower numbers sort first. A reason is required for the audit trail."
        footer={
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPriorityOpen(false)}
              className={`${btnBase} ${btnSecondary}`}
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitPriority()}
              className={`${btnBase} btn-delta-primary`}
            >
              {busy ? "Saving…" : "Save priority"}
            </button>
          </>
        }
      >
        <label
          className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
          htmlFor="rail-priority-no"
        >
          Priority number
        </label>
        <input
          id="rail-priority-no"
          type="number"
          min={1}
          step={1}
          value={priorityNo}
          disabled={busy}
          onChange={(e) => setPriorityNo(Number(e.target.value))}
          className={inputCls}
        />
        <label
          className="mb-1.5 mt-3 block text-xs font-medium text-slate-700 dark:text-slate-300"
          htmlFor="rail-priority-reason"
        >
          Reason
        </label>
        <textarea
          id="rail-priority-reason"
          rows={3}
          value={priorityReason}
          disabled={busy}
          onChange={(e) => setPriorityReason(e.target.value)}
          placeholder="Required for the audit trail"
          className={inputCls}
        />
        {priorityError ? (
          <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">
            {priorityError}
          </p>
        ) : null}
      </RailModal>
    </div>
  );
}
