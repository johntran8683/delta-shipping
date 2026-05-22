"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { ResponseModal } from "@/components/response-modal";
import { clearSession, getAccessToken } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import { apiBase } from "@/lib/config";
import {
  codesEqual,
  describeRiskySave,
  groupPermissionsByCategory,
  isRiskySave,
  type MatrixCategory,
  type MatrixPermission,
  type MatrixRole,
} from "@/lib/role-matrix";

type MatrixResponse = {
  categories: MatrixCategory[];
  permissions: MatrixPermission[];
  roles: MatrixRole[];
};

type ConfirmState = {
  roleId: string;
  codes: string[];
  title: string;
  message: string;
};

export default function RoleMatrixPage() {
  const router = useRouter();
  const [permHint, setPermHint] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [matrix, setMatrix] = useState<MatrixResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [matrixFeedback, setMatrixFeedback] = useState<{
    title: string;
    message: string;
    variant: "error" | "success";
  } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const loadMatrix = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    setMatrixFeedback(null);
    try {
      const res = await fetch(`${apiBase}/access-control/matrix`, {
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
        setMatrix(null);
        setDraft({});
        return;
      }
      const m = body as MatrixResponse;
      setMatrix(m);
      const nextDraft: Record<string, string[]> = {};
      for (const r of m.roles ?? []) {
        nextDraft[r.id] = [...r.permissionCodes];
      }
      setDraft(nextDraft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setMatrix(null);
      setDraft({});
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
          activeRoleCode?: string | null;
          permissions?: string[];
        }) => {
          const role = (d.activeRoleCode ?? "").toUpperCase();
          const perms = d.permissions ?? [];
          if (!["SUPERVISOR", "SYSTEM"].includes(role)) {
            setPermHint(
              "Access control requires active role SUPERVISOR or SYSTEM.",
            );
            setCanManage(false);
            return;
          }
          if (!perms.includes("permissions.manage")) {
            setPermHint(
              "Missing permission permissions.manage for your active role.",
            );
            setCanManage(false);
            return;
          }
          setPermHint(null);
          setCanManage(true);
        },
      )
      .catch(() => undefined);
  }, [router]);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      setMatrix(null);
      setDraft({});
      return;
    }
    void loadMatrix();
  }, [canManage, loadMatrix]);

  const categories = matrix?.categories ?? [];
  const permissions = matrix?.permissions ?? [];
  const roles = matrix?.roles ?? [];

  const permissionGroups = useMemo(
    () => groupPermissionsByCategory(permissions, categories),
    [permissions, categories],
  );

  const baselineByRole = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const r of roles) {
      m[r.id] = [...r.permissionCodes];
    }
    return m;
  }, [roles]);

  function toggleCell(roleId: string, code: string, locked: boolean) {
    if (locked) return;
    setDraft((prev) => {
      const cur = new Set(prev[roleId] ?? []);
      if (cur.has(code)) cur.delete(code);
      else cur.add(code);
      return { ...prev, [roleId]: Array.from(cur).sort() };
    });
    setMatrixFeedback(null);
  }

  function resetRow(roleId: string) {
    setDraft((prev) => ({
      ...prev,
      [roleId]: [...(baselineByRole[roleId] ?? [])],
    }));
    setMatrixFeedback(null);
  }

  function restoreDefaults(roleId: string) {
    const role = roles.find((r) => r.id === roleId);
    if (!role?.defaultPermissionCodes?.length) return;
    setDraft((prev) => ({
      ...prev,
      [roleId]: [...role.defaultPermissionCodes].sort(),
    }));
    setMatrixFeedback(null);
  }

  async function persistRow(roleId: string, codes: string[]) {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    const roleRow = roles.find((x) => x.id === roleId);
    const roleLabel = roleRow ? `${roleRow.name} (${roleRow.code})` : roleId;
    setSavingRoleId(roleId);
    setMatrixFeedback(null);
    try {
      const res = await fetch(
        `${apiBase}/access-control/roles/${roleId}/permissions`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ permissionCodes: codes }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        setMatrixFeedback({
          title: "Could not save",
          message: `${roleLabel}\n\n${formatApiErrorPayload(body)}${res.status ? ` (HTTP ${res.status})` : ""}`,
          variant: "error",
        });
        return;
      }
      const updated = (body.permissionCodes ?? codes) as string[];
      setMatrix((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          roles: prev.roles.map((r) =>
            r.id === roleId ? { ...r, permissionCodes: [...updated].sort() } : r,
          ),
        };
      });
      setDraft((prev) => ({ ...prev, [roleId]: [...updated].sort() }));
      setMatrixFeedback({
        title: "Saved",
        message: `${roleLabel}\n\nPermissions updated for this role.`,
        variant: "success",
      });
    } catch (e) {
      setMatrixFeedback({
        title: "Could not save",
        message: `${roleLabel}\n\n${e instanceof Error ? e.message : "Request failed"}`,
        variant: "error",
      });
    } finally {
      setSavingRoleId(null);
      setConfirm(null);
    }
  }

  function requestSave(roleId: string) {
    const role = roles.find((r) => r.id === roleId);
    if (!role || role.bypassApiMatrix) return;
    const codes = draft[roleId] ?? [];
    const baseline = baselineByRole[roleId] ?? [];
    if (isRiskySave(role, baseline, codes)) {
      const reasons = describeRiskySave(role, baseline, codes);
      setConfirm({
        roleId,
        codes,
        title: "Confirm permission change",
        message: `${role.name} (${role.code})\n\n${reasons.map((r) => `• ${r}`).join("\n")}\n\nSave anyway?`,
      });
      return;
    }
    void persistRow(roleId, codes);
  }

  return (
    <OperationsShell
      title="Role matrix"
      subtitle="Assign application permissions to operational roles. Changes apply to API access when users act in that role."
    >
      <div className="mx-auto max-w-6xl space-y-6">
        {permHint ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            {permHint}
          </div>
        ) : null}

        {canManage ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/access-control/permissions"
              className="text-sm font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200"
            >
              All permissions
            </Link>
          </div>
        ) : null}

        {canManage ? (
          <section>
            <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
              {loading ? (
                <p className="p-5 text-sm text-slate-500">Loading matrix…</p>
              ) : permissions.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">
                  No assignable permissions in catalog.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-max border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                        <th
                          rowSpan={2}
                          className="sticky left-0 z-20 min-w-[10rem] border-r border-slate-200 bg-slate-50 px-3 py-2 align-bottom font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                        >
                          Role
                        </th>
                        <th
                          rowSpan={2}
                          className="sticky left-[10rem] z-20 min-w-[7rem] border-r border-slate-200 bg-slate-50 px-2 py-2 align-bottom font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                        >
                          Actions
                        </th>
                        {permissionGroups.map(({ category, permissions: perms }) => (
                          <th
                            key={category.id}
                            colSpan={perms.length}
                            className="border-l border-slate-200 px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400"
                          >
                            {category.label}
                          </th>
                        ))}
                      </tr>
                      <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                        {permissionGroups.flatMap(({ permissions: perms }) =>
                          perms.map((p) => (
                            <th
                              key={p.id}
                              title={p.code}
                              className="max-w-[8.5rem] min-w-[5.5rem] border-l border-slate-100 px-2 py-2 align-bottom font-normal dark:border-slate-800"
                            >
                              <span className="block text-[11px] font-medium leading-snug text-slate-700 dark:text-slate-200">
                                {p.description}
                              </span>
                              <span className="mt-0.5 block font-mono text-[9px] text-slate-400">
                                {p.code}
                              </span>
                            </th>
                          )),
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {roles.map((r) => {
                        const rowCodes = new Set(draft[r.id] ?? []);
                        const dirty = !codesEqual(
                          draft[r.id] ?? [],
                          baselineByRole[r.id] ?? [],
                        );
                        const locked = r.bypassApiMatrix;
                        return (
                          <tr
                            key={r.id}
                            className={
                              locked
                                ? "bg-slate-50/80 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400"
                                : "text-slate-800 dark:text-slate-200"
                            }
                          >
                            <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                              <div className="font-medium">{r.name}</div>
                              <div className="font-mono text-[10px] text-slate-500">
                                {r.code}
                              </div>
                              {locked ? (
                                <span className="mt-1 inline-block rounded bg-slate-200/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                  Full API access
                                </span>
                              ) : null}
                            </td>
                            <td className="sticky left-[10rem] z-10 border-r border-slate-100 bg-white px-2 py-2 align-top dark:border-slate-800 dark:bg-slate-950">
                              {locked ? (
                                <span className="text-[10px] text-slate-500">
                                  Read-only
                                </span>
                              ) : (
                                <div className="flex flex-col gap-1">
                                  <button
                                    type="button"
                                    disabled={
                                      !dirty || savingRoleId === r.id || !!permHint
                                    }
                                    onClick={() => requestSave(r.id)}
                                    className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  >
                                    {savingRoleId === r.id ? "Saving…" : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!dirty || savingRoleId === r.id}
                                    onClick={() => resetRow(r.id)}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-800"
                                  >
                                    Reset
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      savingRoleId === r.id ||
                                      r.defaultPermissionCodes.length === 0
                                    }
                                    onClick={() => restoreDefaults(r.id)}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-800"
                                  >
                                    Defaults
                                  </button>
                                </div>
                              )}
                            </td>
                            {permissionGroups.flatMap(({ permissions: perms }) =>
                              perms.map((p) => (
                                <td
                                  key={p.id}
                                  className="border-l border-slate-50 px-0 py-1 text-center align-middle dark:border-slate-800/80"
                                >
                                  <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 disabled:opacity-50"
                                    checked={rowCodes.has(p.code)}
                                    onChange={() =>
                                      toggleCell(r.id, p.code, locked)
                                    }
                                    disabled={locked || !!permHint}
                                    aria-label={`${r.code} — ${p.description}`}
                                  />
                                </td>
                              )),
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        ) : null}
      </div>

      {confirm ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-save-title"
        >
          <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-950">
            <h3
              id="confirm-save-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {confirm.title}
            </h3>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">
              {confirm.message}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
                onClick={() => void persistRow(confirm.roleId, confirm.codes)}
              >
                Save anyway
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ResponseModal
        open={!!error}
        onClose={() => setError(null)}
        message={error ?? ""}
        variant="error"
      />
      <ResponseModal
        open={!!matrixFeedback}
        onClose={() => setMatrixFeedback(null)}
        title={matrixFeedback?.title}
        message={matrixFeedback?.message ?? ""}
        variant={matrixFeedback?.variant ?? "error"}
      />
    </OperationsShell>
  );
}
