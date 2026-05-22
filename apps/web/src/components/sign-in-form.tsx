"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ResponseModal } from "@/components/response-modal";
import { setSession } from "@/lib/auth-storage";
import { apiBase } from "@/lib/config";
import { userNeedsRoleSelection } from "@/lib/role-selection";
import {
  authInputClass,
  authLabelClass,
  authSubmitClass,
} from "@/lib/auth-styles";

/** Same as `SEED_ADMIN_*` in `apps/api/.env.example` — local dev only. */
const DEFAULT_DEV_EMAIL = "admin@example.com";
const DEFAULT_DEV_PASSWORD = "ChangeMeAdmin123!";

export type SignInFormProps = {
  /** Extra class on the `<form>`. */
  className?: string;
};

export function SignInForm({ className = "" }: SignInFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState(DEFAULT_DEV_EMAIL);
  const [password, setPassword] = useState(DEFAULT_DEV_PASSWORD);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(
          typeof data.message === "string"
            ? data.message
            : JSON.stringify(data),
        );
        return;
      }
      if (typeof data.access_token === "string") {
        setSession(data.access_token, data.activeRoleCode);
      }
      if (data.mustChangePassword === true) {
        router.push("/change-password");
        return;
      }
      const roles = data.user?.roles ?? [];
      if (userNeedsRoleSelection(roles)) {
        router.push("/choose-role");
        return;
      }
      router.push("/delivery-notes");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className={`space-y-4 ${className}`}>
        <div>
          <label htmlFor="signin-email" className={authLabelClass}>
            Email
          </label>
          <input
            id="signin-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClass}
          />
        </div>
        <div>
          <label htmlFor="signin-password" className={authLabelClass}>
            Password
          </label>
          <input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className={authSubmitClass}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <ResponseModal
        open={!!message}
        onClose={() => setMessage(null)}
        message={message ?? ""}
        variant="error"
        title="Sign in failed"
      />
    </div>
  );
}
