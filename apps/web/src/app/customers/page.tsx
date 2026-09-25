"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { clearSession, getAccessToken } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import { apiBase } from "@/lib/config";
import { canSeeCustomersNav } from "@/lib/import-access";

type CustomerListItem = {
  id: string;
  sold_to_code: string;
  sold_to_name: string;
  fed_id_number: string | null;
  default_contact_name: string | null;
  default_phone: string | null;
  is_active: boolean;
  carrier_account_count: number;
  ship_to_count: number;
};

type ListResponse = {
  items: CustomerListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export default function CustomersListPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permHint, setPermHint] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);

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
      .then((d: { activeRoleCode?: string | null; permissions?: string[] }) => {
        const role = d.activeRoleCode ?? "";
        const permissions = d.permissions ?? [];
        if (!canSeeCustomersNav(role)) {
          setPermHint(
            "Customers requires active role CSA, SHIPPER, SUPERVISOR, or SYSTEM.",
          );
        } else if (!permissions.includes("customers.read")) {
          setPermHint("Missing permission customers.read for active role.");
        } else {
          setPermHint(null);
        }
      })
      .catch(() => undefined);
  }, [router]);

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "50",
      });
      if (appliedQ.trim()) params.set("q", appliedQ.trim());
      const res = await fetch(`${apiBase}/customers?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
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
        setData(null);
        return;
      }
      setData(body as ListResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [appliedQ, page, router]);

  useEffect(() => {
    if (permHint) {
      setLoading(false);
      return;
    }
    void load();
  }, [load, permHint]);

  return (
    <OperationsShell
      title="Customers"
      subtitle="Customer profiles and courier (carrier) accounts"
    >
      <div className="mx-auto max-w-5xl space-y-4">
        {permHint ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            {permHint}
          </div>
        ) : null}

        {!permHint ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setAppliedQ(query);
            }}
          >
            <label className="min-w-[12rem] flex-1 text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-400">
                Search sold-to code or name
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                placeholder="e.g. 100123 or Acme"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-[var(--app-accent)] px-4 py-2 text-sm font-medium text-white"
            >
              Search
            </button>
          </form>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Loading customers…</p>
        ) : null}

        {!loading && !permHint && data ? (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {data.total} customer{data.total === 1 ? "" : "s"}
              {appliedQ.trim() ? ` matching “${appliedQ.trim()}”` : ""}
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Sold-to</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Contact</th>
                    <th className="px-3 py-2 font-medium">Accounts</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-8 text-center text-slate-500"
                      >
                        No customers found. Import a Shipping IDs file or wait
                        for DN import upserts.
                      </td>
                    </tr>
                  ) : (
                    data.items.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          <Link
                            href={`/customers/${c.id}`}
                            className="text-[var(--app-accent)] underline-offset-2 hover:underline"
                          >
                            {c.sold_to_code}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/customers/${c.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            {c.sold_to_name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                          {c.default_contact_name || c.default_phone || "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {c.carrier_account_count}
                        </td>
                        <td className="px-3 py-2">
                          {c.is_active ? (
                            <span className="text-emerald-700 dark:text-emerald-400">
                              Active
                            </span>
                          ) : (
                            <span className="text-slate-500">Inactive</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {data.totalPages > 1 ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40 dark:border-slate-600"
                >
                  Previous
                </button>
                <span className="text-slate-600 dark:text-slate-400">
                  Page {data.page} of {data.totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40 dark:border-slate-600"
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </OperationsShell>
  );
}
