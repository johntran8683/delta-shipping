"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import {
  clearSession,
  getAccessToken,
  setSession,
} from "@/lib/auth-storage";
import { apiBase } from "@/lib/config";
import {
  authInputClass,
  authLabelClass,
  authSubmitClass,
} from "@/lib/auth-styles";
import { ResponseModal } from "@/components/response-modal";
import { userNeedsRoleSelection } from "@/lib/role-selection";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
    }
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof body.message === "string"
            ? body.message
            : "Could not update password.",
        );
        return;
      }

      const meRes = await fetch(`${apiBase}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const me = await meRes.json().catch(() => ({}));
      if (!meRes.ok) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (typeof me.activeRoleCode === "string") {
        setSession(token, me.activeRoleCode);
      }
      const roles = me.user?.roles ?? [];
      if (userNeedsRoleSelection(roles)) {
        router.push("/choose-role");
        return;
      }
      router.push("/delivery-notes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthShell
        title="Change your password"
        subtitle="For security, set a new password before continuing."
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="current-password" className={authLabelClass}>
              Temporary password
            </label>
            <input
              id="current-password"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={authInputClass}
            />
          </div>
          <div>
            <label htmlFor="new-password" className={authLabelClass}>
              New password
            </label>
            <input
              id="new-password"
              type="password"
              minLength={8}
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={authInputClass}
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className={authLabelClass}>
              Confirm new password
            </label>
            <input
              id="confirm-password"
              type="password"
              minLength={8}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={authInputClass}
            />
          </div>
          <button type="submit" disabled={loading} className={authSubmitClass}>
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      </AuthShell>

      <ResponseModal
        open={!!error}
        onClose={() => setError(null)}
        message={error ?? ""}
        variant="error"
        title="Could not update password"
      />
    </>
  );
}
