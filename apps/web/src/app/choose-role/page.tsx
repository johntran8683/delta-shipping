"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { ResponseModal } from "@/components/response-modal";
import { getAccessToken, setSession } from "@/lib/auth-storage";
import { apiBase } from "@/lib/config";
import { userNeedsRoleSelection } from "@/lib/role-selection";

type Role = { code: string; name: string };

export default function ChooseRolePage() {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/");
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(`${apiBase}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || cancelled) {
        if (!cancelled) router.replace("/");
        return;
      }
      const data = await res.json();
      const userRoles: Role[] = data.user?.roles ?? [];
      if (!userNeedsRoleSelection(userRoles)) {
        router.replace("/delivery-notes");
        return;
      }
      if (!cancelled) setRoles(userRoles);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function selectRole(roleCode: string) {
    const token = getAccessToken();
    if (!token) return;
    setLoadingCode(roleCode);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/auth/active-role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roleCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.message === "string"
            ? data.message
            : "Could not activate that role",
        );
        return;
      }
      if (typeof data.access_token === "string") {
        setSession(data.access_token, data.activeRoleCode);
      }
      router.push("/delivery-notes");
    } finally {
      setLoadingCode(null);
    }
  }

  if (roles === null) {
    return (
      <AuthShell title="Choose your role" subtitle="Loading available roles…">
        <p className="text-center text-sm text-slate-500">One moment…</p>
      </AuthShell>
    );
  }

  return (
    <>
      <AuthShell
        title="Choose your role"
        subtitle="Select the role for this session. To switch later, sign out and sign in again."
        width="lg"
      >
        <ul className="space-y-2">
          {roles.map((r) => {
            const busy = loadingCode === r.code;
            const disabled = loadingCode !== null && !busy;
            return (
              <li key={r.code}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void selectRole(r.code)}
                  className="group flex w-full items-center justify-between rounded-lg border border-slate-200/90 bg-white px-4 py-3.5 text-left text-sm transition hover:border-[var(--app-brand)] hover:bg-red-50/40 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950/50 dark:hover:border-[var(--app-brand)] dark:hover:bg-red-950/20"
                >
                  <span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {r.name}
                    </span>
                    <span className="ml-2 font-mono text-xs font-normal text-slate-500">
                      {r.code}
                    </span>
                  </span>
                  <span
                    className={
                      busy
                        ? "text-xs text-slate-500"
                        : "text-[var(--app-brand)] opacity-70 transition group-hover:opacity-100"
                    }
                    aria-hidden
                  >
                    {busy ? "…" : "→"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </AuthShell>

      <ResponseModal
        open={!!error}
        onClose={() => setError(null)}
        message={error ?? ""}
        variant="error"
        title="Could not activate role"
      />
    </>
  );
}
