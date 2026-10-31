"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OperationsShell } from "@/components/operations-shell";
import { formatApiErrorPayload } from "@/lib/api-error";
import { clearSession, getAccessToken } from "@/lib/auth-storage";
import { apiBase } from "@/lib/config";
import { canUseShippingIdsImport } from "@/lib/import-access";

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

export default function ShippingIdsImportPage() {
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
          if (!canUseShippingIdsImport(role)) {
            setPermHint(
              "Shipping IDs import requires active role CSA, SUPERVISOR, or SYSTEM.",
            );
          } else if (!codes.includes("import.shipping_ids")) {
            setPermHint(
              "Your role is missing import.shipping_ids. Contact an administrator.",
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
    setQueuedBatchId(null);
    setBatch(null);
    setPollError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${apiBase}/import/shipping-ids`, {
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
      ? ".xlsx, .xlsm, or .xls · max 15 MB · sheet Customers preferred"
      : `${formatBytes(file.size)}${
          file.name.lastIndexOf(".") >= 0
            ? ` · .${file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()}`
            : ""
        }`;

  return (
    <OperationsShell
      title="Shipping IDs import"
      subtitle="Upsert customer profiles and UPS / FedEx / DHL courier accounts from the Shipping IDs workbook."
    >
      <div className="mx-auto max-w-xl space-y-6">
        {permHint ? (
          <div
            className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-3.5 text-sm text-amber-950 dark:border-amber-900/45 dark:bg-amber-950/35 dark:text-amber-100"
            role="status"
          >
            {permHint}
          </div>
        ) : null}

        <div className="rounded-xl border border-[color:var(--app-border)] bg-[var(--app-surface)] p-6 sm:p-8">
          <form onSubmit={onSubmit} className="space-y-6">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Spreadsheet
              </p>
              <label
                htmlFor="shipping-ids-file"
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
                className={
                  "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-10 text-center transition " +
                  (dragOver
                    ? "border-[var(--app-accent)] bg-[var(--app-accent)]/5"
                    : "border-slate-300 dark:border-slate-600")
                }
              >
                <input
                  id="shipping-ids-file"
                  type="file"
                  accept=".xlsx,.xlsm,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                />
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {file ? file.name : "Drop Shipping IDs file here, or browse"}
                </p>
                <p className="mt-1 text-xs text-slate-500">{fileHintLine}</p>
              </label>
            </div>

            <button
              type="submit"
              disabled={!file || loading || Boolean(permHint)}
              className="w-full rounded-lg bg-[var(--app-accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {loading ? "Uploading…" : "Import Shipping IDs"}
            </button>
          </form>

          {message ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
              {message}
            </div>
          ) : null}
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
                href="/customers"
                className="text-[var(--app-accent)] hover:underline"
              >
                Open customers
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

        <p className="text-xs leading-relaxed text-slate-500">
          Safe merge: existing courier accounts that are missing from the file
          are left alone (CSA may have added extras). Matching rows are
          reactivated. Required columns: <code>code</code>,{" "}
          <code>CUSTOMER NAME:</code>. Optional: FED ID, contact, phone, email,
          shipping info, UPS #, FED EX #, DHL #.
        </p>
      </div>
    </OperationsShell>
  );
}
