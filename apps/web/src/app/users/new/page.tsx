"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { ResponseModal } from "@/components/response-modal";
import { clearSession, getAccessToken } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import { apiBase } from "@/lib/config";

type RoleRow = {
  code: string;
  name: string;
};

function generateTemporaryPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  for (let i = 0; i < 14; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export default function NewUserPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState(
    generateTemporaryPassword(),
  );
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permHint, setPermHint] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    email: string;
    temporaryPassword: string;
    roles: string[];
  } | null>(null);
  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    void fetch(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d: { activeRoleCode?: string | null; permissions?: string[] }) => {
        const role = (d.activeRoleCode ?? "").toUpperCase();
        const permissions = d.permissions ?? [];
        if (!["SUPERVISOR", "SYSTEM"].includes(role)) {
          setPermHint(
            "User management requires active role SUPERVISOR or SYSTEM.",
          );
        } else if (!permissions.includes("users.manage")) {
          setPermHint("Missing permission users.manage for active role.");
        }
      })
      .catch(() => undefined);

    void fetch(`${apiBase}/users/roles`, {
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
        const items = Array.isArray(body) ? (body as RoleRow[]) : [];
        setRoles(items);
        setSelectedRoles(items.length > 0 ? [items[0]!.code] : []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Request failed"))
      .finally(() => setLoading(false));
  }, [router]);

  const canSubmit = useMemo(
    () =>
      !loading &&
      !submitting &&
      !permHint &&
      email.trim().length > 0 &&
      temporaryPassword.length >= 8 &&
      selectedRoles.length > 0,
    [email, loading, permHint, selectedRoles.length, submitting, temporaryPassword],
  );

  function toggleRole(code: string) {
    setSelectedRoles((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  async function onCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setSubmitting(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch(`${apiBase}/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email,
          displayName: displayName.trim() || undefined,
          temporaryPassword,
          roleCodes: selectedRoles,
        }),
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
      setCreated({
        email: body.user?.email ?? email.trim().toLowerCase(),
        temporaryPassword,
        roles: selectedRoles,
      });
      setEmail("");
      setDisplayName("");
      setTemporaryPassword(generateTemporaryPassword());
      setSelectedRoles(roles.length > 0 ? [roles[0]!.code] : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <OperationsShell title="Create user">
      <div className="mx-auto max-w-xl space-y-3">
        {permHint ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            {permHint}
          </div>
        ) : null}

        <form
          onSubmit={onCreateUser}
          className="space-y-3 rounded-lg border border-slate-200/90 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/80"
        >
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Assign one or more roles. New users are prompted to change password on first sign-in.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="user-email"
                className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
              >
                Email
              </label>
              <input
                id="user-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-white/10"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="display-name"
                className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
              >
                Display name (optional)
              </label>
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-white/10"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="temp-password"
                className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
              >
                Temporary password
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="temp-password"
                  type="text"
                  minLength={8}
                  required
                  value={temporaryPassword}
                  onChange={(e) => setTemporaryPassword(e.target.value)}
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 font-mono text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-white/10"
                />
                <button
                  type="button"
                  onClick={() => setTemporaryPassword(generateTemporaryPassword())}
                  className="h-9 shrink-0 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Generate
                </button>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Roles
            </p>
            {loading ? (
              <p className="text-xs text-slate-500">Loading roles…</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.map((role) => (
                  <label
                    key={role.code}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRoles.includes(role.code)}
                      onChange={() => toggleRole(role.code)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span>
                      {role.name}{" "}
                      <span className="text-xs text-slate-500">{role.code}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="h-9 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {submitting ? "Creating…" : "Create user"}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          <Link
            href="/users"
            className="font-medium text-sky-700 underline decoration-sky-300/80 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200"
          >
            Back to managed users
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
        open={!!created}
        onClose={() => setCreated(null)}
        variant="success"
        title="User created"
        message={
          created
            ? `Share credentials once:\n\nEmail: ${created.email}\nTemporary password: ${created.temporaryPassword}\n\nRoles: ${created.roles.join(", ")}\n\nFirst login requires a password change.`
            : ""
        }
      />
    </OperationsShell>
  );
}
