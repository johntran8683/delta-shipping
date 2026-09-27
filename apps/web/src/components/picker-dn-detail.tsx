"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getAccessToken } from "@/lib/auth-storage";
import { apiBase } from "@/lib/config";
import { DeliveryNoteNumber } from "@/components/delivery-note-number";
import { formatDeliveryNoteNumber } from "@/lib/format-dn-number";
import { formatDnStatusLabel } from "@/lib/dn-status";
import {
  formatWorkflowActorLabel,
  type WorkflowHandoff,
} from "@/components/shipper-dn-detail";

type ShipToLocationDetail = {
  ship_to_name: string;
  street1: string | null;
  street2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  country_code: string | null;
  country_name: string | null;
};

type LineRow = {
  id: string;
  doc_item: number;
  material_code: string | null;
  material_description: string | null;
};

export type PickerDnDetail = {
  id: string;
  dn_number: string;
  sold_to_name: string;
  ship_to_code: string;
  ship_to_name: string;
  ship_to_region_state: string | null;
  ship_to_location?: ShipToLocationDetail | null;
  shipping_type: string | null;
  current_priority_no: number | null;
  is_rushed?: boolean;
  lines: LineRow[];
};

type ShipTogetherPeer = {
  id: string;
  dn_number: string;
  current_status: string;
  current_priority_no: number | null;
  sold_to_name: string;
};

export type PickerDnDetailWorkspaceProps = {
  detail: PickerDnDetail;
  currentStatus: string;
  allowedNextStatuses: string[];
  workflowHandoff?: WorkflowHandoff | null;
  busy: boolean;
  transitionError?: string | null;
  fullDnOpen: boolean;
  onToggleFullDn: () => void;
  onStartPicking: () => void | Promise<void>;
  onMarkPicked: () => void | Promise<void>;
};

type PickStepState = "complete" | "current" | "upcoming";

const PICK_STEP_LABELS = ["In queue", "Picking", "Picked"] as const;

function normStatus(s: string): string {
  return String(s ?? "")
    .trim()
    .toUpperCase();
}

function pickProgressFromStatus(status: string): {
  steps: [PickStepState, PickStepState, PickStepState];
  trackFillPercent: number;
  caption: string | null;
} {
  const s = normStatus(status);
  if (s === "PICKING") {
    return {
      steps: ["complete", "current", "upcoming"],
      trackFillPercent: 50,
      caption: "Confirm all lines, then mark picked.",
    };
  }
  if (s === "PICKED") {
    return {
      steps: ["complete", "complete", "current"],
      trackFillPercent: 100,
      caption: "Ready for packing — the packer takes over from here.",
    };
  }
  if (s === "NEW") {
    return {
      steps: ["current", "upcoming", "upcoming"],
      trackFillPercent: 16.66,
      caption: "Start picking when you are at this cart.",
    };
  }
  return {
    steps: ["upcoming", "upcoming", "upcoming"],
    trackFillPercent: 0,
    caption: `Pick steps apply before packing (current: ${formatDnStatusLabel(status)}).`,
  };
}

function isDownstreamFromPick(status: string): boolean {
  const s = normStatus(status);
  return (
    s === "PACKING" ||
    s === "PACKED" ||
    s === "SHIPPING_IN_PROGRESS" ||
    s === "SHIPPED"
  );
}

function addrLine(value: string | null | undefined): string {
  const t = value?.trim();
  return t ? t : "—";
}

function countryDisplay(loc: ShipToLocationDetail): string {
  const name = loc.country_name?.trim();
  const code = loc.country_code?.trim();
  if (name && code) return `${name} (${code})`;
  return name || code || "—";
}

function buildShipToSummary(
  detail: PickerDnDetail,
): { primary: string; lines: string[] } {
  const loc = detail.ship_to_location;
  if (loc) {
    const cityLine = [loc.city, loc.state_region ?? detail.ship_to_region_state, loc.postal_code]
      .map((x) => x?.trim())
      .filter(Boolean)
      .join(", ");
    const lines = [
      addrLine(loc.street1),
      addrLine(loc.street2),
      cityLine || "—",
      countryDisplay(loc),
    ].filter((l) => l !== "—");
    return {
      primary: loc.ship_to_name?.trim() || detail.ship_to_name,
      lines,
    };
  }
  return {
    primary: detail.ship_to_name,
    lines: detail.ship_to_region_state
      ? [`Region: ${detail.ship_to_region_state}`]
      : ["No structured address on file."],
  };
}

const stepNavBtnPrimary =
  "inline-flex min-h-[2.75rem] flex-1 items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white sm:flex-none sm:min-w-[8rem]";
const stepNavBtnPicked =
  "inline-flex min-h-[2.75rem] flex-1 items-center justify-center rounded-lg border border-emerald-700/90 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:pointer-events-none disabled:opacity-40 dark:border-emerald-600 dark:bg-emerald-700 dark:hover:bg-emerald-600 sm:flex-none sm:min-w-[8rem]";

function PickerPickProgressBar({
  status,
  showActions,
  busy,
  canStartPicking,
  canMarkPicked,
  onStartPicking,
  onMarkPicked,
}: {
  status: string;
  showActions: boolean;
  busy: boolean;
  canStartPicking: boolean;
  canMarkPicked: boolean;
  onStartPicking: () => void;
  onMarkPicked: () => void;
}) {
  const { steps, trackFillPercent, caption } = pickProgressFromStatus(status);
  const progressRounded = Math.round(trackFillPercent);
  const s = normStatus(status);

  return (
    <section
      className="print:hidden border-b border-slate-200/70 pb-5 dark:border-slate-800/60"
      aria-label="Pick progress"
    >
      <p className="mb-2.5 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-slate-500">
        Pick progress
      </p>

      <div
        className="relative"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressRounded}
        aria-label={`Pick progress, ${progressRounded} percent`}
      >
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/80">
          <div
            className="h-full min-w-0 rounded-full bg-emerald-700 transition-[width] duration-500 ease-out dark:bg-emerald-500"
            style={{ width: `${trackFillPercent}%` }}
          />
        </div>
      </div>

      <ol className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[0, 1, 2].map((i) => (
          <li key={PICK_STEP_LABELS[i]}>
            <span
              className={
                steps[i] === "complete"
                  ? "inline-flex items-center justify-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-400"
                  : steps[i] === "current"
                    ? "text-[11px] font-semibold text-slate-900 dark:text-slate-100"
                    : "text-[11px] font-normal text-slate-400 dark:text-slate-500"
              }
              aria-current={steps[i] === "current" ? "step" : undefined}
            >
              {steps[i] === "complete" ? (
                <span
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-100 text-[9px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  aria-hidden
                >
                  ✓
                </span>
              ) : null}
              {PICK_STEP_LABELS[i]}
            </span>
          </li>
        ))}
      </ol>

      {caption ? (
        <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {caption}
        </p>
      ) : null}

      {showActions ? (
        <div
          className="mt-5 hidden max-w-2xl flex-col items-stretch gap-3 sm:mx-auto sm:flex sm:flex-row sm:items-center sm:justify-center sm:gap-4"
          role="group"
          aria-label="Pick actions"
        >
          <span className="inline-flex items-center justify-center rounded-full border border-slate-200/90 bg-slate-50 px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wide text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 sm:mr-2">
            {formatDnStatusLabel(status)}
          </span>
          {canStartPicking ? (
            <button
              type="button"
              disabled={busy}
              onClick={onStartPicking}
              className={stepNavBtnPrimary}
            >
              {busy ? "Working…" : "Start picking"}
            </button>
          ) : null}
          {canMarkPicked ? (
            <button
              type="button"
              disabled={busy}
              onClick={onMarkPicked}
              className={stepNavBtnPicked}
            >
              {busy ? "Working…" : "Mark picked"}
            </button>
          ) : null}
        </div>
      ) : null}

      {showActions && s === "PICKING" && !canMarkPicked ? (
        <p className="mt-3 text-xs text-amber-900/90 dark:text-amber-100/90">
          Only the picker who started this note can mark it picked.
        </p>
      ) : null}
    </section>
  );
}

function SectionCard({
  id,
  title,
  summary,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950/50"
      aria-labelledby={id}
    >
      <header className="border-b border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id={id}
            className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100"
          >
            {title}
          </h2>
          {summary ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">{summary}</p>
          ) : null}
        </div>
      </header>
      <div className="px-4 py-4 sm:px-5 sm:py-5">{children}</div>
    </section>
  );
}

function ShipTogetherList({
  currentDnId,
  peers,
  loading,
  error,
}: {
  currentDnId: string;
  peers: ShipTogetherPeer[];
  loading: boolean;
  error: string | null;
}) {
  const others = peers.filter((p) => p.id !== currentDnId);
  if (loading) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400" role="status">
        Loading related delivery notes…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-red-700 dark:text-red-300" role="alert">
        {error}
      </p>
    );
  }
  if (others.length === 0) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        No other open notes share this ship-to grouping.
      </p>
    );
  }
  return (
    <ul className="list-none space-y-1.5 p-0" role="list">
      {others.map((p) => (
        <li key={p.id}>
          <Link
            href={`/delivery-notes/${p.id}`}
            className="group flex items-center justify-between gap-3 rounded-lg border border-slate-200/90 bg-slate-50/80 px-3 py-2.5 text-xs transition hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-900/40 dark:hover:border-slate-600"
          >
            <span className="min-w-0 font-mono text-sm font-semibold tabular-nums text-slate-800 group-hover:text-slate-950 dark:text-slate-100 dark:group-hover:text-white">
              {formatDeliveryNoteNumber(p.dn_number)}
            </span>
            <span className="shrink-0 text-right text-[11px] text-slate-500 dark:text-slate-400">
              <span className="block font-medium text-slate-600 dark:text-slate-300">
                {formatDnStatusLabel(p.current_status)}
              </span>
              {p.current_priority_no != null ? (
                <span className="font-mono tabular-nums">P{p.current_priority_no}</span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ShipDestinationCard({
  detail,
  shipTo,
  currentDnId,
  peers,
  peersLoading,
  peersError,
}: {
  detail: PickerDnDetail;
  shipTo: { primary: string; lines: string[] };
  currentDnId: string;
  peers: ShipTogetherPeer[];
  peersLoading: boolean;
  peersError: string | null;
}) {
  const relatedCount = peers.filter((p) => p.id !== currentDnId).length;
  const summaryParts: string[] = [];
  if (detail.ship_to_code?.trim()) {
    summaryParts.push(detail.ship_to_code.trim());
  }
  if (peersLoading) {
    summaryParts.push("…");
  } else if (relatedCount > 0) {
    summaryParts.push(
      `${relatedCount} related note${relatedCount === 1 ? "" : "s"}`,
    );
  }

  return (
    <SectionCard
      id="picker-destination"
      title="Ship to"
      summary={summaryParts.length > 0 ? summaryParts.join(" · ") : undefined}
    >
      <div className="space-y-4">
        <div>
          <p className="text-base font-semibold leading-snug text-slate-900 dark:text-slate-50">
            {shipTo.primary}
          </p>
          {shipTo.lines.length > 0 ? (
            <address className="mt-2 list-none space-y-0.5 not-italic text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {shipTo.lines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </address>
          ) : null}
        </div>

        <dl className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 text-xs sm:grid-cols-2 dark:border-slate-800/90">
          <div>
            <dt className="font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Customer
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">
              {detail.sold_to_name}
            </dd>
          </div>
          <div>
            <dt className="font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Ship method
            </dt>
            <dd className="mt-1 text-sm text-slate-800 dark:text-slate-100">
              {detail.shipping_type?.trim() || "—"}
            </dd>
          </div>
        </dl>

        <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 px-3 py-3 dark:border-slate-700/80 dark:bg-slate-900/30 sm:px-4 sm:py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              Ship together
            </h3>
            {!peersLoading && relatedCount > 0 ? (
              <span className="inline-flex items-center rounded-full border border-slate-200/90 bg-white px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600 shadow-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-300">
                {relatedCount} other{relatedCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Other open notes with the same destination grouping. Pick each note
            separately — this is a hint only.
          </p>
          <div className="mt-3">
            <ShipTogetherList
              currentDnId={currentDnId}
              peers={peers}
              loading={peersLoading}
              error={peersError}
            />
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function DownstreamHandoffCard({ status }: { status: string }) {
  return (
    <section className="rounded-xl border border-slate-200/90 bg-slate-50/60 px-4 py-4 dark:border-slate-700 dark:bg-slate-900/30 sm:px-5">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        With packing / shipping
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        This delivery note is{" "}
        <span className="font-mono text-xs font-medium text-slate-800 dark:text-slate-200">
          {formatDnStatusLabel(status)}
        </span>
        . Your pick work is complete; packers and shippers handle the next steps.
        Switch to another role from the account menu if you need to act on those
        stages.
      </p>
      <Link
        href="/delivery-notes"
        className="mt-4 inline-flex text-sm font-medium text-slate-700 underline-offset-2 hover:underline dark:text-slate-200"
      >
        ← Back to delivery notes
      </Link>
    </section>
  );
}

function PickedSuccessCard({
  workflowHandoff,
}: {
  workflowHandoff?: WorkflowHandoff | null;
}) {
  const picker = workflowHandoff?.picked_by;
  return (
    <section className="rounded-xl border border-emerald-200/90 bg-emerald-50/50 px-4 py-4 dark:border-emerald-900/50 dark:bg-emerald-950/25 sm:px-5">
      <h2 className="text-sm font-semibold text-emerald-950 dark:text-emerald-50">
        Marked picked
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-emerald-900/90 dark:text-emerald-100/90">
        This note is ready for packing. Return to the list to pick your next order.
      </p>
      {picker ? (
        <p className="mt-2 text-xs text-emerald-800/80 dark:text-emerald-200/80">
          Picked by: {formatWorkflowActorLabel(picker)}
        </p>
      ) : null}
      <Link
        href="/delivery-notes"
        className="mt-4 inline-flex min-h-[2.75rem] items-center justify-center rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        Back to delivery notes
      </Link>
    </section>
  );
}

export function PickerDnDetailWorkspace({
  detail,
  currentStatus,
  allowedNextStatuses,
  workflowHandoff,
  busy,
  transitionError,
  fullDnOpen,
  onToggleFullDn,
  onStartPicking,
  onMarkPicked,
}: PickerDnDetailWorkspaceProps) {
  const s = normStatus(currentStatus);
  const allowed = new Set(allowedNextStatuses.map(normStatus));
  const canStartPicking = allowed.has("PICKING");
  const canMarkPicked = allowed.has("PICKED");
  const showPickActions =
    !isDownstreamFromPick(currentStatus) &&
    (canStartPicking || canMarkPicked);

  const [shipPeers, setShipPeers] = useState<ShipTogetherPeer[]>([]);
  const [shipPeersLoading, setShipPeersLoading] = useState(false);
  const [shipPeersError, setShipPeersError] = useState<string | null>(null);

  const loadShipPeers = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    setShipPeersLoading(true);
    setShipPeersError(null);
    try {
      const res = await fetch(
        `${apiBase}/delivery-notes/${encodeURIComponent(detail.id)}/ship-together-peers`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = (await res.json().catch(() => ({}))) as {
        items?: ShipTogetherPeer[];
        message?: string;
      };
      if (!res.ok) {
        setShipPeersError(
          typeof data.message === "string"
            ? data.message
            : "Could not load combinable notes.",
        );
        setShipPeers([]);
        return;
      }
      setShipPeers(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setShipPeersError(e instanceof Error ? e.message : "Request failed");
      setShipPeers([]);
    } finally {
      setShipPeersLoading(false);
    }
  }, [detail.id]);

  useEffect(() => {
    void loadShipPeers();
  }, [loadShipPeers]);

  const shipTo = buildShipToSummary(detail);
  const lineSummary =
    detail.lines.length === 0
      ? undefined
      : `${detail.lines.length} line${detail.lines.length === 1 ? "" : "s"}`;

  const stickyPrimary = canMarkPicked
    ? { label: "Mark picked", onClick: onMarkPicked, variant: "picked" as const }
    : canStartPicking
      ? { label: "Start picking", onClick: onStartPicking, variant: "primary" as const }
      : null;

  return (
    <div className="print:hidden space-y-5 pb-24 sm:pb-6">
      <PickerPickProgressBar
        status={currentStatus}
        showActions={showPickActions}
        busy={busy}
        canStartPicking={canStartPicking}
        canMarkPicked={canMarkPicked}
        onStartPicking={() => void onStartPicking()}
        onMarkPicked={() => void onMarkPicked()}
      />

      {transitionError ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          {transitionError}
        </p>
      ) : null}

      {isDownstreamFromPick(currentStatus) ? (
        <DownstreamHandoffCard status={currentStatus} />
      ) : s === "PICKED" ? (
        <PickedSuccessCard workflowHandoff={workflowHandoff} />
      ) : null}

      {s === "PICKING" && workflowHandoff?.picked_by ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Picking started by{" "}
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {formatWorkflowActorLabel(workflowHandoff.picked_by)}
          </span>
        </p>
      ) : null}

      <ShipDestinationCard
        detail={detail}
        shipTo={shipTo}
        currentDnId={detail.id}
        peers={shipPeers}
        peersLoading={shipPeersLoading}
        peersError={shipPeersError}
      />

      <SectionCard id="picker-lines" title="Lines to pick" summary={lineSummary}>
        {detail.lines.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No lines on this delivery note — contact a supervisor.
          </p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[20rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="px-2 py-2">Item</th>
                  <th className="px-2 py-2">Material</th>
                  <th className="hidden px-2 py-2 sm:table-cell">Description</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l) => (
                  <tr
                    key={l.id}
                    className="border-b border-slate-100 align-top dark:border-slate-800/80"
                  >
                    <td className="px-2 py-3 font-mono text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                      {l.doc_item}
                    </td>
                    <td className="max-w-[8rem] px-2 py-3 sm:max-w-none">
                      <span className="font-mono text-xs text-slate-700 dark:text-slate-300">
                        {l.material_code ?? "—"}
                      </span>
                      {l.material_description ? (
                        <span className="mt-1 block text-xs leading-snug text-slate-600 sm:hidden dark:text-slate-400">
                          {l.material_description}
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden max-w-md px-2 py-3 text-slate-800 sm:table-cell dark:text-slate-200">
                      {l.material_description ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div>
        <button
          type="button"
          onClick={onToggleFullDn}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950/50 dark:hover:border-slate-600"
          aria-expanded={fullDnOpen}
        >
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
            Full delivery note
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {fullDnOpen ? "Hide" : "Show"} printable document
          </span>
        </button>
      </div>

      {stickyPrimary ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/90 bg-white/95 px-4 py-3 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95 sm:hidden">
          <button
            type="button"
            disabled={busy}
            onClick={() => void stickyPrimary.onClick()}
            className={
              stickyPrimary.variant === "picked" ? stepNavBtnPicked + " w-full" : stepNavBtnPrimary + " w-full"
            }
          >
            {busy ? "Working…" : stickyPrimary.label}
          </button>
        </div>
      ) : null}
    </div>
  );
}
