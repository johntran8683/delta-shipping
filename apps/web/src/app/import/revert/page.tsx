"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { OperationsShell } from "@/components/operations-shell";
import { ResponseModal } from "@/components/response-modal";
import { clearSession, getAccessToken } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import { apiBase } from "@/lib/config";
import { canSeeImportNav, canUseDataImport } from "@/lib/import-access";

type ImportBatchRow = {
  id: string;
  file_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  total_rows: number;
  success_rows: number;
  error_rows: number;
  summary_message: string | null;
  source_type: string;
  _count: { delivery_notes: number };
};

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusStyles(status: string) {
  if (status === "SUCCESS")
    return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (status === "RUNNING")
    return "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-200";
  if (status === "FAILED")
    return "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300";
  return "border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
}

export default function RevertImportPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<ImportBatchRow[]>([]);
  const [canUndoDailyDn, setCanUndoDailyDn] = useState(false);
  const [permHint, setPermHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/import/batches?limit=100`, {
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
          formatApiErrorPayload(data) +
            (res.status ? ` (HTTP ${res.status})` : ""),
        );
        setBatches([]);
        return;
      }
      setBatches(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setBatches([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    void fetch(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(
        (d: {
          permissions?: string[];
          activeRoleCode?: string | null;
        }) => {
          const role = d.activeRoleCode ?? "";
          const codes = d.permissions ?? [];
          if (!canSeeImportNav(role)) {
            setPermHint(
              "Import history requires active role CSA, SUPERVISOR, or SYSTEM.",
            );
            setCanUndoDailyDn(false);
          } else {
            setPermHint(null);
            setCanUndoDailyDn(
              canUseDataImport(role) && codes.includes("import.daily_dn"),
            );
          }
        },
      )
      .catch(() => undefined);
    void loadBatches();
  }, [router, loadBatches]);

  async function revertBatch(row: ImportBatchRow) {
    if (row.status === "RUNNING") return;
    const n = row._count.delivery_notes;
    const ok = window.confirm(
      `Undo import "${row.file_name}"?\n\n` +
        `This permanently deletes this import batch and removes ${n} delivery note(s) whose last update came from this import (lines and history cascade).\n\n` +
        `This cannot be undone.`,
    );
    if (!ok) return;

    const token = getAccessToken();
    if (!token) return;

    setRevertingId(row.id);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/import/batches/${row.id}`, {
        method: "DELETE",
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
          formatApiErrorPayload(data) +
            (res.status ? ` (HTTP ${res.status})` : ""),
        );
        return;
      }
      await loadBatches();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setRevertingId(null);
    }
  }

  return (
    <OperationsShell
      title="Past imports"
      subtitle="Daily DN batches can be undone (removes linked DNs). Shipping IDs batches are listed for history only and do not remove customers."
    >
      <div className="space-y-5">
        {permHint && (
          <div
            className="rounded-2xl border border-amber-200/90 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100"
            role="status"
          >
            {permHint}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void loadBatches()}
            disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {loading ? "Loading…" : "Refresh list"}
          </button>
          <Link
            href="/import"
            className="text-sm font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
          >
            New import
          </Link>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/95 dark:border-slate-800 dark:bg-slate-900/80">
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Started
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    File
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Status
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    DNs affected
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Report
                  </th>
                  <th className="w-[120px] whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {!loading && batches.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-14 text-center text-sm text-slate-500"
                    >
                      No import batches found.
                    </td>
                  </tr>
                ) : loading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-14 text-center text-sm text-slate-500"
                    >
                      Loading…
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => {
                    const busy = revertingId === b.id;
                    const canRevert =
                      canUndoDailyDn &&
                      b.source_type === "DAILY_DN" &&
                      b.status !== "RUNNING";
                    return (
                      <tr
                        key={b.id}
                        className="border-b border-slate-100 last:border-0 dark:border-slate-800/80"
                      >
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 dark:text-slate-400">
                          {formatWhen(b.started_at)}
                        </td>
                        <td
                          className="max-w-[240px] truncate px-4 py-3 font-medium text-slate-900 dark:text-slate-100"
                          title={b.file_name}
                        >
                          <span className="block truncate">{b.file_name}</span>
                          <span className="text-[11px] font-normal text-slate-500">
                            {b.source_type === "SHIPPING_IDS"
                              ? "Shipping IDs"
                              : "Daily DN"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusStyles(b.status)}`}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-800 dark:text-slate-200">
                          {b.source_type === "SHIPPING_IDS"
                            ? "—"
                            : b._count.delivery_notes}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Link
                            href={`/import/report/${b.id}`}
                            className="text-sm font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200"
                            title={
                              b.status === "RUNNING"
                                ? "Counts may be incomplete until this import finishes."
                                : undefined
                            }
                          >
                            Report
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          {b.source_type === "SHIPPING_IDS" ? (
                            <span className="text-xs text-slate-400">
                              No undo
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={!canRevert || busy || !!permHint}
                              onClick={() => void revertBatch(b)}
                              className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-red-900 dark:hover:bg-red-800"
                            >
                              {busy ? "Working…" : "Undo"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="max-w-2xl text-xs leading-relaxed text-slate-500 dark:text-slate-500">
          Only delivery notes with{" "}
          <code className="rounded bg-slate-200/90 px-1.5 py-0.5 font-mono text-[11px] text-slate-800 dark:bg-slate-800 dark:text-slate-300">
            last_seen_import_batch_id
          </code>{" "}
          matching this batch are deleted. Customer master records are retained.
        </p>
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
