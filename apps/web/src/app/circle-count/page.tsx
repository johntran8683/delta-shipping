"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { OperationsShell } from "@/components/operations-shell";
import { apiBase } from "@/lib/config";
import { getAccessToken } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import { formatDnStatusLabel } from "@/lib/dn-status";
import { formatDeliveryNoteNumber } from "@/lib/format-dn-number";

type CircleRow = {
  part: string;
  description: string | null;
  qty: number | null;
  delivery_note_id: string;
  dn_number: string;
  status: string;
  priority: number | null;
  customer: string;
  processing_by: string | null;
};

type CircleResult = {
  rows: CircleRow[];
  notFound: string[];
};

type PartGroup = {
  part: string;
  description: string | null;
  rows: CircleRow[];
  totalQty: number;
};

function groupRows(rows: CircleRow[]): PartGroup[] {
  const groups: PartGroup[] = [];
  for (const r of rows) {
    let g = groups.length ? groups[groups.length - 1] : null;
    if (!g || g.part !== r.part) {
      g = { part: r.part, description: r.description, rows: [], totalQty: 0 };
      groups.push(g);
    }
    g.rows.push(r);
    if (r.qty != null) g.totalQty += r.qty;
    if (!g.description && r.description) g.description = r.description;
  }
  return groups;
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function ResultsTable({
  groups,
  forPrint,
}: {
  groups: PartGroup[];
  forPrint?: boolean;
}) {
  const thCls =
    "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
  const tdCls = "px-3 py-2 align-top";
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[color:var(--app-border)]">
          <th className={thCls}>Delivery note</th>
          <th className={`${thCls} w-20`}>Priority</th>
          <th className={`${thCls} w-28`}>Status</th>
          <th className={`${thCls} w-20 text-right`}>Qty</th>
          <th className={thCls}>Customer</th>
          <th className={`${thCls} w-44`}>Processing by</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <Fragment key={g.part}>
            <tr className="border-b border-[color:var(--app-border)] bg-slate-50 dark:bg-slate-900/60">
              <td colSpan={3} className="px-3 py-2">
                <span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {g.part}
                </span>
                {g.description ? (
                  <span className="ml-2 text-slate-600 dark:text-slate-300">
                    {g.description}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Total{" "}
                </span>
                <span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatQty(g.totalQty)}
                </span>
              </td>
              <td colSpan={2} className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                on {g.rows.length} delivery note{g.rows.length === 1 ? "" : "s"}
              </td>
            </tr>
            {g.rows.map((r) => (
              <tr
                key={`${g.part}-${r.delivery_note_id}`}
                className="border-b border-slate-100 last:border-0 dark:border-slate-800"
              >
                <td className={`${tdCls} font-mono tabular-nums`}>
                  {forPrint ? (
                    formatDeliveryNoteNumber(r.dn_number)
                  ) : (
                    <Link
                      href={`/delivery-notes/${r.delivery_note_id}`}
                      className="text-[var(--app-brand)] underline-offset-2 hover:underline"
                    >
                      {formatDeliveryNoteNumber(r.dn_number)}
                    </Link>
                  )}
                </td>
                <td className={`${tdCls} tabular-nums`}>
                  {r.priority ?? "—"}
                </td>
                <td className={tdCls}>{formatDnStatusLabel(r.status)}</td>
                <td className={`${tdCls} text-right font-mono tabular-nums`}>
                  {r.qty != null ? formatQty(r.qty) : "—"}
                </td>
                <td className={tdCls}>{r.customer}</td>
                <td className={tdCls}>{r.processing_by ?? "—"}</td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export default function CircleCountPage() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CircleResult | null>(null);
  const [searchedParts, setSearchedParts] = useState<string[]>([]);
  const [searchedAt, setSearchedAt] = useState<Date | null>(null);

  const groups = useMemo(
    () => (result ? groupRows(result.rows) : []),
    [result],
  );

  async function runSearch() {
    const parts = input
      .split(/[\s,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      setError("Enter at least one part number.");
      return;
    }
    const token = getAccessToken();
    if (!token) {
      setError("You are not signed in.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/delivery-notes/circle-count`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ partNumbers: parts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatApiErrorPayload(data) || "Search failed.");
        setResult(null);
        return;
      }
      setResult({
        rows: Array.isArray(data.rows) ? data.rows : [],
        notFound: Array.isArray(data.notFound) ? data.notFound : [],
      });
      setSearchedParts(parts);
      setSearchedAt(new Date());
    } catch {
      setError("Could not reach the server. Please try again.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <OperationsShell
      title="Circle Count"
      subtitle="Find where parts are right now — which delivery notes they are on (Picked, Packing, Packed, or Shipping), and who is processing them."
      contentDensity="compact"
    >
      <div className="print:hidden">
        <section className="rounded-xl border border-[color:var(--app-border)] bg-white px-4 py-4 shadow-sm dark:bg-slate-950 sm:px-5">
          <label
            htmlFor="cc-input"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            Part numbers
          </label>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Type or paste part numbers, separated by commas, spaces, or one per
            line — for example: 333226, 328546, 275401
          </p>
          <textarea
            id="cc-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
            spellCheck={false}
            className="mt-2.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-[var(--app-brand)] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            placeholder="333226, 328546, 275401"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={busy}
              className="inline-flex items-center rounded-lg bg-[var(--app-brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Searching…" : "Search"}
            </button>
            {result ? (
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Print results
              </button>
            ) : null}
          </div>
          {error ? (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}
        </section>

        {result ? (
          <section className="mt-3 rounded-xl border border-[color:var(--app-border)] bg-white px-4 py-4 shadow-sm dark:bg-slate-950 sm:px-5">
            {result.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <ResultsTable groups={groups} />
              </div>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                None of the searched parts are on a delivery note in Picked,
                Packing, Packed, or Shipping.
              </p>
            )}
            {result.notFound.length > 0 ? (
              <div className="mt-4 border-t border-[color:var(--app-border)] pt-3">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Not found
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Not on any delivery note in Picked, Packing, Packed, or
                  Shipping:
                </p>
                <ul className="mt-2 flex list-none flex-wrap gap-1.5 p-0" role="list">
                  {result.notFound.map((p) => (
                    <li
                      key={p}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs tabular-nums text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      {result ? (
        <div className="hidden print:block">
          <p className="text-sm text-slate-600">
            Searched parts: {searchedParts.join(", ")}
            {searchedAt
              ? ` · ${searchedAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : null}
          </p>
          {result.rows.length > 0 ? (
            <ResultsTable groups={groups} forPrint />
          ) : (
            <p className="mt-3 text-sm">
              None of the searched parts are on a delivery note in Picked,
              Packing, Packed, or Shipping.
            </p>
          )}
          {result.notFound.length > 0 ? (
            <p className="mt-4 text-sm">
              <span className="font-semibold">Not found:</span>{" "}
              {result.notFound.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </OperationsShell>
  );
}
