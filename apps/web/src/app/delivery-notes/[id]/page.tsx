"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { OperationsShell } from "@/components/operations-shell";
import { StatusBadgeWithHover } from "@/components/status-badge-with-hover";
import { detailStatusHoverInput } from "@/lib/dn-status-hover";
import type { StatusHistoryEntry } from "@/lib/dn-status-hover";
import { ResponseModal } from "@/components/response-modal";
import { clearSession, getAccessToken, getActiveRoleCode } from "@/lib/auth-storage";
import { apiBase } from "@/lib/config";
import { DeliveryNoteNumber } from "@/components/delivery-note-number";
import { formatDeliveryNoteNumber } from "@/lib/format-dn-number";
import { formatDateOnly } from "@/lib/format-date";
import { type WorkflowHandoff } from "@/components/shipper-dn-detail";
import {
  RateQuoteEstimator,
  type RateQuoteSelection,
} from "@/components/rate-quote-estimator";
import {
  DnWorkflowRail,
  type PrimaryActionKey,
} from "@/components/dn-workflow-rail";

type LineRow = {
  id: string;
  doc_item: number;
  so_number: string | null;
  material_code: string | null;
  material_description: string | null;
  order_qty: string | null;
  shipped_qty: string | null;
  open_qty: string | null;
  unit_price: string | null;
  line_amount: string | null;
};

type PackPeerRow = {
  id: string;
  dn_number: string;
  /** False when the note is in the cluster but not PICKED (cannot join pack/start). */
  eligible_for_pack_session?: boolean;
  current_status?: string;
};

function packPeerSelectable(p: PackPeerRow): boolean {
  return p.eligible_for_pack_session !== false;
}

type ActivePackSession = {
  id: string;
  created_at: string;
  delivery_notes: {
    id: string;
    dn_number: string;
    current_status: string;
  }[];
};

type CompletedPackSession = {
  id: string;
  completed_at: string | null;
  pack_completion_note?: string | null;
  delivery_notes: { id: string; dn_number: string; current_status?: string }[];
  boxes: {
    id: string;
    sort_order: number;
    box_number: string | null;
    weight_lb: string;
    length_in: string;
    width_in: string;
    height_in: string;
  }[];
};

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

type Detail = {
  id: string;
  dn_number: string;
  sold_to_code: string;
  ship_to_code: string;
  sold_to_name: string;
  ship_to_name: string;
  current_priority_no: number | null;
  is_rushed: boolean;
  latest_rush_reason?: string | null;
  current_status: string;
  on_hold_from_status?: string | null;
  is_open: boolean;
  shipping_type: string | null;
  charging_method: string | null;
  currency_code: string | null;
  po_date: string | null;
  customer_po: string | null;
  ship_to_region_state: string | null;
  created_at: string;
  ship_to_location?: ShipToLocationDetail | null;
  lines: LineRow[];
  status_history: unknown[];
  priority_history: unknown[];
  allowedNextStatuses: string[];
  canSetPriority: boolean;
  canMarkRush: boolean;
  canClearRush: boolean;
  packing_combine_peers?: { items: PackPeerRow[] };
  active_pack_session?: ActivePackSession | null;
  completed_pack_sessions?: CompletedPackSession[];
  shipping_group_notes?: { id: string; dn_number: string }[];
  customer_email?: string | null;
  fed_id_number?: string | null;
  matched_carrier_accounts?: { carrier_code: string; account_number: string }[];
  latest_shipment?: {
    tracking_number: string | null;
    invoice_number?: string | null;
    ship_date: string;
    carrier_code: string;
    quoted_fee?: string | null;
    quoted_fee_currency?: string | null;
    quoted_service_code?: string | null;
    quoted_service_name?: string | null;
  } | null;
  workflow_handoff?: WorkflowHandoff | null;
};

const infoCardCls =
  "rounded-xl border border-[color:var(--app-border)] bg-[var(--app-surface)] px-4 py-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] sm:px-5 dark:shadow-none";
const infoCardTitleCls =
  "text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400";

function formatMoney(value: string | null, currency: string | null): string {
  if (value == null || value.trim() === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${formatted}` : formatted;
}

function DnCustomerCard({ detail }: { detail: Detail }) {
  const rows: Array<[string, string | null]> = [
    ["Customer", detail.sold_to_name || "—"],
    ["Customer code", detail.sold_to_code || "—"],
    ["PO #", detail.customer_po?.trim() || "—"],
    ["PO date", formatDateOnly(detail.po_date)],
    ["SO #", detail.lines[0]?.so_number?.trim() || "—"],
  ];
  return (
    <section className={infoCardCls} aria-label="Customer">
      <h2 className={infoCardTitleCls}>Customer</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {label}
            </dt>
            <dd className="mt-0.5 truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={value ?? undefined}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function DnShipToCard({ detail }: { detail: Detail }) {
  const loc = detail.ship_to_location;
  const addrParts = loc
    ? [
        loc.street1,
        loc.street2,
        [loc.city, loc.state_region].filter(Boolean).join(", "),
        loc.postal_code,
        loc.country_name || loc.country_code,
      ].filter((p) => p && p.trim())
    : [];
  const shipRows: Array<[string, string]> = [
    ["Shipping type", detail.shipping_type?.trim() || "—"],
    ["Charging method", detail.charging_method?.trim() || "—"],
  ];
  return (
    <section className={infoCardCls} aria-label="Ship to">
      <h2 className={infoCardTitleCls}>Ship to</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {detail.ship_to_name || "—"}
            {detail.ship_to_code ? (
              <span className="ml-2 font-mono text-xs font-normal text-slate-500 dark:text-slate-400">
                {detail.ship_to_code}
              </span>
            ) : null}
          </p>
          {addrParts.length > 0 ? (
            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {addrParts.map((p, i) => (
                <span key={i}>
                  {i > 0 ? <br /> : null}
                  {p}
                </span>
              ))}
            </p>
          ) : null}
        </div>
        <dl className="grid min-w-0 content-start grid-cols-1 gap-x-6 gap-y-2.5 border-t border-[color:var(--app-border)] pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          {shipRows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {label}
              </dt>
              <dd
                className="mt-0.5 truncate text-sm font-medium text-slate-900 dark:text-slate-100"
                title={value}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function DnLinesCard({ detail }: { detail: Detail }) {
  const total = detail.lines.reduce((sum, l) => {
    const n = l.line_amount != null ? Number(l.line_amount) : NaN;
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
  const hasAnyAmount = detail.lines.some(
    (l) => l.line_amount != null && l.line_amount.trim() !== "",
  );
  return (
    <section className={infoCardCls} aria-label="Lines">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={infoCardTitleCls}>Lines</h2>
        <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {detail.lines.length} line{detail.lines.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[color:var(--app-border)] text-left">
              <th className="w-14 px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Item
              </th>
              <th className="px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Material
              </th>
              <th className="w-28 px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Unit price
              </th>
              <th className="w-20 px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Qty
              </th>
              <th className="w-32 px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {detail.lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-8 text-center text-slate-500">
                  No lines.
                </td>
              </tr>
            ) : (
              detail.lines.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800"
                >
                  <td className="px-2 py-2 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {l.doc_item}
                  </td>
                  <td className="px-2 py-2">
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                      {l.material_code ?? "—"}
                    </span>
                    {l.material_description ? (
                      <span className="mt-0.5 block text-slate-800 dark:text-slate-100">
                        {l.material_description}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                    {formatMoney(l.unit_price, null)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">
                    {l.shipped_qty ?? "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium text-slate-800 dark:text-slate-100">
                    {formatMoney(l.line_amount, null)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {hasAnyAmount ? (
            <tfoot>
              <tr className="border-t-2 border-[color:var(--app-border)]">
                <td colSpan={4} className="px-2 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Total
                </td>
                <td className="px-2 py-2.5 text-right text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatMoney(String(total), detail.currency_code)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}

function CombinedPackSessionBanner({
  session,
  currentDnId,
}: {
  session: ActivePackSession;
  currentDnId: string;
}) {
  const notes = session.delivery_notes;
  if (notes.length === 0) return null;

  const started = new Date(session.created_at);
  const startedLabel = Number.isNaN(started.getTime())
    ? null
    : started.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

  return (
    <section
      className="print:hidden mb-6 rounded-lg border border-slate-200/90 bg-slate-50/40 px-4 py-3.5 dark:border-slate-700/70 dark:bg-slate-900/20 sm:px-5"
      aria-label={
        notes.length > 1
          ? "Delivery notes in this combined pack session"
          : "This delivery note pack session"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            {notes.length > 1 ? "Combined pack session" : "Pack session"}
          </h2>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            {notes.length > 1 ? (
              <>
                These notes share one open session and become{" "}
                <span className="font-mono text-[10px] text-slate-600 dark:text-slate-300">
                  PACKED
                </span>{" "}
                together when packing is completed from any member.
              </>
            ) : (
              <>
                This note is in an open pack session. Use{" "}
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  Next
                </span>{" "}
                when you are ready to record boxes and mark packed.
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          <span className="inline-flex items-center rounded-md border border-slate-200/90 bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200">
            {notes.length} in session
          </span>
          {startedLabel ? (
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              Started {startedLabel}
            </span>
          ) : null}
        </div>
      </div>
      <ul className="mt-3 flex list-none flex-wrap gap-2 p-0" role="list">
        {notes.map((n) => {
          const here = n.id === currentDnId;
          const label = formatDeliveryNoteNumber(n.dn_number);
          const st = (n.current_status ?? "").trim();
          return (
            <li key={n.id}>
              {here ? (
                <span
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white dark:border-slate-300 dark:bg-slate-100 dark:text-slate-900"
                  aria-current="true"
                >
                  <span className="truncate font-mono tabular-nums">{label}</span>
                  <span className="shrink-0 text-[0.6rem] font-normal uppercase tracking-wide opacity-90">
                    Here
                  </span>
                </span>
              ) : (
                <Link
                  href={`/delivery-notes/${n.id}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm ring-1 ring-transparent transition hover:border-slate-300 hover:ring-slate-900/5 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:ring-white/5"
                >
                  <span className="truncate font-mono tabular-nums">{label}</span>
                  {st ? (
                    <span className="shrink-0 rounded bg-slate-100 px-1 py-0 font-mono text-[0.6rem] uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {st}
                    </span>
                  ) : null}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Pounds-to-kilograms factor for the dual-unit package weight display. */
const LB_TO_KG = 0.45359237;

function formatBoxDecimal(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/, "");
}

function sumBoxWeight(
  boxes: { weight_lb: string }[],
): { lb: string; kg: string } | null {
  if (boxes.length === 0) return null;
  let sum = 0;
  let anyValid = false;
  for (const b of boxes) {
    const n = Number.parseFloat((b.weight_lb ?? "").trim());
    if (!Number.isFinite(n)) continue;
    sum += n;
    anyValid = true;
  }
  if (!anyValid) return null;
  return { lb: formatBoxDecimal(sum), kg: formatBoxDecimal(sum * LB_TO_KG) };
}

/** "24×18×12" for display, or null when any dimension is missing. */
function formatBoxSizeDisplay(box: {
  length_in: string;
  width_in: string;
  height_in: string;
}): string | null {
  const l = (box.length_in ?? "").trim();
  const w = (box.width_in ?? "").trim();
  const h = (box.height_in ?? "").trim();
  if (!l || !w || !h) return null;
  return `${l}×${w}×${h}`;
}

/**
 * Copy text for the box sizes only (plain "x" separators for pasting):
 * "Box sizes (in): 24x18x12, 20x16x10". Empty when no box has dimensions.
 */
function buildBoxSizesCopyText(
  boxes: { length_in: string; width_in: string; height_in: string }[],
): string {
  const sizes: string[] = [];
  for (const b of boxes) {
    const l = (b.length_in ?? "").trim();
    const w = (b.width_in ?? "").trim();
    const h = (b.height_in ?? "").trim();
    if (!l || !w || !h) continue;
    sizes.push(`${l}x${w}x${h}`);
  }
  if (sizes.length === 0) return "";
  return `Box sizes (in): ${sizes.join(", ")}`;
}

function CopyTextButton({
  value,
  label,
  children,
}: {
  value: string;
  label: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const trimmed = value.trim();

  const copy = useCallback(async () => {
    if (!trimmed) return;
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }, [trimmed]);

  if (!trimmed) return null;

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
    >
      {copied ? (
        <span className="text-emerald-700 dark:text-emerald-400">Copied</span>
      ) : (
        (children ?? `Copy ${label}`)
      )}
    </button>
  );
}

function RecordedBoxesCard({
  boxes,
  rateEstimator,
}: {
  boxes: CompletedPackSession["boxes"];
  rateEstimator?: ReactNode;
}) {
  const weight = sumBoxWeight(boxes);
  // Group identical box sizes with a count: "15×15×12 (2)" instead of
  // "15×15×12, 15×15×12". Display-only; the copy button keeps the expanded list.
  const sizeCounts = new Map<string, number>();
  for (const b of boxes) {
    const s = formatBoxSizeDisplay(b);
    if (s) sizeCounts.set(s, (sizeCounts.get(s) ?? 0) + 1);
  }
  const sizeGroups: Array<{ display: string; count: number }> = [];
  for (const [display, count] of sizeCounts) {
    sizeGroups.push({ display, count });
  }
  const boxSizesCopyText = buildBoxSizesCopyText(boxes);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-700/70 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800/80">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
            Recorded boxes
          </h3>
          <p className="mt-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {boxes.length} box{boxes.length === 1 ? "" : "es"}
            </span>
            {weight ? (
              <>
                {" · "}
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {weight.lb} lb ({weight.kg} kg)
                </span>{" "}
                total
              </>
            ) : null}
          </p>
        </div>
        {rateEstimator ? (
          <div className="flex shrink-0 items-center">{rateEstimator}</div>
        ) : null}
      </div>
      {sizeGroups.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800/80">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Sizes (in)
          </span>
          <ul className="flex list-none flex-wrap items-center gap-1.5 p-0" role="list">
            {sizeGroups.map(({ display, count }) => (
              <li
                key={display}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs tabular-nums text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <span className="font-semibold">{display}</span>
                {count > 1 ? (
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    ({count})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <CopyTextButton value={boxSizesCopyText} label="box sizes" />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              <th className="px-4 py-2">Box</th>
              <th className="px-3 py-2">Weight</th>
              <th className="px-4 py-2">L × W × H (in)</th>
            </tr>
          </thead>
          <tbody>
            {boxes.map((b) => {
              const bn = b.box_number?.trim();
              const label = bn ? bn : `Box ${b.sort_order + 1}`;
              return (
                <tr
                  key={b.id}
                  className="border-b border-slate-50 transition last:border-b-0 hover:bg-slate-50/80 dark:border-slate-800/60 dark:hover:bg-slate-900/60"
                >
                  <td className="px-4 py-2 font-mono text-sm font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                    {label}
                  </td>
                  <td className="px-3 py-2 font-mono text-sm tabular-nums text-slate-700 dark:text-slate-200">
                    <span className="font-semibold">{b.weight_lb}</span>
                    <span className="ml-1 text-xs font-medium text-slate-400 dark:text-slate-500">
                      lb
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-sm font-medium tabular-nums text-slate-700 dark:text-slate-200">
                    {b.length_in} × {b.width_in} × {b.height_in}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompletedPackResultBanner({
  session,
  currentDnId,
  totalSessionCount,
  editable,
  onEdit,
  readOnly,
  rateEstimator,
}: {
  session: CompletedPackSession;
  currentDnId: string;
  totalSessionCount: number;
  editable?: boolean;
  onEdit?: () => void;
  /** Shown while shipping is in progress: boxes stay visible but not editable. */
  readOnly?: boolean;
  /** Rate-estimate controls rendered beside the package summary. */
  rateEstimator?: ReactNode;
}) {
  const notes = session.delivery_notes;
  const boxes = session.boxes ?? [];
  const note = session.pack_completion_note?.trim();

  const done = session.completed_at ? new Date(session.completed_at) : null;
  const doneLabel =
    done && !Number.isNaN(done.getTime())
      ? done.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  if (notes.length === 0 && boxes.length === 0 && !note) return null;

  const showSessionNotes = notes.length > 1;
  const metaParts: string[] = [];
  if (boxes.length > 0) {
    metaParts.push(`${boxes.length} box${boxes.length === 1 ? "" : "es"}`);
  }
  if (doneLabel) metaParts.push(doneLabel);

  return (
    <section
      className="print:hidden mb-6 rounded-lg border border-slate-200/90 bg-slate-50/40 px-4 py-3.5 dark:border-slate-700/70 dark:bg-slate-900/20 sm:px-5"
      aria-label="Completed pack session, combined delivery notes, and boxes"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="size-1.5 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-400"
            aria-hidden
          />
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            {notes.length > 1 ? "Combined pack result" : "Pack result"}
          </h2>
          {totalSessionCount > 1 ? (
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              · Latest of {totalSessionCount}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {editable && onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex size-7 items-center justify-center rounded-md border border-slate-200/90 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
              aria-label="Edit pack result"
              title="Edit pack result"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="size-3.5"
                aria-hidden
              >
                <path d="m2.695 14.363 2.242 2.242-3.88.97.97-3.88 2.242 2.242Zm.707-.707 9.9-9.9 2.121 2.122-9.9 9.9-2.121-2.122Zm11.314-11.314 1.414 1.414-1.414 1.414-1.414-1.414 1.414-1.414Z" />
              </svg>
            </button>
          ) : null}
          {metaParts.length > 0 ? (
            <p className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              {metaParts.map((part, i) => (
                <span key={part}>
                  {i > 0 ? (
                    <span className="mx-1.5 text-slate-300 dark:text-slate-600" aria-hidden>
                      ·
                    </span>
                  ) : null}
                  <span
                    className={
                      i === 0 && boxes.length > 0
                        ? "font-medium text-slate-700 dark:text-slate-200"
                        : ""
                    }
                  >
                    {part}
                  </span>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </div>

      {note ? (
        <p className="mt-2.5 border-l-2 border-slate-200/90 pl-2.5 text-xs leading-relaxed text-slate-600 dark:border-slate-600 dark:text-slate-300">
          <span className="font-medium text-slate-500 dark:text-slate-400">Note · </span>
          {note}
        </p>
      ) : null}

      {showSessionNotes ? (
        <ul className="mt-2.5 flex list-none flex-wrap gap-1.5 p-0" role="list">
          {notes.map((n) => {
            const here = n.id === currentDnId;
            const label = formatDeliveryNoteNumber(n.dn_number);
            return (
              <li key={n.id}>
                {here ? (
                  <span
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white dark:border-slate-300 dark:bg-slate-100 dark:text-slate-900"
                    aria-current="true"
                  >
                    <span className="truncate font-mono tabular-nums">{label}</span>
                    <span className="shrink-0 text-[0.6rem] font-normal uppercase tracking-wide opacity-90">
                      Here
                    </span>
                  </span>
                ) : (
                  <Link
                    href={`/delivery-notes/${n.id}`}
                    className="inline-flex max-w-full items-center rounded-md border border-slate-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm ring-1 ring-transparent transition hover:border-slate-300 hover:ring-slate-900/5 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:ring-white/5"
                  >
                    <span className="truncate font-mono tabular-nums">{label}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {boxes.length > 0 ? (
        <div className="mt-5">
          <RecordedBoxesCard boxes={boxes} rateEstimator={rateEstimator} />
        </div>
      ) : null}
    </section>
  );
}

type PackRevertSeverity = "standard" | "caution" | "destructive";

type PackRevertDialogModel = {
  toStatus: string;
  title: string;
  lead: string;
  bullets: readonly string[];
  /** Delivery notes in the session (may be empty if detail payload lacks session). */
  affectedNotes: readonly { id: string; dn_number: string }[];
  severity: PackRevertSeverity;
  confirmLabel: string;
};

function packSessionRevertNeedsConfirm(
  fromStatus: string,
  toStatus: string,
): boolean {
  return getPackRevertDialogModelFromStatuses(fromStatus, toStatus) != null;
}

function getPackRevertDialogModelFromStatuses(
  fromStatus: string,
  toStatus: string,
): Omit<PackRevertDialogModel, "affectedNotes" | "lead"> | null {
  const from = fromStatus.trim().toUpperCase();
  const to = toStatus.trim().toUpperCase();
  if (from === "PACKING" && to === "PICKED") {
    return {
      toStatus,
      title: "Return this pack session to picked?",
      bullets: [
        "All delivery notes in this session return to PICKED.",
        "The open pack session is removed.",
        "You can start packing again anytime.",
      ],
      severity: "standard",
      confirmLabel: "Return to picked",
    };
  }
  if (from === "PACKED" && to === "PACKING") {
    return {
      toStatus,
      title: "Reopen packing for this pack?",
      bullets: [
        "Saved box dimensions for this completed pack are removed.",
        "The pack session becomes incomplete again.",
        "Every note in this pack returns to PACKING together.",
      ],
      severity: "caution",
      confirmLabel: "Reopen packing",
    };
  }
  if (from === "PACKED" && to === "PICKED") {
    return {
      toStatus,
      title: "Remove this completed pack?",
      bullets: [
        "The pack session is deleted — not just this screen.",
        "All box records for this session are lost.",
        "Every delivery note in the pack returns to PICKED.",
      ],
      severity: "destructive",
      confirmLabel: "Remove pack",
    };
  }
  if (from === "SHIPPING_IN_PROGRESS" && to === "PACKED") {
    return {
      toStatus,
      title: "Return this shipment to packed?",
      bullets: [
        "Every delivery note in this shipment returns to PACKED.",
        "The shipping group is dissolved — rebuild it with Start shipping after your changes.",
        "Packed boxes are kept; nothing needs to be repacked.",
      ],
      severity: "standard",
      confirmLabel: "Return to packed",
    };
  }
  return null;
}

function getPackRevertDialogModel(
  detail: Detail,
  toStatus: string,
): PackRevertDialogModel | null {
  const base = getPackRevertDialogModelFromStatuses(
    detail.current_status,
    toStatus,
  );
  if (!base) return null;

  const from = detail.current_status.trim().toUpperCase();
  const to = toStatus.trim().toUpperCase();

  let affectedNotes: readonly { id: string; dn_number: string }[] = [];
  if (from === "PACKING" && to === "PICKED") {
    affectedNotes = detail.active_pack_session?.delivery_notes ?? [];
  } else if (
    (from === "PACKED" && to === "PACKING") ||
    (from === "PACKED" && to === "PICKED")
  ) {
    affectedNotes = detail.completed_pack_sessions?.[0]?.delivery_notes ?? [];
  } else if (from === "SHIPPING_IN_PROGRESS" && to === "PACKED") {
    affectedNotes = detail.shipping_group_notes ?? [];
  }

  const n = affectedNotes.length;
  const lead =
    n > 0
      ? `This applies to all ${n} delivery note${n === 1 ? "" : "s"} in the same session as ${formatDeliveryNoteNumber(detail.dn_number)}.`
      : `This applies to every delivery note in the same session as ${formatDeliveryNoteNumber(detail.dn_number)}.`;

  return { ...base, affectedNotes, lead };
}

function PackRevertDialogIcon({
  severity,
}: {
  severity: PackRevertSeverity;
}) {
  const wrap =
    severity === "destructive"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-200"
      : severity === "caution"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-100"
        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${wrap}`}
      aria-hidden
    >
      {severity === "destructive" ? (
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      ) : severity === "caution" ? (
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.375 1.949 3.375h16.308c1.73 0 2.813-1.875 1.949-3.375L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
      ) : (
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      )}
    </div>
  );
}

/** Supervisor / team lead / CSA may create notes, and edit them while NEW. */
function canCreateDnActiveRole(): boolean {
  return ["SUPERVISOR", "TEAM_LEAD", "CSA"].includes(
    (getActiveRoleCode() ?? "").trim().toUpperCase(),
  );
}

function isPackerActiveRole(): boolean {
  return (getActiveRoleCode() ?? "").trim().toUpperCase() === "PACKER";
}

/** Only packers may change boxes / pack note after a session is completed. */
function canEditPackResult(): boolean {
  return isPackerActiveRole();
}

/** True once the note has left the warehouse pack lane for outbound shipping. */

type BoxRowState = {
  boxNumber: string;
  weightLb: string;
  lengthIn: string;
  widthIn: string;
  heightIn: string;
};

type ValidatedBox = {
  boxNumber?: string;
  weightLb: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

const emptyBoxRow = (): BoxRowState => ({
  boxNumber: "",
  weightLb: "",
  lengthIn: "",
  widthIn: "",
  heightIn: "",
});

/** Next whole-number box label after the highest numeric `boxNumber` in rows. */
function nextSequentialBoxNumber(rows: BoxRowState[]): string {
  let max = 0;
  for (const r of rows) {
    const t = r.boxNumber.trim();
    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      if (n > max) max = n;
    }
  }
  return String(max + 1);
}

function initialMarkPackedBoxRows(): BoxRowState[] {
  return [{ ...emptyBoxRow(), boxNumber: "1" }];
}

function boxRowsFromCompletedSession(
  boxes: CompletedPackSession["boxes"],
): BoxRowState[] {
  if (boxes.length === 0) return initialMarkPackedBoxRows();
  return [...boxes]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((b) => ({
      boxNumber: b.box_number?.trim() || String(b.sort_order + 1),
      weightLb: b.weight_lb,
      lengthIn: b.length_in,
      widthIn: b.width_in,
      heightIn: b.height_in,
    }));
}

type PackBoxesModalMode = "complete" | "edit";

function buildValidatedBoxes(rows: BoxRowState[]):
  | { ok: true; boxes: ValidatedBox[] }
  | { ok: false; error: string } {
  const boxes: ValidatedBox[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const b: ValidatedBox = {
      boxNumber: row.boxNumber.trim() || undefined,
      weightLb: Number(row.weightLb),
      lengthIn: Number(row.lengthIn),
      widthIn: Number(row.widthIn),
      heightIn: Number(row.heightIn),
    };
    if (
      !Number.isFinite(b.weightLb) ||
      b.weightLb <= 0 ||
      !Number.isFinite(b.lengthIn) ||
      b.lengthIn <= 0 ||
      !Number.isFinite(b.widthIn) ||
      b.widthIn <= 0 ||
      !Number.isFinite(b.heightIn) ||
      b.heightIn <= 0
    ) {
      return {
        ok: false,
        error: `Box ${i + 1}: enter positive numbers for weight (lb) and dimensions L × W × H (in).`,
      };
    }
    boxes.push(b);
  }
  return { ok: true, boxes };
}


export default function DeliveryNoteDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const updateStatusTitleId = useId();
  const startPackingTitleId = useId();
  const packRevertTitleId = useId();
  const packRevertDescId = useId();
  const shipMarkTitleId = useId();
  const shipMarkDescId = useId();

  const [ready, setReady] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Distinct SO numbers across this DN's lines. */
  /** Whole calendar days this DN has been sitting in NEW (null otherwise). */
  const newAgeDays = useMemo(() => {
    if (!detail || detail.current_status.trim().toUpperCase() !== "NEW")
      return null;
    const from = new Date(detail.created_at);
    if (Number.isNaN(from.getTime())) return null;
    const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
  }, [detail]);

  const [updateStatusOpen, setUpdateStatusOpen] = useState(false);
  const [packBoxesModalMode, setPackBoxesModalMode] =
    useState<PackBoxesModalMode>("complete");
  const [startPackingDialogOpen, setStartPackingDialogOpen] = useState(false);
  const [modalPeersSelected, setModalPeersSelected] = useState<Set<string>>(
    () => new Set(),
  );
  const [modalBoxRows, setModalBoxRows] = useState<BoxRowState[]>(() =>
    initialMarkPackedBoxRows(),
  );
  const [updateStatusSaveError, setUpdateStatusSaveError] = useState<
    string | null
  >(null);
  const [startPackingSaveError, setStartPackingSaveError] = useState<
    string | null
  >(null);
  const [modalPackCompletionNote, setModalPackCompletionNote] = useState("");
  const [portalMounted, setPortalMounted] = useState(false);
  /** Pending whole-session pack revert; body built from `detail` + `toStatus`. */
  const [packRevertOpen, setPackRevertOpen] = useState<{
    toStatus: string;
  } | null>(null);
  const [shipMarkOpen, setShipMarkOpen] = useState(false);
  const [shipTrackingNumber, setShipTrackingNumber] = useState("");
  const [shipMarkSaveError, setShipMarkSaveError] = useState<string | null>(
    null,
  );
  const [shipStartOpen, setShipStartOpen] = useState(false);
  type ShipGroupOptionNote = {
    id: string;
    dn_number: string;
    current_status: string;
  };
  const [shipGroupOptions, setShipGroupOptions] = useState<{
    auto: ShipGroupOptionNote[];
    pickable: ShipGroupOptionNote[];
    notPacked: ShipGroupOptionNote[];
  } | null>(null);
  const [shipGroupOptionsLoading, setShipGroupOptionsLoading] = useState(false);
  const [shipGroupOptionsError, setShipGroupOptionsError] = useState<
    string | null
  >(null);
  const [shipPickedIds, setShipPickedIds] = useState<string[]>([]);
  const [shipGroupMembers, setShipGroupMembers] = useState<
    { id: string; dn_number: string }[]
  >([]);
  const [shipInvoices, setShipInvoices] = useState<Record<string, string>>({});
  const [shipGroupLoading, setShipGroupLoading] = useState(false);
  const [shipRateQuote, setShipRateQuote] =
    useState<RateQuoteSelection | null>(null);

  const detailStatus = detail?.current_status;
  useEffect(() => {
    if (detailStatus && detailStatus !== "SHIPPING_IN_PROGRESS") {
      setShipRateQuote(null);
    }
  }, [id, detailStatus]);

  useEffect(() => {
    setPortalMounted(true);
  }, []);

  const authHeaders = (): HeadersInit => {
    const t = getAccessToken();
    const h: HeadersInit = { "Content-Type": "application/json" };
    if (t) (h as Record<string, string>).Authorization = `Bearer ${t}`;
    return h;
  };

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token || !id) return;
    setError(null);
    try {
      const res = await fetch(`${apiBase}/delivery-notes/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        setError(
          typeof data.message === "string"
            ? data.message
            : JSON.stringify(data),
        );
        setDetail(null);
        return;
      }
      setDetail(data as Detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setDetail(null);
    }
  }, [id, router]);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !id) return;
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    void load();
  }, [ready, id, load, router]);

  async function runStatusTransition(
    toStatus: string,
    opts?: {
      trackingNumber?: string;
      message?: string;
      confirmDoubleClaim?: boolean;
      shipTogetherIds?: string[];
      invoiceNumbers?: { deliveryNoteId: string; invoiceNumber: string }[];
      rateQuote?: RateQuoteSelection | null;
    },
  ): Promise<boolean> {
    const token = getAccessToken();
    if (!token) return false;
    setBusy(true);
    setError(null);
    try {
      const body: {
        toStatus: string;
        trackingNumber?: string;
        message?: string;
        confirmDoubleClaim?: boolean;
        shipTogetherIds?: string[];
        invoiceNumbers?: { deliveryNoteId: string; invoiceNumber: string }[];
        rateQuote?: {
          carrierCode: string;
          serviceCode: string;
          serviceName: string;
          currency: string;
          totalCharge: number;
        };
      } = { toStatus };
      const trimmedTracking = opts?.trackingNumber?.trim();
      if (trimmedTracking) body.trackingNumber = trimmedTracking;
      const trimmedMessage = opts?.message?.trim();
      if (trimmedMessage) body.message = trimmedMessage;
      if (opts?.confirmDoubleClaim) body.confirmDoubleClaim = true;
      if (opts?.shipTogetherIds?.length)
        body.shipTogetherIds = opts.shipTogetherIds;
      if (opts?.invoiceNumbers?.length)
        body.invoiceNumbers = opts.invoiceNumbers;
      if (opts?.rateQuote) {
        body.rateQuote = {
          carrierCode: opts.rateQuote.carrierCode,
          serviceCode: opts.rateQuote.serviceCode,
          serviceName: opts.rateQuote.serviceName,
          currency: opts.rateQuote.currency,
          totalCharge: opts.rateQuote.totalCharge,
        };
      }
      const res = await fetch(`${apiBase}/delivery-notes/${id}/transition`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return false;
      }
      if (data.requiresConfirmation) {
        const confirmed = window.confirm(
          `${data.warning ?? "You already have a note in progress."}\n\nClick OK to proceed anyway, or Cancel to stop.`,
        );
        if (confirmed) {
          return runStatusTransition(toStatus, {
            ...opts,
            confirmDoubleClaim: true,
          });
        }
        return false;
      }
      if (!res.ok) {
        setError(
          typeof data.message === "string"
            ? data.message
            : JSON.stringify(data),
        );
        return false;
      }
      setDetail(data as Detail);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function postTransition(toStatus: string) {
    const token = getAccessToken();
    if (!token) return;
    if (
      detail &&
      packSessionRevertNeedsConfirm(detail.current_status, toStatus)
    ) {
      setError(null);
      setPackRevertOpen({ toStatus });
      return;
    }
    await runStatusTransition(toStatus);
  }

  async function supervisorStatusTransition(
    toStatus: string,
    message: string,
  ): Promise<boolean> {
    return runStatusTransition(toStatus, { message });
  }

  async function saveRushFromModal(
    rushed: boolean,
    reason: string,
  ): Promise<boolean> {
    const token = getAccessToken();
    if (!token) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/delivery-notes/${id}/rush`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ rushed, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return false;
      }
      if (!res.ok) {
        setError(
          typeof data.message === "string"
            ? data.message
            : JSON.stringify(data),
        );
        return false;
      }
      setDetail(data as Detail);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function savePriorityFromModal(
    toPriorityNo: number,
    reason: string,
  ): Promise<boolean> {
    const token = getAccessToken();
    if (!token) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/delivery-notes/${id}/priority`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ toPriorityNo, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return false;
      }
      if (!res.ok) {
        setError(
          typeof data.message === "string"
            ? data.message
            : JSON.stringify(data),
        );
        return false;
      }
      setDetail(data as Detail);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function loadShipGroupOptions() {
    const token = getAccessToken();
    if (!token || !id) return;
    setShipGroupOptionsLoading(true);
    setShipGroupOptionsError(null);
    try {
      const res = await fetch(
        `${apiBase}/delivery-notes/${id}/ship-group-options`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setShipGroupOptionsError(
          typeof data.message === "string"
            ? data.message
            : "Could not load shipping options.",
        );
        setShipGroupOptions(null);
        return;
      }
      setShipGroupOptions({
        auto: Array.isArray(data.auto) ? data.auto : [],
        pickable: Array.isArray(data.pickable) ? data.pickable : [],
        notPacked: Array.isArray(data.notPacked) ? data.notPacked : [],
      });
    } catch (e) {
      setShipGroupOptionsError(
        e instanceof Error ? e.message : "Could not load shipping options.",
      );
      setShipGroupOptions(null);
    } finally {
      setShipGroupOptionsLoading(false);
    }
  }

  async function loadShippingGroupMembers() {
    const token = getAccessToken();
    if (!token || !id) return;
    setShipGroupLoading(true);
    try {
      const res = await fetch(
        `${apiBase}/delivery-notes/${id}/shipping-group-members`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json().catch(() => ({}));
      const members = Array.isArray(data.members) ? data.members : [];
      setShipGroupMembers(members);
      setShipInvoices(
        Object.fromEntries(members.map((m: { id: string }) => [m.id, ""])),
      );
    } catch {
      setShipGroupMembers([]);
      setShipInvoices({});
    } finally {
      setShipGroupLoading(false);
    }
  }

  function openMarkShippedModal() {
    setShipMarkSaveError(null);
    setShipTrackingNumber("");
    setShipGroupMembers([]);
    setShipInvoices({});
    setShipMarkOpen(true);
    void loadShippingGroupMembers();
  }

  function closeMarkShippedModal() {
    setShipMarkOpen(false);
    setShipMarkSaveError(null);
  }

  function openShipStartModal() {
    setShipGroupOptions(null);
    setShipGroupOptionsError(null);
    setShipPickedIds([]);
    setShipStartOpen(true);
    void loadShipGroupOptions();
  }

  function shipperAdvance(toStatus: string) {
    if (toStatus === "SHIPPED") {
      openMarkShippedModal();
      return;
    }
    if (toStatus === "SHIPPING_IN_PROGRESS") {
      openShipStartModal();
      return;
    }
    void postTransition(toStatus);
  }

  function closeShipStartModal() {
    setShipStartOpen(false);
  }

  function toggleShipPicked(id: string) {
    setShipPickedIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  async function confirmStartShipping() {
    const ok = await runStatusTransition("SHIPPING_IN_PROGRESS", {
      shipTogetherIds: shipPickedIds,
    });
    if (ok) closeShipStartModal();
  }

  async function confirmMarkShipped() {
    const tracking = shipTrackingNumber.trim();
    if (!tracking) {
      setShipMarkSaveError("Enter a tracking number.");
      return;
    }
    const invoiceNumbers: { deliveryNoteId: string; invoiceNumber: string }[] =
      [];
    for (const m of shipGroupMembers) {
      const num = (shipInvoices[m.id] ?? "").trim();
      if (!num) {
        setShipMarkSaveError(
          `Enter an invoice number for ${formatDeliveryNoteNumber(m.dn_number)}.`,
        );
        return;
      }
      invoiceNumbers.push({ deliveryNoteId: m.id, invoiceNumber: num });
    }
    setShipMarkSaveError(null);
    const ok = await runStatusTransition("SHIPPED", {
      trackingNumber: tracking,
      invoiceNumbers,
      rateQuote: shipRateQuote,
    });
    if (ok) closeMarkShippedModal();
  }

  async function confirmPackRevert() {
    if (!packRevertOpen) return;
    const ok = await runStatusTransition(packRevertOpen.toStatus);
    if (ok) setPackRevertOpen(null);
  }

  async function packStartRequest(
    peerIds: string[],
    confirmDoubleClaim = false,
  ): Promise<
    | { ok: true; detail: Detail }
    | { ok: false; message: string }
    | { ok: false; requiresConfirmation: true; warning: string }
  > {
    const token = getAccessToken();
    if (!token) return { ok: false, message: "Not signed in" };
    const res = await fetch(`${apiBase}/delivery-notes/${id}/pack/start`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ peerDeliveryNoteIds: peerIds, confirmDoubleClaim }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      clearSession();
      router.replace("/login");
      return { ok: false, message: "Session expired" };
    }
    if (data.requiresConfirmation) {
      return {
        ok: false,
        requiresConfirmation: true,
        warning: data.warning ?? "You already have a note in progress.",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        message:
          typeof data.message === "string"
            ? data.message
            : JSON.stringify(data),
      };
    }
    return { ok: true, detail: data as Detail };
  }

  async function packBoxesRequest(
    path: "complete" | "update",
    boxes: ValidatedBox[],
    packCompletionNote?: string,
  ): Promise<
    | { ok: true; detail: Detail }
    | { ok: false; message: string }
  > {
    const token = getAccessToken();
    if (!token) return { ok: false, message: "Not signed in" };
    const body: {
      boxes: ValidatedBox[];
      packCompletionNote?: string;
    } = { boxes };
    const note = packCompletionNote?.trim();
    if (note) body.packCompletionNote = note;
    const res = await fetch(
      `${apiBase}/delivery-notes/${id}/pack/${path}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      clearSession();
      router.replace("/login");
      return { ok: false, message: "Session expired" };
    }
    if (!res.ok) {
      return {
        ok: false,
        message:
          typeof data.message === "string"
            ? data.message
            : JSON.stringify(data),
      };
    }
    return { ok: true, detail: data as Detail };
  }

  function openStartPackingDialog() {
    if (!detail || detail.current_status !== "PICKED") return;
    const peers = detail.packing_combine_peers?.items ?? [];
    if (peers.length === 0) {
      // Nothing to combine with — go straight to PACKING without the modal.
      void submitStartPackingSession();
      return;
    }
    setModalPeersSelected(new Set());
    setStartPackingSaveError(null);
    setStartPackingDialogOpen(true);
  }

  function closeStartPackingDialog() {
    setStartPackingDialogOpen(false);
    setStartPackingSaveError(null);
  }

  function openUpdateStatusModal() {
    if (!detail) return;
    if (detail.current_status === "PICKED") {
      openStartPackingDialog();
      return;
    }
    if (detail.current_status !== "PACKING") return;
    setPackBoxesModalMode("complete");
    setModalBoxRows(initialMarkPackedBoxRows());
    setModalPackCompletionNote(
      `Packed cart ${detail.current_priority_no ?? 1}`,
    );
    setUpdateStatusSaveError(null);
    setUpdateStatusOpen(true);
  }

  function openEditPackResultModal() {
    if (!canEditPackResult()) return;
    if (!detail || detail.current_status !== "PACKED") return;
    const session = detail.completed_pack_sessions?.[0];
    if (!session) return;
    setPackBoxesModalMode("edit");
    setModalBoxRows(boxRowsFromCompletedSession(session.boxes ?? []));
    setModalPackCompletionNote(session.pack_completion_note?.trim() ?? "");
    setUpdateStatusSaveError(null);
    setUpdateStatusOpen(true);
  }

  function closeUpdateStatusModal() {
    setUpdateStatusOpen(false);
    setUpdateStatusSaveError(null);
    setPackBoxesModalMode("complete");
  }

  useEffect(() => {
    const anyOpen =
      updateStatusOpen ||
      startPackingDialogOpen ||
      packRevertOpen != null ||
      shipMarkOpen;
    if (!anyOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [updateStatusOpen, startPackingDialogOpen, packRevertOpen, shipMarkOpen]);

  useEffect(() => {
    if (
      !updateStatusOpen &&
      !startPackingDialogOpen &&
      !packRevertOpen &&
      !shipMarkOpen
    )
      return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      if (packRevertOpen) {
        setPackRevertOpen(null);
        return;
      }
      if (shipMarkOpen) {
        closeMarkShippedModal();
        return;
      }
      if (startPackingDialogOpen) {
        closeStartPackingDialog();
        return;
      }
      closeUpdateStatusModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    updateStatusOpen,
    startPackingDialogOpen,
    packRevertOpen,
    shipMarkOpen,
    shipStartOpen,
    busy,
  ]);

  useEffect(() => {
    if (!packRevertOpen || !detail) return;
    if (!getPackRevertDialogModel(detail, packRevertOpen.toStatus)) {
      setPackRevertOpen(null);
    }
  }, [detail, packRevertOpen]);

  async function submitStartPackingSession() {
    if (!detail || detail.current_status !== "PICKED") return;
    setStartPackingSaveError(null);
    const allowedIds = new Set(
      (detail.packing_combine_peers?.items ?? [])
        .filter((p) => packPeerSelectable(p))
        .map((p) => p.id),
    );
    const peerIds = [...modalPeersSelected].filter((id) => allowedIds.has(id));
    setBusy(true);
    try {
      const r = await packStartRequest(peerIds);
      if (!r.ok) {
        if ("requiresConfirmation" in r) {
          // Show warning; user can confirm to proceed.
          const confirmed = window.confirm(
            `${r.warning}\n\nClick OK to start packing anyway, or Cancel to stop.`,
          );
          if (confirmed) {
            const r2 = await packStartRequest(peerIds, true);
            if (!r2.ok) {
              setStartPackingSaveError(
                "message" in r2 ? r2.message : "Failed to start packing",
              );
              return;
            }
            setDetail(r2.detail);
            closeStartPackingDialog();
          }
          return;
        }
        setStartPackingSaveError(r.message);
        return;
      }
      setDetail(r.detail);
      closeStartPackingDialog();
    } finally {
      setBusy(false);
    }
  }

  async function submitUpdateStatusModal() {
    setUpdateStatusSaveError(null);
    const isEdit = packBoxesModalMode === "edit";
    if (isEdit) {
      if (!canEditPackResult()) {
        setUpdateStatusSaveError(
          "Only the active Packer role can edit pack results.",
        );
        return;
      }
      if (detail?.current_status !== "PACKED") {
        setUpdateStatusSaveError(
          "Pack result can only be edited while this note is PACKED.",
        );
        return;
      }
    } else if (detail?.current_status !== "PACKING") {
      setUpdateStatusSaveError(
        "Use this dialog while the note is in PACKING (Next on the progress bar).",
      );
      return;
    }

    const built = buildValidatedBoxes(modalBoxRows);
    if (!built.ok) {
      setUpdateStatusSaveError(built.error);
      return;
    }

    setBusy(true);
    try {
      const result = await packBoxesRequest(
        isEdit ? "update" : "complete",
        built.boxes,
        modalPackCompletionNote,
      );
      if (!result.ok) {
        if (isEdit) {
          setUpdateStatusSaveError(result.message);
        } else {
          setError(
            `${result.message} If packing started, open Next on the progress bar and try again.`,
          );
          setModalBoxRows(initialMarkPackedBoxRows());
          await load();
          closeUpdateStatusModal();
        }
        return;
      }

      setModalBoxRows(initialMarkPackedBoxRows());
      setDetail(result.detail);
      closeUpdateStatusModal();
    } finally {
      setBusy(false);
    }
  }

  const packBoxesModalActive =
    updateStatusOpen &&
    detail &&
    ((packBoxesModalMode === "complete" && detail.current_status === "PACKING") ||
      (packBoxesModalMode === "edit" && detail.current_status === "PACKED"));

  function toggleModalPackPeer(peerId: string) {
    setModalPeersSelected((prev) => {
      const next = new Set(prev);
      if (next.has(peerId)) next.delete(peerId);
      else next.add(peerId);
      return next;
    });
  }

  const peerItems = detail?.packing_combine_peers?.items ?? [];
  const selectablePackPeers = peerItems.filter((p) => packPeerSelectable(p));
  const otherClusterPackPeers = peerItems.filter((p) => !packPeerSelectable(p));
  const packRevertModel =
    detail && packRevertOpen
      ? getPackRevertDialogModel(detail, packRevertOpen.toStatus)
      : null;
  const btnBase =
    "inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-medium transition disabled:pointer-events-none disabled:opacity-40";
  const btnGhost =
    "border border-slate-200 bg-transparent text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800/80";
  const btnPrimary =
    "btn-delta-primary rounded-lg transition disabled:opacity-40";
  const btnCautionConfirm =
    "bg-amber-600 text-white shadow-sm hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500";
  const btnDestructiveConfirm =
    "bg-rose-600 text-white shadow-sm hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-500";
  const inputSm =
    "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none ring-slate-900/0 transition focus:border-slate-300 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-100/10";

  if (!ready || !id) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 bg-[var(--app-canvas)]">
        <div className="h-1 w-12 rounded-full bg-slate-300 dark:bg-slate-600" />
        <p className="text-xs font-medium tracking-wide text-slate-500">
          Loading…
        </p>
      </div>
    );
  }


  function handleRailPrimaryAction(key: PrimaryActionKey) {
    if (busy) return;
    switch (key) {
      case "START_PICKING":
        void runStatusTransition("PICKING");
        break;
      case "MARK_PICKED":
        void runStatusTransition("PICKED");
        break;
      case "START_PACKING":
        openStartPackingDialog();
        break;
      case "MARK_PACKED":
        openUpdateStatusModal();
        break;
      case "START_SHIPPING":
        shipperAdvance("SHIPPING_IN_PROGRESS");
        break;
      case "MARK_SHIPPED":
        shipperAdvance("SHIPPED");
        break;
    }
  }

  return (
    <OperationsShell
      contentDensity="compact"
      title={
        detail ? (
          <DeliveryNoteNumber
            dnNumber={detail.dn_number}
            isRushed={detail.is_rushed}
            rushReason={detail.latest_rush_reason}
            className="text-inherit"
            numberClassName="text-inherit"
          />
        ) : (
          "Delivery note"
        )
      }
      subtitle={
        detail ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="truncate font-medium text-slate-800 dark:text-slate-100">
              {detail.sold_to_name}
            </span>
            <span className="text-slate-300 dark:text-slate-600" aria-hidden>
              ·
            </span>
            <span className="tabular-nums text-slate-500 dark:text-slate-400">
              {detail.lines.length} line
              {detail.lines.length === 1 ? "" : "s"}
            </span>
            <StatusBadgeWithHover
              status={detail.current_status}
              isOpen={detail.is_open}
              hoverInput={detailStatusHoverInput({
                status_history: detail.status_history,
                completed_pack_sessions: detail.completed_pack_sessions,
              })}
            />
            {newAgeDays != null ? (
              <span
                className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500"
                title={
                  newAgeDays === 0
                    ? "Imported today"
                    : `In New for ${newAgeDays} day${newAgeDays === 1 ? "" : "s"}`
                }
              >
                · {newAgeDays === 0 ? "today" : `${newAgeDays}d`}
              </span>
            ) : null}
            {detail.current_priority_no != null ? (
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                P{detail.current_priority_no}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-slate-500">Loading record…</span>
        )
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <nav className="flex shrink-0 items-center justify-between">
          <Link
            href="/delivery-notes"
            className="group inline-flex w-fit items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <span
              className="text-slate-400 transition group-hover:-translate-x-0.5 dark:text-slate-500"
              aria-hidden
            >
              ←
            </span>
            All notes
          </Link>
          {detail &&
          detail.current_status === "NEW" &&
          canCreateDnActiveRole() ? (
            <Link
              href={`/delivery-notes/${detail.id}/edit`}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-[12px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Edit
            </Link>
          ) : null}
        </nav>

        {detail &&
        detail.current_status === "PACKING" &&
        detail.active_pack_session ? (
          <CombinedPackSessionBanner
            session={detail.active_pack_session}
            currentDnId={detail.id}
          />
        ) : null}
        {detail &&
        (detail.current_status === "PACKED" ||
          detail.current_status === "SHIPPING_IN_PROGRESS") &&
        detail.completed_pack_sessions?.[0] ? (
          <CompletedPackResultBanner
            session={detail.completed_pack_sessions[0]}
            currentDnId={detail.id}
            totalSessionCount={detail.completed_pack_sessions.length}
            editable={
              detail.current_status === "PACKED" && canEditPackResult()
            }
            onEdit={
              canEditPackResult() && detail.current_status === "PACKED"
                ? openEditPackResultModal
                : undefined
            }
            readOnly={detail.current_status === "SHIPPING_IN_PROGRESS"}
            rateEstimator={
              detail.current_status === "SHIPPING_IN_PROGRESS" ? (
                <RateQuoteEstimator
                  deliveryNoteId={detail.id}
                  selected={shipRateQuote}
                  onSelect={setShipRateQuote}
                  primaryButton
                />
              ) : undefined
            }
          />
        ) : null}

        {!detail && !error ? (
          <p className="text-center text-sm text-slate-500">Loading…</p>
        ) : null}

        {detail ? (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
            <div className="min-w-0 space-y-4">
              <DnCustomerCard detail={detail} />
              <DnShipToCard detail={detail} />
              <DnLinesCard detail={detail} />
            </div>
            <div className="min-w-0 xl:sticky xl:top-4">
              <DnWorkflowRail
                status={detail.current_status}
                onHoldFromStatus={detail.on_hold_from_status}
                isRushed={detail.is_rushed}
                rushReason={detail.latest_rush_reason}
                currentPriorityNo={detail.current_priority_no}
                allowedNextStatuses={detail.allowedNextStatuses}
                canSetPriority={detail.canSetPriority}
                canMarkRush={detail.canMarkRush}
                canClearRush={detail.canClearRush}
                busy={busy}
                onPrimaryAction={handleRailPrimaryAction}
                onTransition={supervisorStatusTransition}
                onUnpack={() => {
                  void postTransition("PICKED");
                }}
                onReturnToPacked={() => {
                  void postTransition("PACKED");
                }}
                onPrioritySave={savePriorityFromModal}
                onRushSave={saveRushFromModal}
                handoff={detail.workflow_handoff}
                statusHistory={detail.status_history as StatusHistoryEntry[]}
                shipment={detail.latest_shipment}
              />
            </div>
          </div>
        ) : null}
      </div>

      {portalMounted && startPackingDialogOpen && detail &&
      detail.current_status === "PICKED"
        ? createPortal(
            <div className="fixed inset-0 z-[231] flex items-end justify-center sm:items-center sm:p-6">
              <button
                type="button"
                aria-label="Close dialog"
                className="absolute inset-0 bg-slate-950/50 backdrop-blur-[1px] dark:bg-black/60"
                onClick={() => {
                  if (!busy) closeStartPackingDialog();
                }}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={startPackingTitleId}
                className="relative z-10 flex max-h-[min(92dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-2xl sm:max-h-[min(88vh,40rem)] sm:rounded-2xl dark:shadow-black/40"
              >
                <div className="border-b border-[color:var(--app-border)] px-5 py-4">
                  <h2
                    id={startPackingTitleId}
                    className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100"
                  >
                    Start packing
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    DN{" "}
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {formatDeliveryNoteNumber(detail.dn_number)}
                    </span>
                    {" — "}
                    moves to PACKING with the notes you select below. Only
                    PICKED notes in the same pack cluster can join.
                  </p>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                  {peerItems.length > 0 ? (
                    <div className="space-y-4">
                      {selectablePackPeers.length > 0 ? (
                        <div>
                          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Add to this pack session (optional)
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                            Select other PICKED notes in the same cluster.
                            Leave all unchecked to pack this note alone.
                          </p>
                          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950/50">
                            {selectablePackPeers.map((p) => (
                              <li key={p.id}>
                                <div className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={modalPeersSelected.has(p.id)}
                                      disabled={busy}
                                      onChange={() => toggleModalPackPeer(p.id)}
                                      className="rounded border-slate-300 text-slate-900 dark:border-slate-600 dark:bg-slate-900"
                                    />
                                    <span className="font-mono text-slate-800 dark:text-slate-200">
                                      {formatDeliveryNoteNumber(p.dn_number)}
                                    </span>
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.6rem] font-medium uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                      PICKED
                                    </span>
                                  </label>
                                  <Link
                                    href={`/delivery-notes/${p.id}`}
                                    className="shrink-0 text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline dark:hover:text-slate-300"
                                  >
                                    Open
                                  </Link>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {otherClusterPackPeers.length > 0 ? (
                        <div>
                          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Same cluster — not PICKED yet
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                            These notes share the pack cluster but are not
                            PICKED yet, so they cannot join.
                          </p>
                          <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200/80 bg-slate-50/80 p-2 dark:border-slate-700 dark:bg-slate-900/40">
                            {otherClusterPackPeers.map((p) => (
                              <li
                                key={p.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded px-1 py-1 text-xs"
                              >
                                <span className="font-mono text-slate-700 dark:text-slate-300">
                                  {formatDeliveryNoteNumber(p.dn_number)}
                                </span>
                                <span className="rounded bg-white px-1.5 py-0.5 text-[0.6rem] font-medium uppercase text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:ring-slate-600">
                                  {(p.current_status ?? "—").trim()}
                                </span>
                                <Link
                                  href={`/delivery-notes/${p.id}`}
                                  className="text-[11px] font-medium text-slate-500 underline-offset-2 hover:underline"
                                >
                                  Open
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {selectablePackPeers.length === 0 &&
                      otherClusterPackPeers.length > 0 ? (
                        <p className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/25 dark:text-amber-100">
                          There are no other PICKED notes right now. Use{" "}
                          <span className="font-semibold">Start packing</span> to
                          begin with this note alone, or pick the others first.
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-3 text-xs leading-relaxed text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-100">
                      <p className="font-semibold text-amber-950 dark:text-amber-50">
                        No other notes can join right now.
                      </p>
                      <p className="mt-1.5 text-amber-950/90 dark:text-amber-100/90">
                        The rest of this cluster is already packing or packed, or
                        combining is off for this customer — you&apos;ll pack this
                        delivery note on its own.
                      </p>
                    </div>
                  )}

                  {startPackingSaveError ? (
                    <p className="text-sm text-red-700 dark:text-red-300">
                      {startPackingSaveError}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--app-border)] px-5 py-4">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={closeStartPackingDialog}
                    className={`${btnBase} ${btnGhost} px-4`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitStartPackingSession()}
                    className={`${btnBase} ${btnPrimary} px-4`}
                  >
                    {busy ? "Starting…" : "Start packing"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {portalMounted && packRevertModel && detail
        ? createPortal(
            <div className="fixed inset-0 z-[235] flex items-end justify-center sm:items-center sm:p-6">
              <button
                type="button"
                aria-label="Close dialog"
                className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px] dark:bg-black/65"
                onClick={() => {
                  if (!busy) setPackRevertOpen(null);
                }}
              />
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={packRevertTitleId}
                aria-describedby={packRevertDescId}
                className={`relative z-10 flex max-h-[min(92dvh,42rem)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-2xl sm:max-h-[min(88vh,42rem)] sm:rounded-2xl dark:shadow-black/40 ${
                  packRevertModel.severity === "destructive"
                    ? "border-l-[6px] border-l-rose-600"
                    : packRevertModel.severity === "caution"
                      ? "border-l-[6px] border-l-amber-500"
                      : "border-l-[6px] border-l-slate-400"
                }`}
              >
                <div className="border-b border-[color:var(--app-border)] px-5 py-4">
                  <div className="flex items-start gap-3.5">
                    <PackRevertDialogIcon
                      severity={packRevertModel.severity}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-500">
                        Confirm step back
                      </p>
                      <h2
                        id={packRevertTitleId}
                        className="mt-1 text-base font-semibold leading-snug tracking-tight text-slate-900 dark:text-slate-100"
                      >
                        {packRevertModel.title}
                      </h2>
                      <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        {packRevertModel.lead}
                      </p>
                      <p className="mt-3 inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-slate-700 ring-1 ring-slate-200/80 dark:bg-slate-800/80 dark:text-slate-200 dark:ring-slate-600/80">
                        <span className="font-medium text-slate-500 dark:text-slate-400">
                          Status
                        </span>
                        <span>{detail.current_status}</span>
                        <span aria-hidden className="text-slate-400 dark:text-slate-500">
                          →
                        </span>
                        <span>{packRevertModel.toStatus}</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                  <div>
                    <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                      What will change
                    </p>
                    <ul
                      id={packRevertDescId}
                      className="mt-2 list-none space-y-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
                    >
                      {packRevertModel.bullets.map((text) => (
                        <li key={text} className="flex gap-2.5">
                          <span
                            className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500"
                            aria-hidden
                          />
                          <span>{text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {packRevertModel.affectedNotes.length > 0 ? (
                    <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 px-3 py-3 dark:border-slate-700/80 dark:bg-slate-900/35">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                        Delivery notes in this session (
                        {packRevertModel.affectedNotes.length})
                      </p>
                      <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-[11px]">
                        {packRevertModel.affectedNotes.map((n) => {
                          const isHere = n.id === detail.id;
                          return (
                            <li key={n.id}>
                              {isHere ? (
                                <span className="flex flex-wrap items-baseline gap-2">
                                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                                    {formatDeliveryNoteNumber(n.dn_number)}
                                  </span>
                                  <span className="rounded bg-slate-200/90 px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                    This note
                                  </span>
                                </span>
                              ) : (
                                <Link
                                  href={`/delivery-notes/${n.id}`}
                                  className="font-mono text-slate-700 underline-offset-2 hover:underline dark:text-slate-300"
                                >
                                  {formatDeliveryNoteNumber(n.dn_number)}
                                </Link>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:border-slate-600 dark:text-slate-400">
                      Member list will load from the pack session on the server.
                    </p>
                  )}

                  {error ? (
                    <p
                      role="alert"
                      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/35 dark:text-red-200"
                    >
                      {error}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--app-border)] px-5 py-4">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPackRevertOpen(null)}
                    className={`${btnBase} ${btnGhost} px-4`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmPackRevert()}
                    className={`${btnBase} px-4 ${
                      packRevertModel.severity === "destructive"
                        ? btnDestructiveConfirm
                        : packRevertModel.severity === "caution"
                          ? btnCautionConfirm
                          : btnPrimary
                    }`}
                  >
                    {busy ? "Working…" : packRevertModel.confirmLabel}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {portalMounted && packBoxesModalActive
        ? createPortal(
            <div className="fixed inset-0 z-[230] flex items-end justify-center sm:items-center sm:p-6">
              <button
                type="button"
                aria-label="Close dialog"
                className="absolute inset-0 bg-slate-950/50 backdrop-blur-[1px] dark:bg-black/60"
                onClick={() => {
                  if (!busy) closeUpdateStatusModal();
                }}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={updateStatusTitleId}
                className="relative z-10 flex max-h-[min(92dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-2xl sm:max-h-[min(88vh,40rem)] sm:rounded-2xl dark:shadow-black/40"
              >
                <div className="border-b border-[color:var(--app-border)] px-5 py-4">
                  <h2
                    id={updateStatusTitleId}
                    className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100"
                  >
                    {packBoxesModalMode === "edit"
                      ? "Edit pack result"
                      : "Mark packed"}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    DN{" "}
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {formatDeliveryNoteNumber(detail.dn_number)}
                    </span>
                    {packBoxesModalMode === "edit" ? (
                      <>
                        {" — "}Update the boxes and pack note for this completed
                        session.
                        {(detail.completed_pack_sessions?.[0]?.delivery_notes
                          ?.length ?? 0) > 1
                          ? " Applies to every delivery note in the combined pack."
                          : null}
                      </>
                    ) : (
                      <>
                        {" — "}Record each box (weight in lb, dimensions L × W × H
                        in inches). Every note in this pack session moves to
                        PACKED together.
                      </>
                    )}
                  </p>
                </div>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                  <div>
                    <label
                      htmlFor="modal-pack-completion-note"
                      className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                    >
                      Pack note
                    </label>
                    <textarea
                      id="modal-pack-completion-note"
                      rows={2}
                      value={modalPackCompletionNote}
                      disabled={busy}
                      onChange={(e) => setModalPackCompletionNote(e.target.value)}
                      className={`mt-1.5 ${inputSm} resize-none`}
                      placeholder="e.g. cart label or handling notes"
                    />
                  </div>
                  <div className="space-y-3">
                    <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Boxes
                    </p>
                    <div className="space-y-3">
                      {modalBoxRows.map((row, idx) => (
                          <div
                            key={idx}
                            className="grid gap-2 rounded-lg bg-slate-50/90 p-3 sm:grid-cols-6 dark:bg-slate-900/35"
                          >
                            <input
                              type="text"
                              placeholder="Box #"
                              value={row.boxNumber}
                              disabled={busy}
                              onChange={(e) => {
                                const v = e.target.value;
                                setModalBoxRows((rows) =>
                                  rows.map((r, i) =>
                                    i === idx ? { ...r, boxNumber: v } : r,
                                  ),
                                );
                              }}
                              className={`sm:col-span-1 ${inputSm}`}
                            />
                            <input
                              type="number"
                              step="any"
                              min={0}
                              placeholder="lb"
                              value={row.weightLb}
                              disabled={busy}
                              onChange={(e) => {
                                const v = e.target.value;
                                setModalBoxRows((rows) =>
                                  rows.map((r, i) =>
                                    i === idx ? { ...r, weightLb: v } : r,
                                  ),
                                );
                              }}
                              className={`${inputSm} tabular-nums`}
                            />
                            <input
                              type="number"
                              step="any"
                              min={0}
                              placeholder="L in"
                              value={row.lengthIn}
                              disabled={busy}
                              onChange={(e) => {
                                const v = e.target.value;
                                setModalBoxRows((rows) =>
                                  rows.map((r, i) =>
                                    i === idx ? { ...r, lengthIn: v } : r,
                                  ),
                                );
                              }}
                              className={`${inputSm} tabular-nums`}
                            />
                            <input
                              type="number"
                              step="any"
                              min={0}
                              placeholder="W in"
                              value={row.widthIn}
                              disabled={busy}
                              onChange={(e) => {
                                const v = e.target.value;
                                setModalBoxRows((rows) =>
                                  rows.map((r, i) =>
                                    i === idx ? { ...r, widthIn: v } : r,
                                  ),
                                );
                              }}
                              className={`${inputSm} tabular-nums`}
                            />
                            <div className="flex items-center gap-2 sm:col-span-2">
                              <input
                                type="number"
                                step="any"
                                min={0}
                                placeholder="H in"
                                value={row.heightIn}
                                disabled={busy}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setModalBoxRows((rows) =>
                                    rows.map((r, i) =>
                                      i === idx ? { ...r, heightIn: v } : r,
                                    ),
                                  );
                                }}
                                className={`min-w-0 flex-1 ${inputSm} tabular-nums`}
                              />
                              {modalBoxRows.length > 1 ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  className="shrink-0 text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-red-700 hover:underline dark:hover:text-red-400"
                                  onClick={() =>
                                    setModalBoxRows((rows) =>
                                      rows.filter((_, i) => i !== idx),
                                    )
                                  }
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setModalBoxRows((r) => [
                            ...r,
                            {
                              ...emptyBoxRow(),
                              boxNumber: nextSequentialBoxNumber(r),
                            },
                          ])
                        }
                        className={`${btnBase} ${btnGhost}`}
                      >
                        Add box
                      </button>
                  </div>

                  {updateStatusSaveError ? (
                    <p className="text-sm text-red-700 dark:text-red-300">
                      {updateStatusSaveError}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--app-border)] px-5 py-4">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={closeUpdateStatusModal}
                    className={`${btnBase} ${btnGhost} px-4`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitUpdateStatusModal()}
                    className={`${btnBase} ${btnPrimary} px-4`}
                  >
                    {busy
                      ? "Saving…"
                      : packBoxesModalMode === "edit"
                        ? "Save changes"
                        : "Mark packed"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {portalMounted && shipStartOpen && detail
        ? createPortal(
            <div className="fixed inset-0 z-[231] flex items-end justify-center sm:items-center sm:p-6">
              <button
                type="button"
                aria-label="Close dialog"
                className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px] dark:bg-black/65"
                onClick={() => {
                  if (!busy) closeShipStartModal();
                }}
              />
              <div
                role="alertdialog"
                aria-modal="true"
                className="relative z-10 flex max-h-[min(92dvh,40rem)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-[color:var(--app-border)] border-l-[6px] border-l-indigo-500 bg-[var(--app-surface)] shadow-2xl sm:max-h-[min(88vh,40rem)] sm:rounded-2xl dark:shadow-black/40"
              >
                <div className="border-b border-[color:var(--app-border)] px-5 py-4">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Start shipping
                  </p>
                  <h2 className="mt-1 text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">
                    Ship these notes together?
                  </h2>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    Notes packed together are always included. You can also add
                    other packed notes with the same customer, ship-to, and ship
                    method.
                  </p>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                  {shipGroupOptionsLoading ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Loading shipping options…
                    </p>
                  ) : shipGroupOptionsError ? (
                    <p
                      role="alert"
                      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/35 dark:text-red-200"
                    >
                      {shipGroupOptionsError}
                    </p>
                  ) : shipGroupOptions ? (
                    <>
                      {shipGroupOptions.auto.length > 0 ? (
                        <div>
                          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                            Packed together — always included (
                            {shipGroupOptions.auto.length})
                          </p>
                          <ul className="mt-2 space-y-1 text-[11px]">
                            {shipGroupOptions.auto.map((n) => (
                              <li key={n.id}>
                                <span className="font-mono font-medium text-slate-800 dark:text-slate-100">
                                  {formatDeliveryNoteNumber(n.dn_number)}
                                </span>
                                {n.id === detail.id ? (
                                  <span className="ml-2 text-slate-500">
                                    (this note)
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {shipGroupOptions.pickable.length > 0 ? (
                        <div>
                          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                            Also packed — add to this shipment (
                            {shipGroupOptions.pickable.length})
                          </p>
                          <ul className="mt-2 space-y-1.5">
                            {shipGroupOptions.pickable.map((n) => {
                              const checked = shipPickedIds.includes(n.id);
                              return (
                                <li key={n.id}>
                                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200/80 px-2.5 py-1.5 text-[11px] hover:bg-slate-50 dark:border-slate-700/80 dark:hover:bg-slate-900/40">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={busy}
                                      onChange={() => toggleShipPicked(n.id)}
                                      className="h-3.5 w-3.5 accent-indigo-600"
                                    />
                                    <span className="font-mono font-medium text-slate-800 dark:text-slate-100">
                                      {formatDeliveryNoteNumber(n.dn_number)}
                                    </span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                      {shipGroupOptions.notPacked.length > 0 ? (
                        <div
                          role="alert"
                          className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-3 dark:border-amber-900/60 dark:bg-amber-950/30"
                        >
                          <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                            {shipGroupOptions.notPacked.length} more note
                            {shipGroupOptions.notPacked.length === 1 ? "" : "s"}{" "}
                            for this customer, ship-to, and ship method{" "}
                            {shipGroupOptions.notPacked.length === 1
                              ? "isn't"
                              : "aren't"}{" "}
                            packed yet:
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-amber-800 dark:text-amber-200">
                            {shipGroupOptions.notPacked
                              .map((n) => formatDeliveryNoteNumber(n.dn_number))
                              .join(", ")}
                          </p>
                          <p className="mt-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                            Wait for them to be packed, or ship the selected
                            notes now?
                          </p>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--app-border)] px-5 py-4">
                  {shipGroupOptions &&
                  !shipGroupOptionsLoading &&
                  shipGroupOptions.notPacked.length > 0 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={closeShipStartModal}
                      className={`${btnBase} ${btnCautionConfirm} px-4`}
                    >
                      Wait for them
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy || shipGroupOptionsLoading}
                    onClick={closeShipStartModal}
                    className={`${btnBase} ${btnGhost} px-4`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy || shipGroupOptionsLoading || !!shipGroupOptionsError
                    }
                    onClick={() => void confirmStartShipping()}
                    className={`${btnBase} ${btnPrimary} px-4`}
                  >
                    {busy
                      ? "Working…"
                      : shipGroupOptions &&
                          !shipGroupOptionsLoading &&
                          shipGroupOptions.notPacked.length > 0
                        ? "Ship selected now"
                        : "Start shipping"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {portalMounted && shipMarkOpen && detail
        ? createPortal(
            <div className="fixed inset-0 z-[232] flex items-end justify-center sm:items-center sm:p-6">
              <button
                type="button"
                aria-label="Close dialog"
                className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px] dark:bg-black/65"
                onClick={() => {
                  if (!busy) closeMarkShippedModal();
                }}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={shipMarkTitleId}
                aria-describedby={shipMarkDescId}
                className="relative z-10 flex max-h-[min(92dvh,40rem)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-2xl sm:max-h-[min(88vh,40rem)] sm:rounded-2xl dark:shadow-black/40"
              >
                <div className="border-b border-[color:var(--app-border)] px-5 py-4">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-500">
                    Mark shipped
                  </p>
                  <h2
                    id={shipMarkTitleId}
                    className="mt-1 text-base font-semibold leading-snug tracking-tight text-slate-900 dark:text-slate-100"
                  >
                    Tracking &amp; invoice numbers
                  </h2>
                  <p
                    id={shipMarkDescId}
                    className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
                  >
                    One tracking number covers the whole shipment. Each
                    delivery note needs its own invoice number.
                  </p>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                  <div>
                    <label
                      htmlFor="ship-tracking-input"
                      className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300"
                    >
                      Tracking number <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="ship-tracking-input"
                      type="text"
                      autoComplete="off"
                      maxLength={80}
                      value={shipTrackingNumber}
                      onChange={(e) => setShipTrackingNumber(e.target.value)}
                      className={`${inputSm} font-mono text-sm`}
                      placeholder="e.g. 7946…"
                    />
                  </div>

                  <div>
                    <p className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                      Invoice numbers ({shipGroupMembers.length})
                    </p>
                    {shipGroupLoading ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Loading shipment notes…
                      </p>
                    ) : shipGroupMembers.length > 0 ? (
                      <ul className="space-y-2">
                        {shipGroupMembers.map((n) => (
                          <li
                            key={n.id}
                            className="rounded-xl border border-slate-200/90 bg-slate-50/80 px-3 py-2.5 dark:border-slate-700/80 dark:bg-slate-900/35"
                          >
                            <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                              <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                                {formatDeliveryNoteNumber(n.dn_number)}
                              </span>
                              {n.id === detail.id ? (
                                <span className="rounded bg-slate-200/90 px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                  This note
                                </span>
                              ) : null}
                            </div>
                            <label
                              htmlFor={`ship-invoice-${n.id}`}
                              className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300"
                            >
                              Invoice number{" "}
                              <span className="text-red-600">*</span>
                            </label>
                            <input
                              id={`ship-invoice-${n.id}`}
                              type="text"
                              autoComplete="off"
                              maxLength={80}
                              value={shipInvoices[n.id] ?? ""}
                              onChange={(e) =>
                                setShipInvoices((prev) => ({
                                  ...prev,
                                  [n.id]: e.target.value,
                                }))
                              }
                              className={`${inputSm} font-mono text-sm`}
                              placeholder="e.g. INV-10234"
                            />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        No other notes in this shipment.
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                      Rate estimate
                    </p>
                    {shipRateQuote ? (
                      <p className="rounded-xl border border-emerald-200/90 bg-emerald-50/80 px-3 py-2.5 text-xs text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-200">
                        {shipRateQuote.carrierName} ·{" "}
                        {shipRateQuote.serviceName} —{" "}
                        <span className="font-semibold tabular-nums">
                          {formatMoney(
                            String(shipRateQuote.totalCharge),
                            shipRateQuote.currency,
                          )}
                        </span>
                        <span className="mt-0.5 block text-[11px] opacity-80">
                          Saved with this shipment.
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        No estimate selected. Choose one with Estimate fee next
                        to the package summary before marking shipped.
                      </p>
                    )}
                  </div>

                  {shipMarkSaveError ? (
                    <p
                      role="alert"
                      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/35 dark:text-red-200"
                    >
                      {shipMarkSaveError}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--app-border)] px-5 py-4">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={closeMarkShippedModal}
                    className={`${btnBase} ${btnGhost} px-4`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmMarkShipped()}
                    className={`${btnBase} ${btnPrimary} px-4`}
                  >
                    {busy ? "Saving…" : "Mark shipped"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <ResponseModal
        open={!!error}
        onClose={() => setError(null)}
        message={error ?? ""}
        variant="error"
      />
    </OperationsShell>
  );
}
