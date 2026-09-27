"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { ResponseModal } from "@/components/response-modal";
import {
  clearSession,
  getAccessToken,
  getActiveRoleCode,
} from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import { apiBase } from "@/lib/config";
import { canUseDataImport } from "@/lib/import-access";

type ReportBatch = {
  id: string;
  file_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  summary_message: string | null;
  total_rows: number;
  success_rows: number;
  error_rows: number;
};

type RowFailure = {
  id: string;
  sheet_name: string | null;
  row_number: number | null;
  error_code: string;
  severity: string;
  error_message: string;
};

type ReportResponse = {
  batch: ReportBatch;
  newDeliveryNotesCount: number;
  existingDeliveryNotesCount: number;
  existingDeliveryNotes: string[];
  existingDeliveryNotesTruncated?: boolean;
  rowFailureCount: number;
  rowFailures: RowFailure[];
  rowFailuresTruncated?: boolean;
  linkedDeliveryNotesCount: number;
};

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function batchStatusClass(status: string) {
  if (status === "SUCCESS")
    return "border-emerald-200/90 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (status === "PARTIAL")
    return "border-amber-200/90 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-200";
  if (status === "RUNNING")
    return "border-sky-200/90 bg-sky-50 text-sky-900 dark:border-sky-800/60 dark:bg-sky-950/35 dark:text-sky-200";
  if (status === "FAILED")
    return "border-red-200/90 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300";
  return "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
}

function severityClass(severity: string) {
  if (severity === "BLOCKER")
    return "text-red-800 dark:text-red-300";
  if (severity === "WARNING")
    return "text-amber-800 dark:text-amber-300";
  return "text-slate-600 dark:text-slate-400";
}

function shortId(id: string) {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function CollapsibleSection({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-slate-100 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-900/40"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {count.toLocaleString()}
          <span
            className={`inline-block text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            ›
          </span>
        </span>
      </button>
      {open ? <div className="border-t border-slate-100 dark:border-slate-800">{children}</div> : null}
    </section>
  );
}

export default function ImportReportPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dnFilter, setDnFilter] = useState("");
  const [errorFilter, setErrorFilter] = useState("");
  const [reverting, setReverting] = useState(false);
  const [permHint, setPermHint] = useState<string | null>(() =>
    canUseDataImport(getActiveRoleCode())
      ? null
      : "Import reports require active role SUPERVISOR or SYSTEM.",
  );

  const loadReport = useCallback(async () => {
    if (!id || permHint) return;
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/import/batches/${id}/report`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        setError(formatApiErrorPayload(body));
        return;
      }
      setData(body as ReportResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [id, permHint, router]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const filteredExisting = useMemo(() => {
    if (!data) return [];
    const q = dnFilter.trim().toLowerCase();
    if (!q) return data.existingDeliveryNotes;
    return data.existingDeliveryNotes.filter((dn) =>
      dn.toLowerCase().includes(q),
    );
  }, [data, dnFilter]);

  const filteredFailures = useMemo(() => {
    if (!data) return [];
    const q = errorFilter.trim().toLowerCase();
    if (!q) return data.rowFailures;
    return data.rowFailures.filter(
      (r) =>
        r.error_code.toLowerCase().includes(q) ||
        r.error_message.toLowerCase().includes(q) ||
        (r.sheet_name ?? "").toLowerCase().includes(q) ||
        String(r.row_number ?? "").includes(q),
    );
  }, [data, errorFilter]);

  async function undoImport() {
    if (!data || data.batch.status === "RUNNING") return;
    const n = data.linkedDeliveryNotesCount;
    const ok = window.confirm(
      `Undo import "${data.batch.file_name}"?\n\n` +
        `This permanently deletes this import batch and removes ${n} delivery note(s) whose last update came from this import.\n\n` +
        `This cannot be undone.`,
    );
    if (!ok) return;

    const token = getAccessToken();
    if (!token) return;
    setReverting(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/import/batches/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (body.requiresConfirmation) {
        const changedList = (body.changedNotes ?? [])
          .map((n: { dn_number: string; current_status: string }) => `  • ${n.dn_number} (${n.current_status})`)
          .join("\n");
        const confirmed = window.confirm(
          `Warning: ${body.changedNotes?.length ?? 0} note(s) have changed since this import:\n\n${changedList}\n\n${body.createdCount} note(s) were created by this import and will be deleted.\n${body.updatedCount} existing note(s) were refreshed.\n\nClick OK to revert anyway, or Cancel to stop.`,
        );
        if (confirmed) {
          const res2 = await fetch(`${apiBase}/import/batches/${id}?force=true`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          });
          const body2 = await res2.json().catch(() => ({}));
          if (!res2.ok) {
            setError(formatApiErrorPayload(body2));
            return;
          }
        } else {
          return;
        }
      } else if (!res.ok) {
        setError(formatApiErrorPayload(body));
        return;
      }
      router.replace("/import/revert");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setReverting(false);
    }
  }

  const canUndo =
    data &&
    data.batch.status !== "RUNNING" &&
    !permHint &&
    !reverting;

  return (
    <OperationsShell
      title="Import report"
      subtitle="Batch outcome for supervisors — summary, row issues, and updated delivery notes."
    >
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/delivery-notes"
            className="text-sm text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            ← Delivery notes
          </Link>
          {data && !permHint ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canUndo}
                onClick={() => void undoImport()}
                className="rounded-lg border border-red-200/90 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-40 dark:border-red-900/50 dark:bg-slate-950 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                {reverting ? "Undoing…" : "Undo import"}
              </button>
              <Link
                href="/import"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                New import
              </Link>
            </div>
          ) : null}
        </div>

        {permHint ? (
          <p
            className="rounded-lg border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/45 dark:bg-amber-950/35 dark:text-amber-100"
            role="status"
          >
            {permHint}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : null}

        {data ? (
          <article className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
            <header className="border-b border-slate-100 px-4 py-4 dark:border-slate-800 md:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {data.batch.file_name}
                  </h2>
                  <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2">
                    <div>
                      <dt className="inline font-medium text-slate-600 dark:text-slate-300">
                        Started{" "}
                      </dt>
                      <dd className="inline">
                        {formatWhen(data.batch.started_at)}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-slate-600 dark:text-slate-300">
                        Finished{" "}
                      </dt>
                      <dd className="inline">
                        {formatWhen(data.batch.completed_at)}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline font-medium text-slate-600 dark:text-slate-300">
                        Batch{" "}
                      </dt>
                      <dd className="inline font-mono">{shortId(data.batch.id)}</dd>
                    </div>
                  </dl>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${batchStatusClass(data.batch.status)}`}
                >
                  {data.batch.status}
                </span>
              </div>
              {data.batch.status === "RUNNING" ? (
                <p className="mt-3 text-sm text-sky-800 dark:text-sky-200/90">
                  Import still running — refresh this page for final counts.
                </p>
              ) : null}
              {data.batch.summary_message ? (
                <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {data.batch.summary_message}
                </p>
              ) : null}
            </header>

            <div className="overflow-x-auto border-b border-slate-100 dark:border-slate-800">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                    <th className="px-4 py-2.5 md:px-5">Metric</th>
                    <th className="px-4 py-2.5 text-right tabular-nums md:px-5">
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {[
                    ["Rows in file", data.batch.total_rows],
                    ["Successful rows", data.batch.success_rows],
                    ["Row issues", data.batch.error_rows],
                    ["New delivery notes", data.newDeliveryNotesCount],
                    ["Updated (unchanged) DNs", data.existingDeliveryNotesCount],
                    ["DNs linked to batch", data.linkedDeliveryNotesCount],
                  ].map(([label, value]) => (
                    <tr key={String(label)}>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-300 md:px-5">
                        {label}
                      </td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100 md:px-5">
                        {Number(value).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.rowFailureCount > 0 ? (
              <CollapsibleSection
                title="Row issues"
                count={data.rowFailureCount}
                defaultOpen
              >
                {data.rowFailures.length > 8 ? (
                  <div className="border-b border-slate-100 px-4 py-2 dark:border-slate-800">
                    <label htmlFor="error-filter" className="sr-only">
                      Filter row issues
                    </label>
                    <input
                      id="error-filter"
                      type="search"
                      value={errorFilter}
                      onChange={(e) => setErrorFilter(e.target.value)}
                      placeholder="Filter by sheet, row, code, message…"
                      className="w-full rounded-md border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-sky-500/30 dark:bg-slate-900 dark:ring-slate-700"
                    />
                  </div>
                ) : null}
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2 md:px-5">Sheet</th>
                        <th className="px-2 py-2 text-right">Row</th>
                        <th className="px-2 py-2">Severity</th>
                        <th className="px-2 py-2">Code</th>
                        <th className="px-4 py-2 md:px-5">Message</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800/80">
                      {filteredFailures.map((r) => (
                        <tr key={r.id} className="text-slate-800 dark:text-slate-200">
                          <td className="whitespace-nowrap px-4 py-1.5 md:px-5">
                            {r.sheet_name ?? "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                            {r.row_number ?? "—"}
                          </td>
                          <td
                            className={`whitespace-nowrap px-2 py-1.5 font-medium ${severityClass(r.severity)}`}
                          >
                            {r.severity}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-slate-500">
                            {r.error_code}
                          </td>
                          <td className="max-w-md px-4 py-1.5 md:px-5">
                            {r.error_message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filteredFailures.length === 0 && errorFilter.trim() ? (
                  <p className="px-4 py-4 text-center text-sm text-slate-500">
                    No issues match your filter.
                  </p>
                ) : null}
                {data.rowFailuresTruncated ? (
                  <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
                    Showing first {data.rowFailures.length.toLocaleString()} of{" "}
                    {data.rowFailureCount.toLocaleString()} issues.
                  </p>
                ) : null}
              </CollapsibleSection>
            ) : null}

            {data.existingDeliveryNotesCount > 0 ? (
              <CollapsibleSection
                title="Updated delivery notes (already on file)"
                count={data.existingDeliveryNotesCount}
                defaultOpen={false}
              >
                <div className="border-b border-slate-100 px-4 py-2 dark:border-slate-800">
                  <label htmlFor="dn-filter" className="sr-only">
                    Find delivery note
                  </label>
                  <input
                    id="dn-filter"
                    type="search"
                    value={dnFilter}
                    onChange={(e) => setDnFilter(e.target.value)}
                    placeholder="Search by DN number…"
                    className="w-full rounded-md border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-sky-500/30 dark:bg-slate-900 dark:ring-slate-700"
                  />
                </div>
                <div className="max-h-[min(28rem,55vh)] overflow-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 dark:border-slate-800 dark:bg-slate-900/95">
                      <tr>
                        <th className="px-4 py-2 font-semibold uppercase tracking-wide text-slate-500 md:px-5">
                          DN number
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800/80">
                      {filteredExisting.map((dn) => (
                        <tr key={dn}>
                          <td className="px-4 py-1.5 font-mono text-[13px] md:px-5">
                            {dn}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filteredExisting.length === 0 && dnFilter.trim() ? (
                  <p className="px-4 py-4 text-center text-sm text-slate-500">
                    No delivery notes match “{dnFilter.trim()}”.
                  </p>
                ) : null}
                {data.existingDeliveryNotesTruncated ? (
                  <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
                    List capped at {data.existingDeliveryNotes.length.toLocaleString()}{" "}
                    of {data.existingDeliveryNotesCount.toLocaleString()}. Use
                    delivery notes filtered by this import for the full set.
                  </p>
                ) : null}
                <p className="border-t border-slate-100 px-4 py-2 text-xs dark:border-slate-800">
                  <Link
                    href={`/delivery-notes?importBatch=${id}`}
                    className="font-medium text-sky-700 underline decoration-sky-300/80 underline-offset-2 hover:text-sky-900 dark:text-sky-400"
                  >
                    Open delivery notes from this import
                  </Link>
                </p>
              </CollapsibleSection>
            ) : (
              <p className="border-t border-slate-100 px-4 py-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
                All delivery notes in this file were newly created.
              </p>
            )}
          </article>
        ) : null}
      </div>

      <ResponseModal
        open={!!error}
        onClose={() => setError(null)}
        message={error ?? ""}
        variant="error"
      />
    </OperationsShell>
  );
}
