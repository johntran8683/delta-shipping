"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createPortal } from "react-dom";
import { clearSession, getAccessToken } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import { ResponseModal } from "@/components/response-modal";
import { apiBase } from "@/lib/config";

export type RoleRow = {
  code: string;
  name: string;
};

export type ManagedUserRow = {
  id: string;
  email: string;
  displayName: string | null;
  mustChangePassword: boolean;
  isActive: boolean;
  roles: RoleRow[];
};

type ManagedUsersPanelProps = {
  /** When false, panel shows a short hint instead of loading data. */
  canManage: boolean;
};

function roleSummary(roles: RoleRow[]) {
  if (roles.length === 0) return "—";
  return roles.map((r) => r.name).join(", ");
}

export function ManagedUsersPanel({ canManage }: ManagedUsersPanelProps) {
  const router = useRouter();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [managedUsers, setManagedUsers] = useState<ManagedUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingRoles, setEditingRoles] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);
  const [resetTarget, setResetTarget] = useState<ManagedUserRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetFormError, setResetFormError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadManagedUsers = useCallback(
    async (token: string) => {
      const res = await fetch(`${apiBase}/users`, {
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
        return;
      }
      setManagedUsers(Array.isArray(body) ? (body as ManagedUserRow[]) : []);
    },
    [router],
  );

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const meRes = await fetch(`${apiBase}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const meBody = await meRes.json().catch(() => ({}));
        if (meRes.ok && meBody?.user?.id) {
          setCurrentUserId(meBody.user.id as string);
        }

        const res = await fetch(`${apiBase}/users/roles`, {
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
          return;
        }
        setRoles(Array.isArray(body) ? (body as RoleRow[]) : []);
        await loadManagedUsers(token);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [canManage, loadManagedUsers, router]);

  function toggleEditingRole(code: string) {
    setEditingRoles((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  function startEditUser(user: ManagedUserRow) {
    setEditingUserId(user.id);
    setEditingRoles(user.roles.map((r) => r.code));
  }

  function cancelEditUser() {
    setEditingUserId(null);
    setEditingRoles([]);
  }

  async function saveUserRoles(userId: string) {
    if (editingRoles.length === 0) return;
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setSavingRoles(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/users/${userId}/roles`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roleCodes: editingRoles }),
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
      await loadManagedUsers(token);
      cancelEditUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSavingRoles(false);
    }
  }

  function openResetPassword(u: ManagedUserRow) {
    setError(null);
    setResetFormError(null);
    setResetTarget(u);
    setResetPassword("");
    setResetPasswordConfirm("");
  }

  function closeResetPassword() {
    setResetTarget(null);
    setResetPassword("");
    setResetPasswordConfirm("");
    setResetSubmitting(false);
    setResetFormError(null);
  }

  async function submitResetPassword() {
    if (!resetTarget) return;
    if (resetPassword.length < 8) {
      setResetFormError("New password must be at least 8 characters.");
      return;
    }
    if (resetPassword !== resetPasswordConfirm) {
      setResetFormError("Passwords do not match.");
      return;
    }
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setResetSubmitting(true);
    setResetFormError(null);
    try {
      const res = await fetch(`${apiBase}/users/${resetTarget.id}/password`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword: resetPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        setResetFormError(
          formatApiErrorPayload(body) +
            (res.status ? ` (HTTP ${res.status})` : ""),
        );
        return;
      }
      closeResetPassword();
      await loadManagedUsers(token);
    } catch (err) {
      setResetFormError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setResetSubmitting(false);
    }
  }

  async function setUserActive(u: ManagedUserRow, isActive: boolean) {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!isActive) {
      const ok = window.confirm(
        `Disable login for ${u.email}? They cannot sign in until you enable the account again.`,
      );
      if (!ok) return;
    }
    setError(null);
    try {
      const res = await fetch(`${apiBase}/users/${u.id}/active`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive }),
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
      await loadManagedUsers(token);
      if (editingUserId === u.id && !isActive) cancelEditUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  if (!canManage) {
    return (
      <div className="rounded-lg border border-slate-200/90 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
        Switch to active role <span className="font-medium text-slate-800 dark:text-slate-200">SUPERVISOR</span> or{" "}
        <span className="font-medium text-slate-800 dark:text-slate-200">SYSTEM</span> with{" "}
        <code className="rounded bg-white px-1 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-700">
          users.manage
        </code>{" "}
        to view users you created.
      </div>
    );
  }

  function closeDetailsMenu(e: React.MouseEvent<HTMLElement>) {
    const root = e.currentTarget.closest("details");
    if (root) root.open = false;
  }

  const resetModal =
    mounted && resetTarget
      ? createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-pw-title"
            onClick={closeResetPassword}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-950"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="reset-pw-title"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                Reset password
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {resetTarget.displayName || resetTarget.email} will be required to choose a new
                password after signing in with this password.
              </p>
              <div className="mt-3 space-y-2">
                {resetFormError ? (
                  <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                    {resetFormError}
                  </p>
                ) : null}
                <div>
                  <label
                    htmlFor="reset-new-pw"
                    className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    New password
                  </label>
                  <input
                    id="reset-new-pw"
                    type="password"
                    autoComplete="new-password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="reset-confirm-pw"
                    className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    Confirm
                  </label>
                  <input
                    id="reset-confirm-pw"
                    type="password"
                    autoComplete="new-password"
                    value={resetPasswordConfirm}
                    onChange={(e) => setResetPasswordConfirm(e.target.value)}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={resetSubmitting}
                  onClick={closeResetPassword}
                  className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    resetSubmitting ||
                    resetPassword.length < 8 ||
                    resetPassword !== resetPasswordConfirm
                  }
                  onClick={() => void submitResetPassword()}
                  className="h-8 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                >
                  {resetSubmitting ? "Saving…" : "Set password"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
        <p className="min-w-0 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          Accounts you created
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 tabular-nums text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {loading ? "…" : `${managedUsers.length} user${managedUsers.length === 1 ? "" : "s"}`}
          </span>
          <Link
            href="/users/new"
            className="inline-flex h-7 items-center rounded-md bg-slate-900 px-2.5 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            Create user
          </Link>
        </div>
      </div>

      <div className="px-3 pb-3 pt-2">
        {loading ? (
          <div
            className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800"
            aria-busy="true"
            aria-label="Loading users"
          >
            <div className="h-8 animate-pulse bg-slate-100 dark:bg-slate-800/80" />
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-9 border-t border-slate-100 animate-pulse bg-slate-50/90 dark:border-slate-800 dark:bg-slate-900/50"
              />
            ))}
          </div>
        ) : managedUsers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-12 text-center dark:border-slate-700 dark:bg-slate-900/20">
            <p className="text-sm text-slate-600 dark:text-slate-400">No users yet.</p>
            <Link
              href="/users/new"
              className="mt-2 inline-flex text-sm font-medium text-sky-700 underline decoration-sky-300/80 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200"
            >
              Create the first user
            </Link>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-100 dark:border-slate-800">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/95 text-left dark:border-slate-800 dark:bg-slate-900/80">
                  <th className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    User
                  </th>
                  <th className="hidden whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell dark:text-slate-400">
                    Status
                  </th>
                  <th className="min-w-32 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Roles
                  </th>
                  <th className="w-0 whitespace-nowrap px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {managedUsers.map((u) => (
                  <Fragment key={u.id}>
                    <tr
                      className={`border-b border-slate-100 transition-colors last:border-b-0 dark:border-slate-800/80 ${
                        u.isActive
                          ? "hover:bg-slate-50/90 dark:hover:bg-slate-900/40"
                          : "bg-slate-50/50 hover:bg-slate-50/90 dark:bg-slate-900/20 dark:hover:bg-slate-900/40"
                      } ${editingUserId === u.id ? "bg-sky-50/50 dark:bg-sky-950/25" : ""}`}
                    >
                      <td className="max-w-[280px] px-3 py-2 align-middle">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {u.displayName || u.email}
                        </div>
                        {u.displayName ? (
                          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {u.email}
                          </div>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap gap-1 sm:hidden">
                          {u.isActive ? (
                            <span className="inline-flex items-center rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 dark:text-emerald-300/95">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-700/60 dark:text-slate-200">
                              Inactive
                            </span>
                          )}
                          {u.mustChangePassword ? (
                            <span className="inline-flex items-center rounded-md bg-sky-500/12 px-1.5 py-0.5 text-[10px] font-medium text-sky-900 dark:text-sky-300/95">
                              New password at login
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="hidden align-middle sm:table-cell">
                        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
                          {u.isActive ? (
                            <span className="inline-flex items-center rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 dark:text-emerald-300/95">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-700/60 dark:text-slate-200">
                              Inactive
                            </span>
                          )}
                          {u.mustChangePassword ? (
                            <span className="inline-flex items-center rounded-md bg-sky-500/12 px-1.5 py-0.5 text-[10px] font-medium text-sky-900 dark:text-sky-300/95">
                              Password change required
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="min-w-0 px-3 py-2 align-middle text-xs leading-snug text-slate-600 dark:text-slate-400">
                        {editingUserId === u.id ? (
                          <span className="italic text-slate-400 dark:text-slate-500">Editing…</span>
                        ) : (
                          <span className="wrap-break-word">{roleSummary(u.roles)}</span>
                        )}
                      </td>
                      <td className="relative px-3 py-2 align-middle text-right">
                        <details className="group relative inline-block text-left">
                          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 marker:hidden dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden">
                            Actions
                            <svg className="h-3 w-3 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                            </svg>
                          </summary>
                          <div className="absolute right-0 z-20 mt-1 min-w-42 rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-950 dark:ring-white/10">
                            {editingUserId !== u.id ? (
                              <button
                                type="button"
                                className="flex w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900"
                                onClick={(e) => {
                                  closeDetailsMenu(e);
                                  startEditUser(u);
                                }}
                              >
                                Edit roles
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="flex w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900"
                              onClick={(e) => {
                                closeDetailsMenu(e);
                                openResetPassword(u);
                              }}
                            >
                              Reset password
                            </button>
                            {u.isActive ? (
                              u.id !== currentUserId ? (
                                <button
                                  type="button"
                                  className="flex w-full px-3 py-1.5 text-left text-xs text-amber-900 hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-950/50"
                                  onClick={(e) => {
                                    closeDetailsMenu(e);
                                    void setUserActive(u, false);
                                  }}
                                >
                                  Disable account
                                </button>
                              ) : (
                                <div
                                  className="cursor-default px-3 py-1.5 text-xs text-slate-400 dark:text-slate-500"
                                  title="You cannot disable your own account"
                                >
                                  Can&apos;t disable your own account
                                </div>
                              )
                            ) : (
                              <button
                                type="button"
                                className="flex w-full px-3 py-1.5 text-left text-xs font-medium text-emerald-800 hover:bg-emerald-50 dark:text-emerald-200 dark:hover:bg-emerald-950/40"
                                onClick={(e) => {
                                  closeDetailsMenu(e);
                                  void setUserActive(u, true);
                                }}
                              >
                                Enable account
                              </button>
                            )}
                          </div>
                        </details>
                      </td>
                    </tr>
                    {editingUserId === u.id ? (
                      <tr className="border-b border-slate-100 bg-slate-50/80 last:border-b-0 dark:border-slate-800 dark:bg-slate-900/50">
                        <td colSpan={4} className="border-l-2 border-sky-500/70 px-3 py-2.5 pl-[calc(0.75rem+2px)] dark:border-sky-500/50">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Role assignment
                          </p>
                          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                            {roles.map((role) => {
                              const checked = editingRoles.includes(role.code);
                              return (
                                <label
                                  key={`${u.id}-${role.code}`}
                                  className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200/90 bg-white px-2 py-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"
                                >
                                  <input
                                    type="checkbox"
                                    disabled={savingRoles}
                                    checked={checked}
                                    onChange={() => toggleEditingRole(role.code)}
                                    className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                  />
                                  <span className="min-w-0">
                                    <span className="font-medium">{role.name}</span>
                                    <span className="ml-1 text-[10px] text-slate-400">{role.code}</span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={savingRoles || editingRoles.length === 0}
                              onClick={() => void saveUserRoles(u.id)}
                              className="h-7 rounded-md bg-slate-900 px-2.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                            >
                              {savingRoles ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              disabled={savingRoles}
                              onClick={cancelEditUser}
                              className="h-7 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {resetModal}
      <ResponseModal
        open={!!error}
        onClose={() => setError(null)}
        message={error ?? ""}
        variant="error"
      />
    </section>
  );
}
