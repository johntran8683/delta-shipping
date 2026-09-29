"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { DeliveryNoteNumber } from "@/components/delivery-note-number";
import { formatDeliveryNoteNumber } from "@/lib/format-dn-number";
import { formatDnStatusLabel } from "@/lib/dn-status";

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
  shipped_qty: string | null;
};

type PackBox = {
  id: string;
  sort_order: number;
  box_number: string | null;
  weight_lb: string;
  length_in: string;
  width_in: string;
  height_in: string;
};

type PackSessionDn = {
  id: string;
  dn_number: string;
  current_status?: string;
};

type CompletedPackSession = {
  pack_completion_note?: string | null;
  delivery_notes?: PackSessionDn[];
  boxes: PackBox[];
};

export type WorkflowActor = {
  id: string;
  email: string;
  display_name: string | null;
};

export type WorkflowHandoff = {
  picked_by: WorkflowActor | null;
  packed_by: WorkflowActor | null;
  shipped_by: WorkflowActor | null;
};

export type LatestShipment = {
  tracking_number: string | null;
  invoice_number?: string | null;
  ship_date: string;
  carrier_code: string;
  shipped_by?: WorkflowActor | null;
};

export type CarrierAccountRow = {
  carrier_code: string;
  account_number: string;
};

export type ShipperDnDetail = {
  sold_to_code: string;
  sold_to_name: string;
  ship_to_code: string;
  ship_to_name: string;
  ship_to_region_state: string | null;
  ship_to_location?: ShipToLocationDetail | null;
  shipping_type: string | null;
  customer_email?: string | null;
  fed_id_number?: string | null;
  matched_carrier_accounts?: CarrierAccountRow[];
  lines: LineRow[];
  completed_pack_sessions?: CompletedPackSession[];
};

export type ShipperDnDetailWorkspaceProps = {
  detail: ShipperDnDetail;
  currentDnId: string;
  currentStatus: string;
  latestShipment?: LatestShipment | null;
  workflowHandoff?: WorkflowHandoff | null;
};

export function formatWorkflowActorLabel(actor: WorkflowActor | null | undefined): string {
  if (!actor) return "—";
  const name = actor.display_name?.trim();
  if (name) return name;
  return actor.email?.trim() || "—";
}

function formatCarrierLabel(code: string): string {
  const c = code.trim();
  if (!c) return "Carrier";
  if (/^fedex$/i.test(c)) return "FedEx";
  if (/^ups$/i.test(c)) return "UPS";
  return c;
}

function inferredCarrierFromShipMethod(shippingType: string): string {
  const n = shippingType.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (n.includes("FEDEX")) return "FedEx";
  if (n.includes("UPS")) return "UPS";
  if (n.includes("USPS")) return "USPS";
  if (n.includes("DHL")) return "DHL";
  return shippingType.trim();
}

function carrierAccountsMessage(
  shippingType: string | null | undefined,
  accounts: CarrierAccountRow[],
): string {
  const ship = shippingType?.trim();
  if (!ship) return "No ship method on this delivery note.";
  if (accounts.length > 0) return "";
  return `No ${inferredCarrierFromShipMethod(ship)} account on file for this customer.`;
}

function sumBoxWeightsLb(boxes: Pick<PackBox, "weight_lb">[]): string | null {
  if (boxes.length === 0) return null;
  let sum = 0;
  let anyValid = false;
  for (const b of boxes) {
    const n = Number.parseFloat(b.weight_lb.trim());
    if (!Number.isFinite(n)) continue;
    sum += n;
    anyValid = true;
  }
  if (!anyValid) return null;
  const rounded = Math.round(sum * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "");
}

function countryDisplay(loc: ShipToLocationDetail): string {
  const name = loc.country_name?.trim();
  const code = loc.country_code?.trim();
  if (name && code) return `${name} (${code})`;
  return name || code || "";
}

function buildFullAddressLines(
  loc: ShipToLocationDetail | null | undefined,
  shipToName: string,
  regionFallback: string | null,
): string[] {
  if (!loc) {
    const lines = [shipToName.trim()].filter(Boolean);
    if (regionFallback?.trim()) lines.push(regionFallback.trim());
    return lines.length > 0 ? lines : ["—"];
  }
  const lines: string[] = [];
  const name = loc.ship_to_name?.trim() || shipToName.trim();
  if (name) lines.push(name);
  if (loc.street2?.trim()) lines.push(loc.street2.trim());
  if (loc.street1?.trim()) lines.push(loc.street1.trim());
  const cityLine = [loc.city, loc.state_region ?? regionFallback, loc.postal_code]
    .map((x) => x?.trim())
    .filter(Boolean)
    .join(", ");
  if (cityLine) lines.push(cityLine);
  const country = countryDisplay(loc);
  if (country) lines.push(country);
  return lines.length > 0 ? lines : ["—"];
}

function buildFullAddressText(
  loc: ShipToLocationDetail | null | undefined,
  shipToName: string,
  regionFallback: string | null,
): string {
  return buildFullAddressLines(loc, shipToName, regionFallback).join("\n");
}

function buildCarrierAccountsCopyText(accounts: CarrierAccountRow[]): string {
  return accounts
    .map((a) => `${formatCarrierLabel(a.carrier_code)}: ${a.account_number}`)
    .join("\n");
}

function buildPackShipmentCopyText(
  boxCount: number,
  totalWeightLb: string | null,
): string {
  if (boxCount <= 0) return "";
  const parts = [`${boxCount} box${boxCount === 1 ? "" : "es"}`];
  if (totalWeightLb != null) parts.push(`${totalWeightLb} lb total`);
  return parts.join(", ");
}

function EmptyValue() {
  return <span className="text-slate-400 dark:text-slate-500">—</span>;
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <rect x="5" y="5" width="8" height="8" rx="1" />
      <path d="M3 11V3.5A.5.5 0 0 1 3.5 3H11" strokeLinecap="round" />
    </svg>
  );
}

function CopyValueButton({ value, label }: { value: string; label: string }) {
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
      title={copied ? "Copied" : `Copy ${label}`}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-100"
    >
      {copied ? (
        <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 8.5l3 3 7-7"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
    </button>
  );
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
        children ?? `Copy ${label}`
      )}
    </button>
  );
}

function CopyableMono({ value, label }: { value: string; label: string }) {
  const trimmed = value.trim();
  if (!trimmed) return <EmptyValue />;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-50">
        {trimmed}
      </span>
      <CopyValueButton value={trimmed} label={label} />
    </span>
  );
}

function ShipperField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-x-4 sm:items-start">
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="min-w-0 text-sm leading-relaxed text-slate-900 dark:text-slate-100">
        {children}
      </dd>
    </div>
  );
}

function Panel({
  title,
  meta,
  children,
  className,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-slate-200/90 bg-slate-50/50 dark:border-slate-700/60 dark:bg-slate-900/30 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-b border-slate-200/80 px-3.5 py-2 dark:border-slate-700/70">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          {title}
        </h3>
        {meta ? (
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{meta}</span>
        ) : null}
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}

function ShipmentInfoPanel({
  notes,
  currentDnId,
  packNote,
  boxes,
  totalWeightLb,
  shipMethod,
  carrierAccounts,
  carrierMsg,
  carrierCopyText,
  latestShipment,
  currentStatus,
}: {
  notes: PackSessionDn[];
  currentDnId: string;
  packNote?: string;
  boxes: PackBox[];
  totalWeightLb: string | null;
  shipMethod: string;
  carrierAccounts: CarrierAccountRow[];
  carrierMsg: string;
  carrierCopyText: string;
  latestShipment?: LatestShipment | null;
  currentStatus: string;
}) {
  const tracking = latestShipment?.tracking_number?.trim() ?? "";
  const invoiceNumber = latestShipment?.invoice_number?.trim() ?? "";
  const isShipped = currentStatus.trim().toUpperCase() === "SHIPPED";
  const multi = notes.length > 1;
  const allPacked = notes.every(
    (n) => (n.current_status ?? "").trim().toUpperCase() === "PACKED",
  );
  const packCopyText = buildPackShipmentCopyText(boxes.length, totalWeightLb);

  return (
    <section
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950/50"
      aria-label="Shipment information"
    >
      <header className="border-b border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50 sm:px-5">
        <h2 className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100">
          Shipment
        </h2>
      </header>
      <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Tracking number
            </dt>
            <dd>
              {tracking ? (
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono text-lg font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                    {tracking}
                  </span>
                  <CopyValueButton value={tracking} label="tracking number" />
                </span>
              ) : (
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {isShipped ? "—" : "Enter when marking shipped"}
                </span>
              )}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Invoice number
            </dt>
            <dd>
              {invoiceNumber ? (
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono text-lg font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                    {invoiceNumber}
                  </span>
                  <CopyValueButton value={invoiceNumber} label="invoice number" />
                </span>
              ) : (
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {isShipped ? "—" : "Enter when marking shipped"}
                </span>
              )}
            </dd>
          </div>
          <div className="space-y-4">
            <div className="space-y-1">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Ship method
              </dt>
              <dd>
                {shipMethod ? (
                  <span className="inline-block rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-sm font-semibold text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-100">
                    {shipMethod}
                  </span>
                ) : (
                  <EmptyValue />
                )}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Carrier account
              </dt>
              <dd>
                {carrierCopyText ? (
                  <div className="mb-2">
                    <CopyTextButton value={carrierCopyText} label="carrier accounts" />
                  </div>
                ) : null}
                {carrierAccounts.length > 0 ? (
                  <ul className="list-none space-y-2 p-0">
                    {carrierAccounts.map((a, i) => (
                      <li
                        key={`${a.carrier_code}-${a.account_number}-${i}`}
                        className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900/40"
                      >
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {formatCarrierLabel(a.carrier_code)}
                        </span>
                        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                          {a.account_number}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm leading-snug text-slate-600 dark:text-slate-400">
                    {carrierMsg || "—"}
                  </p>
                )}
              </dd>
            </div>
          </div>
          {latestShipment?.ship_date ? (
            <div className="space-y-1">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Ship date
              </dt>
              <dd className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {latestShipment.ship_date}
                {latestShipment.carrier_code
                  ? ` · ${formatCarrierLabel(latestShipment.carrier_code)}`
                  : ""}
              </dd>
            </div>
          ) : null}
          {packCopyText ? (
            <div className="space-y-1 sm:col-span-2">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Packages
              </dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {packCopyText}
                </span>
                <CopyTextButton value={packCopyText} label="package summary" />
              </dd>
            </div>
          ) : null}
        </dl>

        {notes.length > 0 ? (
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {multi ? "Combined delivery notes" : "Delivery note"}
            </p>
            {multi ? (
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                These notes share one pack session — start shipping and mark shipped together.
              </p>
            ) : null}
            <ul className="mt-2 flex flex-wrap gap-2">
              {notes.map((n) => {
                const isHere = n.id === currentDnId;
                const status = (n.current_status ?? "").trim().toUpperCase();
                return (
                  <li key={n.id}>
                    {isHere ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-[11px] dark:border-slate-600 dark:bg-slate-800/80">
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-50">
                          {formatDeliveryNoteNumber(n.dn_number)}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">(this)</span>
                        {status ? (
                          <span className="rounded bg-white px-1 py-0.5 text-[10px] font-medium uppercase text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                            {formatDnStatusLabel(status)}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <Link
                        href={`/delivery-notes/${n.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900/40 dark:hover:bg-slate-900"
                      >
                        <span className="font-mono font-medium text-slate-800 dark:text-slate-100">
                          {formatDeliveryNoteNumber(n.dn_number)}
                        </span>
                        {status ? (
                          <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {formatDnStatusLabel(status)}
                          </span>
                        ) : null}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            {multi && !allPacked ? (
              <p className="mt-2 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                Not all notes in this group are packed yet.
              </p>
            ) : null}
          </div>
        ) : null}

        {packNote ? (
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Packer note:</span>{" "}
            {packNote}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function HandoffPeoplePanel({ handoff }: { handoff: WorkflowHandoff }) {
  const rows: { label: string; actor: WorkflowActor | null }[] = [
    { label: "Picked by", actor: handoff.picked_by },
    { label: "Packed by", actor: handoff.packed_by },
    { label: "Shipped by", actor: handoff.shipped_by },
  ];

  return (
    <section
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950/50"
      aria-label="Handoff"
    >
      <header className="border-b border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50 sm:px-5">
        <h2 className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100">
          Handoff
        </h2>
      </header>
      <dl className="grid gap-0 sm:grid-cols-3">
        {rows.map(({ label, actor }, i) => (
          <div
            key={label}
            className={`px-4 py-3.5 sm:px-5 ${i > 0 ? "border-t border-slate-100 dark:border-slate-800 sm:border-t-0 sm:border-l" : ""}`}
          >
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
              {formatWorkflowActorLabel(actor)}
            </dd>
            {actor?.email && actor.display_name?.trim() ? (
              <dd className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {actor.email}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
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

export function ShipperDnDetailWorkspace({
  detail,
  currentDnId,
  currentStatus,
  latestShipment,
  workflowHandoff,
}: ShipperDnDetailWorkspaceProps) {
  const packSession = detail.completed_pack_sessions?.[0];
  const boxes = packSession?.boxes ?? [];
  const totalWeightLb = sumBoxWeightsLb(boxes);
  const packNote = packSession?.pack_completion_note?.trim();
  const shipmentNotes = packSession?.delivery_notes ?? [];
  const loc = detail.ship_to_location;
  const postalCode = loc?.postal_code?.trim() ?? "";
  const addressLines = buildFullAddressLines(
    loc,
    detail.ship_to_name,
    detail.ship_to_region_state,
  );
  const addressText = buildFullAddressText(loc, detail.ship_to_name, detail.ship_to_region_state);
  const lineCount = detail.lines.length;
  const shipMethod = detail.shipping_type?.trim() ?? "";
  const carrierAccounts = detail.matched_carrier_accounts ?? [];
  const carrierMsg = carrierAccountsMessage(detail.shipping_type, carrierAccounts);
  const carrierCopyText = buildCarrierAccountsCopyText(carrierAccounts);
  const packCopyText = buildPackShipmentCopyText(boxes.length, totalWeightLb);
  const packSummary =
    boxes.length > 0
      ? `${boxes.length} box${boxes.length === 1 ? "" : "es"}${totalWeightLb != null ? ` · ${totalWeightLb} lb total` : ""}`
      : undefined;

  return (
    <div className="print:hidden space-y-5">
      <ShipmentInfoPanel
        notes={shipmentNotes}
        currentDnId={currentDnId}
        packNote={packNote}
        boxes={boxes}
        totalWeightLb={totalWeightLb}
        shipMethod={shipMethod}
        carrierAccounts={carrierAccounts}
        carrierMsg={carrierMsg}
        carrierCopyText={carrierCopyText}
        latestShipment={latestShipment}
        currentStatus={currentStatus}
      />

      {workflowHandoff ? <HandoffPeoplePanel handoff={workflowHandoff} /> : null}

      <SectionCard id="shipper-section-pack" title="Pack & products" summary={packSummary}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
          <Panel
            title="Boxes"
            meta={boxes.length > 0 ? String(boxes.length) : undefined}
            className="lg:col-span-1"
          >
            {packCopyText ? (
              <div className="mb-3">
                <CopyTextButton value={packCopyText} label="box summary" />
              </div>
            ) : null}
            {boxes.length > 0 ? (
              <ul className="list-none space-y-2 p-0" aria-label="Recorded boxes">
                {boxes.map((b) => {
                  const bn = b.box_number?.trim();
                  const label = bn ? bn : String(b.sort_order + 1);
                  return (
                    <li
                      key={b.id}
                      className="rounded-md border border-slate-200/90 bg-white px-3 py-2.5 dark:border-slate-700/80 dark:bg-slate-950/60"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Box {label}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="inline-flex items-baseline gap-1 rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800/80">
                          <span className="text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400">
                            Wt
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                            {b.weight_lb}
                          </span>
                          <span className="text-xs text-slate-500">lb</span>
                        </span>
                        <span className="inline-flex items-baseline gap-1 rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800/80">
                          <span className="text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400">
                            L×W×H
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                            {b.length_in}×{b.width_in}×{b.height_in}
                          </span>
                          <span className="text-xs text-slate-500">in</span>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No boxes recorded.</p>
            )}
            {boxes.length > 0 && totalWeightLb != null ? (
              <div className="mt-3 flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950/60">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Total weight
                </span>
                <span className="font-mono text-base font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                  {totalWeightLb}
                  <span className="ml-1 text-sm font-medium text-slate-500">lb</span>
                </span>
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Products"
            meta={lineCount > 0 ? `${lineCount} line${lineCount === 1 ? "" : "s"}` : undefined}
            className="lg:col-span-2"
          >
            <div className="overflow-x-auto rounded-md border border-slate-200/90 bg-white dark:border-slate-700/80 dark:bg-slate-950/40">
              <table className="w-full min-w-[280px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100/90 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
                    <th className="w-10 px-3 py-2.5 font-medium">#</th>
                    <th className="px-3 py-2.5 font-medium">Material</th>
                    <th className="w-20 px-3 py-2.5 text-right font-medium">Shipped</th>
                  </tr>
                </thead>
                <tbody>
                  {lineCount === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-sm text-slate-500">
                        No line items.
                      </td>
                    </tr>
                  ) : (
                    detail.lines.map((l, i) => (
                      <tr
                        key={l.id}
                        className={
                          i % 2 === 0
                            ? "border-b border-slate-100 bg-white dark:border-slate-800/80 dark:bg-transparent"
                            : "border-b border-slate-100 bg-slate-50/60 dark:border-slate-800/80 dark:bg-slate-900/20"
                        }
                      >
                        <td className="px-3 py-2.5 align-top font-mono text-sm tabular-nums text-slate-500 dark:text-slate-400">
                          {l.doc_item}
                        </td>
                        <td className="max-w-md px-3 py-2.5 align-top">
                          <span className="font-mono text-xs font-medium text-slate-500 dark:text-slate-400">
                            {l.material_code ?? "—"}
                          </span>
                          {l.material_description ? (
                            <p className="mt-0.5 text-sm leading-snug text-slate-900 dark:text-slate-100">
                              {l.material_description}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 align-top text-right font-mono text-sm tabular-nums text-slate-700 dark:text-slate-300">
                          {l.shipped_qty ?? "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </SectionCard>

      <SectionCard
        id="shipper-section-customer"
        title="Customer & ship-to"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
          <Panel title="Customer">
            <dl className="space-y-3.5">
              <ShipperField label="Code">
                <span className="font-mono text-[15px] font-semibold tracking-tight">
                  {detail.sold_to_code}
                </span>
              </ShipperField>
              <ShipperField label="Name">
                <span className="text-[15px] font-medium leading-snug">{detail.sold_to_name}</span>
              </ShipperField>
              <ShipperField label="Email">
                {detail.customer_email?.trim() ? (
                  <a
                    href={`mailto:${detail.customer_email.trim()}`}
                    className="text-[15px] text-slate-800 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500 dark:text-slate-100"
                  >
                    {detail.customer_email.trim()}
                  </a>
                ) : (
                  <EmptyValue />
                )}
              </ShipperField>
              <ShipperField label="FED ID#">
                {detail.fed_id_number?.trim() ? (
                  <span className="font-mono text-[15px] font-semibold tracking-tight">
                    {detail.fed_id_number.trim()}
                  </span>
                ) : (
                  <EmptyValue />
                )}
              </ShipperField>
            </dl>
          </Panel>

          <div className="space-y-4">
            <Panel title="Ship-to">
              {addressText && addressText !== "—" ? (
                <div className="mb-3">
                  <CopyTextButton value={addressText} label="full address" />
                </div>
              ) : null}
              <dl className="space-y-3.5">
                <ShipperField label="Code">
                  <CopyableMono value={detail.ship_to_code} label="ship-to code" />
                </ShipperField>
                <ShipperField label="Address">
                  <address className="not-italic text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                    {addressLines.map((line, i) => (
                      <span
                        key={i}
                        className={
                          i === 0
                            ? "block text-[15px] font-semibold text-slate-900 dark:text-slate-50"
                            : "block"
                        }
                      >
                        {line}
                      </span>
                    ))}
                  </address>
                </ShipperField>
                <ShipperField label="Postal / ZIP">
                  <CopyableMono value={postalCode} label="postal code" />
                </ShipperField>
              </dl>
            </Panel>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
