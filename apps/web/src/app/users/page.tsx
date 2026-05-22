"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { ManagedUsersPanel } from "@/components/managed-users-panel";
import { getAccessToken } from "@/lib/auth-storage";
import { apiBase } from "@/lib/config";

export default function UserListPage() {
  const router = useRouter();
  const [permHint, setPermHint] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

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
        const role = (d.activeRoleCode ?? "").toUpperCase();
        const permissions = d.permissions ?? [];
        if (!["SUPERVISOR", "SYSTEM"].includes(role)) {
          setPermHint(
            "User management requires active role SUPERVISOR or SYSTEM.",
          );
          setCanManage(false);
        } else if (!permissions.includes("users.manage")) {
          setPermHint("Missing permission users.manage for active role.");
          setCanManage(false);
        } else {
          setPermHint(null);
          setCanManage(true);
        }
      })
      .catch(() => undefined);
  }, [router]);

  return (
    <OperationsShell title="Managed users">
      <div className="mx-auto max-w-4xl space-y-3">
        {permHint ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            {permHint}
          </div>
        ) : null}
        <ManagedUsersPanel canManage={canManage} />
      </div>
    </OperationsShell>
  );
}
