"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { ResponseModal } from "@/components/response-modal";
import { clearSession, getAccessToken } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import {
  COLUMN_DISPLAY_ORDER,
  COLUMN_LABELS,
  DEFAULT_VISIBLE_COLUMNS,
  REQUIRED_COLUMNS,
  normalizeVisibleColumns,
  type ColumnKey,
} from "@/lib/delivery-notes-columns";
import { apiBase } from "@/lib/config";

function columnsEqual(a: ColumnKey[], b: ColumnKey[]) {
  if (a.length !== b.length) return false;
  return a.every((k, i) => k === b[i]);
}

export default function DeliveryNotesSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [draft, setDraft] = useState<ColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);
  const [savedSnapshot, setSavedSnapshot] = useState<ColumnKey[]>(
    DEFAULT_VISIBLE_COLUMNS,
  );

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    void fetch(`${apiBase}/me/delivery-notes-table-columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          clearSession();
          router.replace("/login");
          return;
        }
        if (!res.ok) {
          setError(
            formatApiErrorPayload(body) +
              (res.status ? ` (HTTP ${res.status})` : ""),
          );
          return;
        }
        const cols = normalizeVisibleColumns(
          (body as { visibleColumns?: unknown }).visibleColumns,
        );
        setDraft(cols);
        setSavedSnapshot(cols);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Request failed"),
      )
      .finally(() => setLoading(false));
  }, [router]);

  const dirty = useMemo(
    () => !columnsEqual(draft, savedSnapshot),
    [draft, savedSnapshot],
  );

  function toggleColumn(key: ColumnKey) {
    if (REQUIRED_COLUMNS.includes(key)) return;
    setDraft((prev) => {
      const has = prev.includes(key);
      const next = has ? prev.filter((k) => k !== key) : [...prev, key];
      return normalizeVisibleColumns(next);
    });
    setSavedOk(false);
  }

  async function onSave() {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await fetch(`${apiBase}/me/delivery-notes-table-columns`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ visibleColumns: draft }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        setError(
          formatApiErrorPayload(body) +
            (res.status ? ` (HTTP ${res.status})` : ""),
        );
        return;
      }
      const cols = normalizeVisibleColumns(
        (body as { visibleColumns?: unknown }).visibleColumns,
      );
      setDraft(cols);
      setSavedSnapshot(cols);
      setSavedOk(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <OperationsShell
      title="DN list columns"
      subtitle="Settings — choose which columns appear on the delivery notes list. DN # and Status always stay visible."
    >
      <div className="mx-auto max-w-2xl space-y-5">
        <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 sm:p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Delivery notes table columns
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Optional columns can be turned off. Changes apply after you click
            Save.
          </p>
          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Loading…</p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3">
              {COLUMN_DISPLAY_ORDER.map((key) => {
                const required = REQUIRED_COLUMNS.includes(key);
                const checked = draft.includes(key);
                return (
                  <label
                    key={key}
                    className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={required}
                      onChange={() => toggleColumn(key)}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900"
                    />
                    <span>
                      {COLUMN_LABELS[key]}
                      {required ? (
                        <span className="text-slate-400"> · fixed</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={loading || saving || !dirty}
              onClick={() => void onSave()}
              className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={loading || saving || !dirty}
              onClick={() => {
                setDraft([...savedSnapshot]);
                setSavedOk(false);
              }}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Discard changes
            </button>
          </div>
        </section>

        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          <Link
            href="/delivery-notes"
            className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200"
          >
            Back to delivery notes
          </Link>
        </p>
      </div>

      <ResponseModal
        open={!!error}
        onClose={() => setError(null)}
        message={error ?? ""}
        variant="error"
      />
      <ResponseModal
        open={savedOk}
        onClose={() => setSavedOk(false)}
        variant="success"
        title="Saved"
        message="Your delivery notes list will use these columns on every visit."
      />
    </OperationsShell>
  );
}
