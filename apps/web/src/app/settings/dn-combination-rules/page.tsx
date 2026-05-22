"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { ResponseModal } from "@/components/response-modal";
import { clearSession, getAccessToken, getActiveRoleCode } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import { apiBase } from "@/lib/config";

type CustomerCombinationRow = {
  id: string;
  sold_to_code: string;
  sold_to_name: string;
  is_active: boolean;
  dn_combine_hints_disallowed: boolean;
};

function roleMayEditCombinationRules(): boolean {
  const code = (getActiveRoleCode() ?? "").trim().toUpperCase();
  return code === "SUPERVISOR" || code === "SYSTEM";
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export default function DnCombinationRulesSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CustomerCombinationRow[]>([]);
  const [draftDisallow, setDraftDisallow] = useState<Set<string>>(new Set());
  const [savedDisallow, setSavedDisallow] = useState<Set<string>>(new Set());

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.sold_to_code.toLowerCase().includes(q) ||
        r.sold_to_name.toLowerCase().includes(q),
    );
  }, [query, rows]);

  const dirty = useMemo(() => {
    if (draftDisallow.size !== savedDisallow.size) return true;
    for (const c of draftDisallow) {
      if (!savedDisallow.has(c)) return true;
    }
    return false;
  }, [draftDisallow, savedDisallow]);

  useEffect(() => {
    if (!savedOk) return;
    const t = window.setTimeout(() => setSavedOk(false), 4000);
    return () => window.clearTimeout(t);
  }, [savedOk]);

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/customers/dn-combination-rules`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (res.status === 403) {
        router.replace("/settings/delivery-notes");
        return;
      }
      if (!res.ok) {
        setError(
          formatApiErrorPayload(body) +
            (res.status ? ` (HTTP ${res.status})` : ""),
        );
        return;
      }
      const items = (body as { items?: CustomerCombinationRow[] }).items;
      const list = Array.isArray(items) ? items : [];
      setRows(list);
      const disallow = new Set(
        list.filter((r) => r.dn_combine_hints_disallowed).map((r) => r.sold_to_code),
      );
      setDraftDisallow(new Set(disallow));
      setSavedDisallow(new Set(disallow));
      setSavedOk(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!roleMayEditCombinationRules()) {
      router.replace("/settings/delivery-notes");
      return;
    }
    void load();
  }, [load, router]);

  function toggleSoldToCode(code: string) {
    setDraftDisallow((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    setSavedOk(false);
  }

  function discard() {
    setDraftDisallow(new Set(savedDisallow));
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
      const res = await fetch(`${apiBase}/customers/dn-combination-rules`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          disallowingSoldToCodes: [...draftDisallow],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (res.status === 403) {
        router.replace("/settings/delivery-notes");
        return;
      }
      if (!res.ok) {
        setError(
          formatApiErrorPayload(body) +
            (res.status ? ` (HTTP ${res.status})` : ""),
        );
        return;
      }
      const items = (body as { items?: CustomerCombinationRow[] }).items;
      const list = Array.isArray(items) ? items : [];
      setRows(list);
      const disallow = new Set(
        list.filter((r) => r.dn_combine_hints_disallowed).map((r) => r.sold_to_code),
      );
      setDraftDisallow(new Set(disallow));
      setSavedDisallow(new Set(disallow));
      setSavedOk(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <OperationsShell
      title="DNs combination rules"
      subtitle="Companies you mark below are excluded from combine-with hints on the delivery notes list. Supervisor or system role only."
    >
      <div className="mx-auto max-w-2xl space-y-6">
        <nav
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-500"
          aria-label="Breadcrumb"
        >
          <Link
            href="/settings/delivery-notes"
            className="text-slate-600 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            Settings
          </Link>
          <span className="text-slate-300 dark:text-slate-600" aria-hidden>
            /
          </span>
          <span className="text-slate-900 dark:text-slate-200">Combination rules</span>
        </nav>

        <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-[var(--app-surface)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800/90 dark:shadow-none">
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800/80 sm:px-5">
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
              Restricted companies no longer participate in same-customer combine
              clusters (ship-to, location, ship type). Other roles still see the list;
              hints simply omit those DNs.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-800/80 dark:bg-slate-900/30 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                <SearchIcon />
              </span>
              <input
                id="dn-combo-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by company or sold-to code…"
                autoComplete="off"
                className="w-full rounded-lg border border-slate-200/90 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none ring-slate-900/5 transition focus:border-slate-300 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-100/10"
              />
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {savedOk ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
                  <svg
                    className="h-3.5 w-3.5 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden
                  >
                    <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Saved
                </span>
              ) : null}
              {dirty ? (
                <button
                  type="button"
                  onClick={discard}
                  disabled={saving}
                  className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-200/80 hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  Discard
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void onSave()}
                disabled={saving || !dirty}
                className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-35 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:border-slate-800/80 dark:text-slate-500 sm:px-5">
            <span className="tabular-nums">
              {loading
                ? "—"
                : `${filteredRows.length} compan${filteredRows.length === 1 ? "y" : "ies"}${query.trim() ? " (filtered)" : ""}`}
            </span>
            <span className="tabular-nums text-slate-400 dark:text-slate-500">
              {draftDisallow.size} restricted
            </span>
          </div>

          <div className="max-h-[min(52vh,22rem)] overflow-auto">
            {loading ? (
              <div className="space-y-0 divide-y divide-slate-100 dark:divide-slate-800/80" aria-busy>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                    <div className="h-4 w-4 shrink-0 rounded bg-slate-200/90 dark:bg-slate-700/80" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-3.5 w-[min(60%,14rem)] rounded bg-slate-200/90 dark:bg-slate-700/80" />
                      <div className="h-3 w-24 rounded bg-slate-100 dark:bg-slate-800/80" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="px-4 py-12 text-center sm:px-5">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {rows.length === 0
                    ? "No companies yet"
                    : "No matches for this filter"}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                  {rows.length === 0
                    ? "Import or create customers first."
                    : "Try a different search term."}
                </p>
              </div>
            ) : (
              <table className="w-full min-w-0 border-collapse text-left text-sm">
                <thead>
                  <tr className="sticky top-0 z-[1] border-b border-slate-200/90 bg-[var(--app-surface)]/95 text-[11px] font-semibold uppercase tracking-wide text-slate-500 backdrop-blur-sm dark:border-slate-800 dark:bg-[var(--app-surface)]/90 dark:text-slate-500">
                    <th className="px-4 py-2.5 font-medium sm:px-5">Company</th>
                    <th className="hidden w-[1%] whitespace-nowrap px-2 py-2.5 font-medium sm:table-cell">
                      Code
                    </th>
                    <th className="w-[1%] whitespace-nowrap px-4 py-2.5 text-right font-medium sm:px-5">
                      Restrict
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredRows.map((r) => {
                    const restricted = draftDisallow.has(r.sold_to_code);
                    return (
                      <tr
                        key={r.id}
                        className="transition-colors hover:bg-slate-50/90 dark:hover:bg-slate-900/35"
                      >
                        <td className="max-w-0 px-4 py-2.5 sm:px-5">
                          <div className="truncate font-medium text-slate-900 dark:text-slate-100">
                            {r.sold_to_name}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:hidden">
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-500">
                              {r.sold_to_code}
                            </span>
                            {!r.is_active ? (
                              <span className="rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-slate-500 ring-1 ring-inset ring-slate-200 dark:text-slate-400 dark:ring-slate-700">
                                Inactive
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="hidden whitespace-nowrap px-2 py-2.5 sm:table-cell">
                          <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                            {r.sold_to_code}
                          </span>
                          {!r.is_active ? (
                            <span className="ml-2 inline-block rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-slate-500 ring-1 ring-inset ring-slate-200 dark:text-slate-400 dark:ring-slate-700">
                              Inactive
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right sm:px-5">
                          <label className="inline-flex cursor-pointer items-center gap-2">
                            <span className="sr-only">
                              Restrict combine hints for {r.sold_to_name}
                            </span>
                            <input
                              type="checkbox"
                              checked={restricted}
                              onChange={() => toggleSoldToCode(r.sold_to_code)}
                              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-900/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-slate-100/20"
                            />
                            <span
                              className={
                                "hidden text-[11px] font-medium sm:inline " +
                                (restricted
                                  ? "text-slate-800 dark:text-slate-200"
                                  : "text-slate-400 dark:text-slate-500")
                              }
                            >
                              {restricted ? "On" : "Off"}
                            </span>
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <p className="text-center text-sm text-slate-500 dark:text-slate-500">
          <Link
            href="/settings/delivery-notes"
            className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 transition hover:text-slate-900 dark:text-slate-300 dark:decoration-slate-600 dark:hover:text-slate-100"
          >
            DN list columns
          </Link>
          <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
          <Link
            href="/delivery-notes"
            className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 transition hover:text-slate-900 dark:text-slate-300 dark:decoration-slate-600 dark:hover:text-slate-100"
          >
            Delivery notes
          </Link>
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
