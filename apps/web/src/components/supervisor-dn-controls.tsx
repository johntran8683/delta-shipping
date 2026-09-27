"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { StatusBadgeWithHover } from "@/components/status-badge-with-hover";
import { detailStatusHoverInput } from "@/lib/dn-status-hover";
import { RushIndicator, RushIndicatorTheme } from "@/components/rush-indicator";

const btnBase =
  "inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-semibold transition disabled:pointer-events-none disabled:opacity-40";
const btnGhost =
  "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900";
const btnPrimary =
  "btn-delta-primary shadow-sm";
const btnDanger =
  "border border-red-300/90 bg-white text-red-800 hover:bg-red-50 dark:border-red-900/50 dark:bg-slate-950 dark:text-red-300 dark:hover:bg-red-950/40";
const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

type SupervisorStatusTarget = "ON_HOLD" | "CANCELLED" | "PRIORITIZED";

const STATUS_ACTION: Record<
  SupervisorStatusTarget,
  {
    label: string;
    shortLabel: string;
    title: string;
    description: string;
    confirm: string;
    variant: "default" | "danger";
  }
> = {
  ON_HOLD: {
    label: "Put on hold",
    shortLabel: "Hold",
    title: "Put delivery note on hold",
    description:
      "The note stays in the system but is paused in the queue. A reason is required for the audit trail.",
    confirm: "Put on hold",
    variant: "default",
  },
  CANCELLED: {
    label: "Cancel delivery note",
    shortLabel: "Cancel DN",
    title: "Cancel delivery note",
    description:
      "This marks the delivery note as cancelled. A reason is required for the audit trail.",
    confirm: "Cancel delivery note",
    variant: "danger",
  },
  PRIORITIZED: {
    label: "Resume in queue",
    shortLabel: "Resume",
    title: "Resume in queue",
    description:
      "Returns the note to the prioritized queue. A reason is required for the audit trail.",
    confirm: "Resume",
    variant: "default",
  },
};

function normStatus(s: string): string {
  return String(s ?? "")
    .trim()
    .toUpperCase();
}

/** Contextual primary workflow action (Option B). */
function primaryWorkflowAction(
  allowed: Set<string>,
  currentStatus: string,
): SupervisorStatusTarget | null {
  const status = normStatus(currentStatus);
  if (
    allowed.has("PRIORITIZED") &&
    (status === "ON_HOLD" || status === "CANCELLED")
  ) {
    return "PRIORITIZED";
  }
  if (
    allowed.has("ON_HOLD") &&
    status !== "ON_HOLD" &&
    status !== "CANCELLED" &&
    status !== "SHIPPED"
  ) {
    return "ON_HOLD";
  }
  if (allowed.has("PRIORITIZED")) return "PRIORITIZED";
  if (allowed.has("ON_HOLD")) return "ON_HOLD";
  return null;
}

function workflowSecondaryActions(
  allowed: Set<string>,
  primary: SupervisorStatusTarget | null,
): SupervisorStatusTarget[] {
  const out: SupervisorStatusTarget[] = [];
  for (const target of ["PRIORITIZED", "ON_HOLD"] as const) {
    if (!allowed.has(target) || target === primary) continue;
    out.push(target);
  }
  return out;
}

export type SupervisorDnControlsProps = {
  currentStatus: string;
  isOpen: boolean;
  isRushed: boolean;
  storedRushReason?: string | null;
  currentPriorityNo: number | null;
  allowedNextStatuses: string[];
  canSetPriority: boolean;
  canMarkRush: boolean;
  canClearRush: boolean;
  busy: boolean;
  onTransition: (toStatus: string, message: string) => Promise<boolean>;
  onPrioritySave: (toPriorityNo: number, reason: string) => Promise<boolean>;
  onRushSave: (rushed: boolean, reason: string) => Promise<boolean>;
  onPrintShippingLabel?: () => void;
  onPrintPoLabel?: () => void;
  statusHistory?: unknown;
  completedPackSessions?: Array<{
    pack_completion_note?: string | null;
    boxes?: unknown[];
  }> | null;
};

function SupervisorModal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

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
  }, [open]);

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

export function SupervisorDnControls({
  currentStatus,
  isOpen,
  isRushed,
  storedRushReason,
  currentPriorityNo,
  allowedNextStatuses,
  canSetPriority,
  canMarkRush,
  canClearRush,
  busy,
  onTransition,
  onPrioritySave,
  onRushSave,
  onPrintShippingLabel,
  onPrintPoLabel,
  statusHistory,
  completedPackSessions,
}: SupervisorDnControlsProps) {
  const allowed = new Set(
    allowedNextStatuses.map((s) => s.trim().toUpperCase()),
  );
  const statusNorm = normStatus(currentStatus);
  const primaryWorkflow = primaryWorkflowAction(allowed, currentStatus);
  const secondaryWorkflow = workflowSecondaryActions(allowed, primaryWorkflow);
  const canCancel = allowed.has("CANCELLED");

  const hasWorkflowPanel =
    primaryWorkflow != null || secondaryWorkflow.length > 0 || canCancel;
  const hasQueuePanel = canSetPriority || canMarkRush || canClearRush || isRushed;
  const hasPrintPanel = Boolean(onPrintShippingLabel || onPrintPoLabel);
  const hasAnyActions = hasWorkflowPanel || hasQueuePanel || hasPrintPanel;

  const [statusTarget, setStatusTarget] = useState<SupervisorStatusTarget | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [priorityNo, setPriorityNo] = useState(
    currentPriorityNo != null ? currentPriorityNo : 1,
  );
  const [priorityReason, setPriorityReason] = useState("");
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const [rushOpen, setRushOpen] = useState(false);
  const [rushTarget, setRushTarget] = useState<boolean | null>(null);
  const [rushFormReason, setRushFormReason] = useState("");
  const [rushError, setRushError] = useState<string | null>(null);
  useEffect(() => {
    if (priorityOpen) {
      setPriorityNo(currentPriorityNo != null ? currentPriorityNo : 1);
      setPriorityReason("");
      setPriorityError(null);
    }
  }, [priorityOpen, currentPriorityNo]);

  function openStatus(target: SupervisorStatusTarget) {
    setStatusTarget(target);
    setStatusMessage("");
    setStatusError(null);
  }

  function closeStatus() {
    if (busy) return;
    setStatusTarget(null);
    setStatusMessage("");
    setStatusError(null);
  }

  async function submitStatus() {
    if (!statusTarget) return;
    const msg = statusMessage.trim();
    if (!msg) {
      setStatusError("Reason is required.");
      return;
    }
    setStatusError(null);
    const ok = await onTransition(statusTarget, msg);
    if (ok) closeStatus();
  }

  function openRush(target: boolean) {
    setRushTarget(target);
    setRushOpen(true);
    setRushFormReason("");
    setRushError(null);
  }

  function closeRush() {
    if (busy) return;
    setRushOpen(false);
    setRushTarget(null);
    setRushFormReason("");
    setRushError(null);
  }

  async function submitRush() {
    if (rushTarget === null) return;
    const reason = rushFormReason.trim();
    if (!reason) {
      setRushError("Reason is required.");
      return;
    }
    setRushError(null);
    const ok = await onRushSave(rushTarget, reason);
    if (ok) closeRush();
  }

  async function submitPriority() {
    const reason = priorityReason.trim();
    if (!reason) {
      setPriorityError("Reason is required.");
      return;
    }
    if (!Number.isFinite(priorityNo) || priorityNo < 1) {
      setPriorityError("Enter a priority number of at least 1.");
      return;
    }
    setPriorityError(null);
    const ok = await onPrioritySave(Math.floor(priorityNo), reason);
    if (ok) {
      setPriorityOpen(false);
      setPriorityReason("");
    }
  }

  const statusMeta = statusTarget ? STATUS_ACTION[statusTarget] : null;

  const workflowHint =
    statusNorm === "ON_HOLD"
      ? "Note is paused — resume when ready."
      : statusNorm === "CANCELLED"
        ? "Cancelled — resume to re-enter the queue."
        : isOpen
          ? "Active in the operational queue."
          : "Closed — limited workflow actions.";

  return (
    <section
      className={`print:hidden flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-200/90 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 ${
        busy ? "pointer-events-none opacity-60" : ""
      }`}
      aria-label="Supervisor controls"
      aria-busy={busy}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <StatusBadgeWithHover
          status={currentStatus}
          isOpen={isOpen}
          hoverInput={detailStatusHoverInput({
            status_history: statusHistory,
            completed_pack_sessions: completedPackSessions,
          })}
        />
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {isOpen ? "Open" : "Closed"}
        </span>
        {currentPriorityNo != null ? (
          <span className="font-mono text-[11px] font-medium text-slate-600 dark:text-slate-300">
            P{currentPriorityNo}
          </span>
        ) : null}
        {isRushed ? (
          <RushIndicatorTheme>
            <RushIndicator variant="chip" rushReason={storedRushReason} />
          </RushIndicatorTheme>
        ) : null}
        <span className="hidden text-[11px] text-slate-500 sm:inline dark:text-slate-400">
          {workflowHint}
        </span>
      </div>

      {hasAnyActions ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {canMarkRush && !isRushed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => openRush(true)}
              className={`${btnBase} ${btnGhost}`}
            >
              Mark rush
            </button>
          ) : null}
          {isRushed && canClearRush ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => openRush(false)}
              className={`${btnBase} ${btnGhost}`}
            >
              Clear rush
            </button>
          ) : null}
          {canSetPriority ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setPriorityOpen(true)}
              className={`${btnBase} ${btnGhost}`}
            >
              Priority
              {currentPriorityNo != null ? (
                <span className="ml-1 font-mono font-normal text-slate-500 dark:text-slate-400">
                  P{currentPriorityNo}
                </span>
              ) : null}
            </button>
          ) : null}
          {onPrintShippingLabel ? (
            <button
              type="button"
              disabled={busy}
              onClick={onPrintShippingLabel}
              className={`${btnBase} ${btnGhost}`}
            >
              Shipping label
            </button>
          ) : null}
          {onPrintPoLabel ? (
            <button
              type="button"
              disabled={busy}
              onClick={onPrintPoLabel}
              className={`${btnBase} ${btnGhost}`}
            >
              PO label
            </button>
          ) : null}
          {primaryWorkflow ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => openStatus(primaryWorkflow)}
              className={`${btnBase} ${btnPrimary}`}
            >
              {STATUS_ACTION[primaryWorkflow].shortLabel}
            </button>
          ) : null}
          {secondaryWorkflow.map((target) => (
            <button
              key={target}
              type="button"
              disabled={busy}
              onClick={() => openStatus(target)}
              className={`${btnBase} ${btnGhost}`}
            >
              {STATUS_ACTION[target].shortLabel}
            </button>
          ))}
          {canCancel ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => openStatus("CANCELLED")}
              className={`${btnBase} ${btnDanger}`}
            >
              {STATUS_ACTION.CANCELLED.shortLabel}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No actions for this note.
        </p>
      )}

      {statusMeta ? (
        <SupervisorModal
          open
          title={statusMeta.title}
          description={statusMeta.description}
          onClose={closeStatus}
          footer={
            <>
              <button
                type="button"
                disabled={busy}
                onClick={closeStatus}
                className={`${btnBase} w-auto ${btnGhost}`}
              >
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitStatus()}
                className={`${btnBase} w-auto ${
                  statusMeta.variant === "danger" ? btnDanger : btnPrimary
                }`}
              >
                {busy ? "Saving…" : statusMeta.confirm}
              </button>
            </>
          }
        >
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Reason <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <textarea
            value={statusMessage}
            onChange={(e) => setStatusMessage(e.target.value)}
            rows={4}
            className={`mt-1.5 ${inputClass} resize-y`}
            placeholder="Why are you making this change?"
            disabled={busy}
          />
          {statusError ? (
            <p
              className="mt-2 text-xs text-red-700 dark:text-red-300"
              role="alert"
            >
              {statusError}
            </p>
          ) : null}
        </SupervisorModal>
      ) : null}

      {rushOpen && rushTarget !== null ? (
        <SupervisorModal
          open
          title={rushTarget ? "Mark as rush" : "Clear rush"}
          description={
            rushTarget
              ? "Flags this delivery note as rush. Priority number is unchanged; staff see a rush marker on the DN."
              : "Removes the rush flag. Priority number is unchanged."
          }
          onClose={closeRush}
          footer={
            <>
              <button
                type="button"
                disabled={busy}
                onClick={closeRush}
                className={`${btnBase} w-auto ${btnGhost}`}
              >
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitRush()}
                className={`${btnBase} w-auto ${btnPrimary}`}
              >
                {busy ? "Saving…" : rushTarget ? "Mark rush" : "Clear rush"}
              </button>
            </>
          }
        >
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Reason <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <textarea
            value={rushFormReason}
            onChange={(e) => setRushFormReason(e.target.value)}
            rows={4}
            className={`mt-1.5 ${inputClass} resize-y`}
            placeholder={
              rushTarget ? "Why is this order rushed?" : "Why clear rush?"
            }
            disabled={busy}
          />
          {rushError ? (
            <p
              className="mt-2 text-xs text-red-700 dark:text-red-300"
              role="alert"
            >
              {rushError}
            </p>
          ) : null}
        </SupervisorModal>
      ) : null}

      {priorityOpen ? (
        <SupervisorModal
          open
          title="Change priority"
          description={
            currentPriorityNo != null
              ? `Current priority is ${currentPriorityNo}. Lower numbers are more urgent.`
              : "Assign a queue position. Lower numbers are more urgent."
          }
          onClose={() => {
            if (!busy) setPriorityOpen(false);
          }}
          footer={
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPriorityOpen(false)}
                className={`${btnBase} w-auto ${btnGhost}`}
              >
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitPriority()}
                className={`${btnBase} w-auto ${btnPrimary}`}
              >
                {busy ? "Saving…" : "Save priority"}
              </button>
            </>
          }
        >
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Priority # <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <input
            type="number"
            min={1}
            value={priorityNo}
            onChange={(e) => setPriorityNo(Number(e.target.value))}
            className={`mt-1.5 ${inputClass} max-w-[8rem]`}
            disabled={busy}
          />
          <label className="mt-4 block text-xs font-medium text-slate-600 dark:text-slate-300">
            Reason <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <textarea
            value={priorityReason}
            onChange={(e) => setPriorityReason(e.target.value)}
            rows={3}
            className={`mt-1.5 ${inputClass} resize-y`}
            placeholder="Why change priority?"
            disabled={busy}
          />
          {priorityError ? (
            <p
              className="mt-2 text-xs text-red-700 dark:text-red-300"
              role="alert"
            >
              {priorityError}
            </p>
          ) : null}
        </SupervisorModal>
      ) : null}
    </section>
  );
}
