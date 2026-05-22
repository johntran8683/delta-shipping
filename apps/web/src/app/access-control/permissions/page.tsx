"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { ResponseModal } from "@/components/response-modal";
import { clearSession, getAccessToken } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import { apiBase } from "@/lib/config";

type PermissionRow = {
  id: string;
  code: string;
  description: string | null;
  category: string | null;
  created_at: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  delivery_notes: "Delivery notes",
  shipping: "Shipping",
  import: "Data import",
  administration: "Administration",
};

export default function PermissionsListPage() {
  const router = useRouter();
  const [permHint, setPermHint] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [rows, setRows] = useState<PermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/access-control/permissions`, {
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
        setRows([]);
        return;
      }
      setRows(Array.isArray(body) ? (body as PermissionRow[]) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setRows([]);
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
      .then((d: { activeRoleCode?: string | null }) => {
        const role = (d.activeRoleCode ?? "").toUpperCase();
        if (!["SUPERVISOR", "SYSTEM"].includes(role)) {
          setPermHint(
            "Access control requires active role SUPERVISOR or SYSTEM.",
          );
          setCanManage(false);
        } else {
          setPermHint(null);
          setCanManage(true);
        }
      })
      .catch(() => undefined);
  }, [router]);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      setRows([]);
      return;
    }
    void loadList();
  }, [canManage, loadList]);

  return (
    <OperationsShell
      title="All permissions"
      subtitle="Read-only catalog of permission codes defined by the application (seed and releases)."
    >
      <div className="mx-auto max-w-4xl space-y-5">
        {permHint ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            {permHint}
          </div>
        ) : null}

        {canManage ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/access-control/role-matrix"
              className="text-sm font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200"
            >
              Role matrix
            </Link>
          </div>
        ) : null}

        {canManage ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
            {loading ? (
              <p className="p-5 text-sm text-slate-500">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No permissions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Area</th>
                      <th className="px-4 py-3">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.map((r) => (
                      <tr key={r.id} className="text-slate-800 dark:text-slate-200">
                        <td className="max-w-md px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">
                          {r.description ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-500">
                          {r.code}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                          {r.category
                            ? (CATEGORY_LABELS[r.category] ?? r.category)
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                          {new Date(r.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
