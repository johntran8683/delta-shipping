"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OperationsShell } from "@/components/operations-shell";
import { ResponseModal } from "@/components/response-modal";
import { formatApiErrorPayload } from "@/lib/api-error";
import { clearSession, getAccessToken } from "@/lib/auth-storage";
import { apiBase } from "@/lib/config";
import { canUseDataImport } from "@/lib/import-access";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Subset of the import report response the status card needs. */
type BatchStatus = {
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

type BatchReport = {
  batch: BatchStatus;
  rowFailureCount: number;
};

const TERMINAL_BATCH_STATUSES = ["SUCCESS", "PARTIAL", "FAILED"];

function batchStatusLabel(status: string): string {
  if (status === "SUCCESS") return "Done";
  if (status === "PARTIAL") return "Done with issues";
  if (status === "FAILED") return "Failed";
  return "Processing";
}

/** Same pill colors as the import report page. */
function batchStatusClass(status: string): string {
  if (status === "SUCCESS")
    return "border-emerald-200/90 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (status === "PARTIAL")
    return "border-amber-200/90 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-200";
  if (status === "FAILED")
    return "border-red-200/90 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300";
  return "border-sky-200/90 bg-sky-50 text-sky-900 dark:border-sky-800/60 dark:bg-sky-950/35 dark:text-sky-200";
}

function IconUpload({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconAlert({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export default function ImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [permHint, setPermHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [queuedBatchId, setQueuedBatchId] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
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
          if (!canUseDataImport(role)) {
            setPermHint(
              "Excel import requires active role SUPERVISOR or SYSTEM. Sign out and sign in again, or switch your active role.",
            );
          } else if (!codes.includes("import.daily_dn")) {
            setPermHint(
              "Your role is missing import permission (import.daily_dn). Contact an administrator.",
            );
          }
        },
      )
      .catch(() => undefined);
  }, []);

  function pickFile(f: File | undefined | null) {
    if (!f) return;
    setFile(f);
    setMessage(null);
    setQueuedBatchId(null);
    setBatch(null);
    setPollError(null);
  }

  function resetImport() {
    setFile(null);
    setMessage(null);
    setQueuedBatchId(null);
    setBatch(null);
    setPollError(null);
  }

  /* Live status: once a batch is queued, poll its report every 3s until
     it reaches a terminal status. Polling stops on unmount, on reset, on
     a terminal status, or on a refresh error (the report link stays). */
  useEffect(() => {
    if (!queuedBatchId) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const fetchStatus = async () => {
      const token = getAccessToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      try {
        const res = await fetch(
          `${apiBase}/import/batches/${queuedBatchId}/report`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          clearSession();
          router.replace("/login");
          return;
        }
        if (!res.ok) {
          if (!stopped) setPollError(formatApiErrorPayload(body));
          stop();
          return;
        }
        const data = body as BatchReport;
        if (stopped) return;
        setBatch(data.batch);
        if (TERMINAL_BATCH_STATUSES.includes(data.batch.status)) stop();
      } catch (e) {
        if (!stopped) {
          setPollError(e instanceof Error ? e.message : "Request failed");
        }
        stop();
      }
    };
    void fetchStatus();
    timer = setInterval(() => {
      void fetchStatus();
    }, 3000);
    return () => {
      stopped = true;
      stop();
    };
  }, [queuedBatchId, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = getAccessToken();
    if (!token || !file) return;
    setLoading(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${apiBase}/import/excel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(
          `${formatApiErrorPayload(data)}${res.status ? ` (HTTP ${res.status})` : ""}`,
        );
        return;
      }
      if (data.batchId) {
        setQueuedBatchId(data.batchId as string);
        return;
      }
      setMessage("Unexpected response from server");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  const fileHintLine =
    file == null
      ? ".xlsx, .xlsm, or .xls · max 15 MB"
      : `${formatBytes(file.size)}${
          file.name.lastIndexOf(".") >= 0
            ? ` · .${file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()}`
            : ""
        }`;

  return (
    <OperationsShell
      title="Daily DN import"
      subtitle="Upload the workbook’s first sheet. Each row is one line; notes group by the DN# column."
    >
      <div className="mx-auto max-w-xl space-y-8">
        {permHint ? (
          <div
            className="flex gap-3 rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-3.5 dark:border-amber-900/45 dark:bg-amber-950/35"
            role="status"
          >
            <span className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400">
              <IconAlert />
            </span>
            <p className="text-sm leading-relaxed text-amber-950 dark:text-amber-100">
              {permHint}
            </p>
          </div>
        ) : null}

        <div className="rounded-xl border border-[color:var(--app-border)] bg-[var(--app-surface)] p-6 shadow-[0_1px_2px_rgb(15_23_42/0.04)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.25)] sm:p-8">
          <form onSubmit={onSubmit} className="space-y-6">
            <div>
              <p
                id="import-file-label"
                className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400"
              >
                Spreadsheet
              </p>
              <label
                htmlFor="import-file"
                aria-labelledby="import-file-label"
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOver(false);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
                className={
                  "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-5 py-12 transition-colors sm:py-14 " +
                  (dragOver
                    ? "border-[color:var(--app-brand)] bg-[color:rgb(30_73_118/0.06)] dark:bg-[color:rgb(126_184_255/0.08)]"
                    : "border-[color:var(--app-border)] bg-[var(--app-canvas)]/50 hover:border-slate-400/70 dark:hover:border-slate-500")
                }
              >
                <input
                  id="import-file"
                  type="file"
                  accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  required={false}
                  onChange={(e) => pickFile(e.target.files?.[0])}
                  className="sr-only"
                />
                <IconUpload className="mb-3 text-slate-400 dark:text-slate-500" />
                <span className="text-center text-sm font-medium text-slate-900 dark:text-slate-100">
                  {file ? file.name : "Choose a file or drop it here"}
                </span>
                <span className="mt-1.5 text-center text-xs text-slate-500 dark:text-slate-400">
                  {fileHintLine}
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || !file || !!permHint}
              className="w-full rounded-lg bg-slate-900 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-45 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {loading ? "Uploading…" : "Upload and queue"}
            </button>
          </form>
        </div>

        {queuedBatchId ? (
          <div className="rounded-xl border border-[color:var(--app-border)] bg-[var(--app-surface)] p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {batch?.file_name ?? file?.name ?? "Import"}
              </p>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${batchStatusClass(batch?.status ?? "RUNNING")}`}
              >
                {batchStatusLabel(batch?.status ?? "RUNNING")}
              </span>
            </div>
            {!batch ? (
              <p className="mt-2 text-sm text-slate-500">
                Waiting for the import to start…
              </p>
            ) : TERMINAL_BATCH_STATUSES.includes(batch.status) ? (
              <>
                {batch.summary_message ? (
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    {batch.summary_message}
                  </p>
                ) : null}
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {batch.total_rows.toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-500">Rows in file</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {batch.success_rows.toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-500">Successful rows</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {batch.error_rows.toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-500">Row issues</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                Import is running — this card updates automatically.
                {batch.total_rows > 0
                  ? ` ${batch.total_rows.toLocaleString()} rows in file.`
                  : ""}
              </p>
            )}
            {pollError ? (
              <p className="mt-2 text-sm text-red-800 dark:text-red-300">
                Couldn&apos;t refresh status: {pollError}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <Link
                href={`/import/report/${queuedBatchId}`}
                className="text-[var(--app-accent)] hover:underline"
              >
                View full report
              </Link>
              <Link
                href={`/delivery-notes?importBatch=${queuedBatchId}`}
                className="text-[var(--app-accent)] hover:underline"
              >
                Open delivery notes
              </Link>
              <button
                type="button"
                className="text-[var(--app-accent)] hover:underline"
                onClick={() => router.push("/import/revert")}
              >
                Past imports
              </button>
              <button
                type="button"
                className="text-[var(--app-accent)] hover:underline"
                onClick={resetImport}
              >
                Import another file
              </button>
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border border-[color:var(--app-border)] bg-[var(--app-surface)]/80 px-5 py-4 dark:bg-[var(--app-surface)]/60">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            After upload
          </p>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--app-brand)] opacity-70" />
              Processing runs in the background — the status card above updates automatically.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--app-brand)] opacity-70" />
              Customers and ship-to locations update from the sheet when columns are present.
            </li>
          </ul>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-[color:var(--app-border)] pt-6 text-xs">
          <Link
            href="/delivery-notes"
            className="font-medium text-[color:var(--app-brand)] underline decoration-slate-300/90 underline-offset-[5px] transition hover:opacity-90 dark:decoration-slate-600"
          >
            Delivery notes
          </Link>
          <span className="text-slate-300 dark:text-slate-600" aria-hidden>
            ·
          </span>
          <Link
            href="/import/revert"
            className="font-medium text-[color:var(--app-brand)] underline decoration-slate-300/90 underline-offset-[5px] transition hover:opacity-90 dark:decoration-slate-600"
          >
            Past imports
          </Link>
        </nav>

        <ResponseModal
          open={!!message}
          onClose={() => setMessage(null)}
          message={message ?? ""}
          variant="error"
          title="Unable to complete import"
        />
      </div>
    </OperationsShell>
  );
}
