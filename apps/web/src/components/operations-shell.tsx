"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  clearSession,
  getAccessToken,
  getActiveRoleCode,
  setSession,
} from "@/lib/auth-storage";
import { apiBase } from "@/lib/config";
import { formatApiErrorPayload } from "@/lib/api-error";
import { formatDnStatusLabel } from "@/lib/dn-status";
import {
  canSeeCustomersNav,
  canSeeImportNav,
  canUseCircleCount,
  canUseDataImport,
  canUseShippingIdsImport,
} from "@/lib/import-access";
import {
  RoleSwitchModal,
  type RoleSwitchFeedback,
} from "@/components/role-switch-modal";

const SIDEBAR_COLLAPSED_KEY = "ds_sidebar_collapsed";
const NAV_EXPAND_IMPORTER_KEY = "ds_nav_expanded_importer";
const NAV_EXPAND_USERS_KEY = "ds_nav_expanded_users";
const NAV_EXPAND_ACCESS_KEY = "ds_nav_expanded_access_control";
const NAV_EXPAND_SETTINGS_KEY = "ds_nav_expanded_settings";

function readBool(key: string, defaultVal: boolean): boolean {
  if (typeof window === "undefined") return defaultVal;
  const v = window.localStorage.getItem(key);
  if (v === null) return defaultVal;
  return v === "1" || v === "true";
}

function writeBool(key: string, val: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, val ? "1" : "0");
}

function isDeliveryNotesPath(path: string) {
  return path === "/delivery-notes" || path.startsWith("/delivery-notes/");
}

function isImportHistoryPath(path: string) {
  return (
    path.startsWith("/import/revert") || path.startsWith("/import/report/")
  );
}

function isUserMgmtPath(path: string) {
  return path === "/users" || path.startsWith("/users/");
}

function isAccessControlPath(path: string) {
  return path.startsWith("/access-control");
}

function isSettingsPath(path: string) {
  return path.startsWith("/settings");
}

function isDeliveryNotesListColumnsSettingsPath(path: string) {
  return (
    path === "/settings/delivery-notes" ||
    path.startsWith("/settings/delivery-notes/")
  );
}

function isDnCombinationRulesSettingsPath(path: string) {
  return path === "/settings/dn-combination-rules";
}

function isCarrierRatesSettingsPath(path: string) {
  return path === "/settings/carrier-rates";
}

type MeUserRole = { code: string; name: string };

type MeSnapshot = {
  displayName: string | null;
  email: string;
  roles: MeUserRole[];
  activeRoleCode: string | null;
};

function accountPrimaryLabel(me: MeSnapshot): string {
  const n = me.displayName?.trim();
  if (n) return n;
  return me.email || "Account";
}

function accountInitials(label: string): string {
  const t = label.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]!.slice(0, 1) + parts[1]!.slice(0, 1)).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

function activeRoleDisplay(me: MeSnapshot): string {
  const code = (me.activeRoleCode ?? "").trim().toUpperCase();
  if (!code) return "Role";
  const row = me.roles.find((r) => r.code.trim().toUpperCase() === code);
  if (row?.name) return `${row.name} · ${row.code}`;
  return code;
}

function closeAccountDetails(e: React.MouseEvent<HTMLElement>) {
  const root = e.currentTarget.closest("details");
  if (root) root.open = false;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-[var(--app-sidebar-muted)] transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function AccountMenu({
  me,
  meLoading,
  roleLabelFallback,
  roleSwitchCode,
  switchActiveRole,
  onSignOut,
  variant,
}: {
  me: MeSnapshot | null;
  meLoading: boolean;
  roleLabelFallback: string | null;
  roleSwitchCode: string | null;
  switchActiveRole: (code: string) => void | Promise<void>;
  onSignOut: () => void;
  variant: "mobile" | "desktop";
}) {
  const primary = me
    ? accountPrimaryLabel(me)
    : meLoading
      ? "…"
      : "Account";
  const initials = accountInitials(primary === "…" ? "?" : primary);
  const subline = me
    ? activeRoleDisplay(me)
    : meLoading
      ? "Loading profile…"
      : roleLabelFallback
        ? roleLabelFallback.toUpperCase()
        : "Signed in";

  const menuClass =
    "absolute right-0 z-[70] mt-1 w-[min(calc(100vw-1.25rem),18rem)] rounded-xl border border-slate-200/95 bg-white py-2 text-left shadow-lg ring-1 ring-slate-900/5 dark:border-slate-700 dark:bg-slate-950 dark:ring-white/10 " +
    (variant === "mobile" ? "origin-top-right" : "origin-top-right");

  return (
    <details className="relative shrink-0">
      <summary
        className={
          "list-none marker:hidden flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200/90 bg-white text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:hover:border-slate-500 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden " +
          (variant === "mobile"
            ? "h-10 w-10 justify-center px-0 py-0"
            : "max-w-[min(100%,20rem)] py-1.5 pl-1.5 pr-2.5")
        }
        aria-label="Account menu"
      >
        <span
          className={
            "flex shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[11px] font-semibold uppercase text-white dark:bg-slate-100 dark:text-slate-900 " +
            (variant === "mobile" ? "h-8 w-8" : "h-9 w-9")
          }
        >
          {initials}
        </span>
        {variant === "desktop" ? (
          <span className="min-w-0 flex-1 pr-1">
            <span className="block truncate text-sm font-semibold leading-tight text-slate-900 dark:text-slate-100">
              {primary}
            </span>
            <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {subline}
            </span>
          </span>
        ) : null}
        {variant === "desktop" ? (
          <svg
            className="h-4 w-4 shrink-0 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        ) : null}
      </summary>
      <div className={menuClass} onClick={(e) => e.stopPropagation()}>
        {me ? (
          <div className="border-b border-slate-100 px-3 pb-2 dark:border-slate-800">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {accountPrimaryLabel(me)}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{me.email}</p>
            <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
              Active: {activeRoleDisplay(me)}
            </p>
          </div>
        ) : (
          <div className="border-b border-slate-100 px-3 pb-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {meLoading ? "Loading account…" : "Session"}
          </div>
        )}

        {me && me.roles.length > 1 ? (
          <div className="border-b border-slate-100 py-2 dark:border-slate-800">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Switch role
            </p>
            <ul className="max-h-48 overflow-y-auto">
              {me.roles.map((r) => {
                const current =
                  r.code.trim().toUpperCase() ===
                  (me.activeRoleCode ?? "").trim().toUpperCase();
                return (
                  <li key={r.code}>
                    <button
                      type="button"
                      disabled={current || roleSwitchCode !== null}
                      onClick={(e) => {
                        closeAccountDetails(e);
                        void switchActiveRole(r.code);
                      }}
                      className={
                        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition " +
                        (current
                          ? "cursor-default bg-slate-50 font-medium text-slate-800 dark:bg-slate-900/80 dark:text-slate-100"
                          : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900/60")
                      }
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{r.name}</span>
                        <span className="ml-1.5 text-[10px] text-slate-400">{r.code}</span>
                      </span>
                      {roleSwitchCode === r.code ? (
                        <span className="shrink-0 text-[10px] font-medium text-[var(--app-brand)]">
                          Switching…
                        </span>
                      ) : current ? (
                        <span className="shrink-0 text-[10px] font-medium text-sky-700 dark:text-sky-400">
                          Current
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="pt-1">
          <Link
            href="/change-password"
            className="block px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900/60"
            onClick={(e) => closeAccountDetails(e)}
          >
            Change password
          </Link>
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            onClick={(e) => {
              closeAccountDetails(e);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </details>
  );
}

export function OperationsShell({
  title,
  subtitle,
  headerActions,
  contentDensity = "default",
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerActions?: React.ReactNode;
  /** Tighter page header and main padding (e.g. delivery note detail). */
  contentDensity?: "default" | "compact";
  children: React.ReactNode;
}) {
  const compact = contentDensity === "compact";
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [role, setRole] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openImporter, setOpenImporter] = useState(true);
  const [openUsers, setOpenUsers] = useState(true);
  const [openAccess, setOpenAccess] = useState(true);
  const [openSettings, setOpenSettings] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [me, setMe] = useState<MeSnapshot | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [roleSwitchCode, setRoleSwitchCode] = useState<string | null>(null);
  const [roleSwitchFeedback, setRoleSwitchFeedback] =
    useState<RoleSwitchFeedback | null>(null);

  const loadMe = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    setMeLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const d = (await res.json()) as {
        mustChangePassword?: boolean;
        activeRoleCode?: string | null;
        user?: {
          displayName?: string | null;
          email?: string;
          roles?: MeUserRole[];
        };
      };
      if (d.mustChangePassword) {
        router.replace("/change-password");
        return;
      }
      const roles = Array.isArray(d.user?.roles) ? d.user!.roles! : [];
      const activeRoleCode =
        typeof d.activeRoleCode === "string" ? d.activeRoleCode : null;
      setMe({
        displayName:
          typeof d.user?.displayName === "string" ? d.user.displayName : null,
        email: typeof d.user?.email === "string" ? d.user.email : "",
        roles,
        activeRoleCode,
      });
      if (activeRoleCode) {
        setRole(activeRoleCode);
        setSession(token, activeRoleCode);
      }
    } catch {
      /* Network error (API down, CORS, wrong NEXT_PUBLIC_API_URL) */
      setMe(null);
    } finally {
      setMeLoading(false);
    }
  }, [router]);

  useEffect(() => {
    setRole(getActiveRoleCode());
    setSidebarCollapsed(readBool(SIDEBAR_COLLAPSED_KEY, false));
    setOpenImporter(readBool(NAV_EXPAND_IMPORTER_KEY, true));
    setOpenUsers(readBool(NAV_EXPAND_USERS_KEY, true));
    setOpenAccess(readBool(NAV_EXPAND_ACCESS_KEY, true));
    setOpenSettings(readBool(NAV_EXPAND_SETTINGS_KEY, true));
  }, []);

  useEffect(() => {
    if (pathname.startsWith("/import")) {
      setOpenImporter(true);
      writeBool(NAV_EXPAND_IMPORTER_KEY, true);
    }
    if (isUserMgmtPath(pathname)) {
      setOpenUsers(true);
      writeBool(NAV_EXPAND_USERS_KEY, true);
    }
    if (isAccessControlPath(pathname)) {
      setOpenAccess(true);
      writeBool(NAV_EXPAND_ACCESS_KEY, true);
    }
    if (isSettingsPath(pathname)) {
      setOpenSettings(true);
      writeBool(NAV_EXPAND_SETTINGS_KEY, true);
    }
  }, [pathname]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (!roleSwitchFeedback) return;
    const t = window.setTimeout(() => setRoleSwitchFeedback(null), 6000);
    return () => window.clearTimeout(t);
  }, [roleSwitchFeedback]);

  const switchActiveRole = useCallback(
    async (roleCode: string) => {
      const token = getAccessToken();
      if (!token) return;
      setRoleSwitchFeedback(null);
      setRoleSwitchCode(roleCode);
      const picked = (me?.roles ?? []).find(
        (r) => r.code.trim().toUpperCase() === roleCode.trim().toUpperCase(),
      );
      const roleName = picked?.name ?? roleCode;
      const roleCodeNorm = picked?.code ?? roleCode;
      try {
        const res = await fetch(`${apiBase}/auth/active-role`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ roleCode }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          access_token?: string;
          activeRoleCode?: string;
        };
        if (res.status === 401) {
          clearSession();
          router.replace("/login");
          return;
        }
        if (!res.ok) {
          const apiMsg = formatApiErrorPayload(data);
          setRoleSwitchFeedback({
            ok: false,
            roleName,
            roleCode: roleCodeNorm,
            detail: apiMsg || "Request failed.",
          });
          return;
        }
        if (typeof data.access_token === "string") {
          setSession(data.access_token, data.activeRoleCode);
        }
        await loadMe();
        router.refresh();
        setRoleSwitchFeedback({
          ok: true,
          roleName,
          roleCode: roleCodeNorm,
        });
      } catch {
        setRoleSwitchFeedback({
          ok: false,
          roleName,
          roleCode: roleCodeNorm,
          detail: "Network error.",
        });
      } finally {
        setRoleSwitchCode(null);
      }
    },
    [loadMe, me?.roles, router],
  );

  const toggleCollapsed = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c;
      writeBool(SIDEBAR_COLLAPSED_KEY, next);
      return next;
    });
  }, []);

  const roleCanManageUsers =
    role != null && ["SUPERVISOR", "SYSTEM"].includes(role.toUpperCase());
  const roleCanDailyImport = canUseDataImport(role);
  const roleCanShippingIdsImport = canUseShippingIdsImport(role);
  const roleCanImport = canSeeImportNav(role);
  const roleCanCustomers = canSeeCustomersNav(role);
  const roleCanCircleCount = canUseCircleCount(role);

  function leafClass(active: boolean, collapsed: boolean) {
    const base =
      "flex items-center gap-2 rounded-lg py-2 text-sm font-medium transition md:px-2.5 " +
      (collapsed ? "md:justify-center md:px-1.5" : "");
    if (active) {
      return (
        base +
        " bg-[var(--app-sidebar-active)] text-white shadow-sm"
      );
    }
    return (
      base +
      " text-[var(--app-sidebar-muted)] hover:bg-[var(--app-sidebar-hover)] hover:text-[var(--app-sidebar-fg)]"
    );
  }

  function navGroupButtonClass(collapsed: boolean) {
    return (
      "flex w-full items-center gap-2 rounded-lg py-2 text-left text-sm font-semibold text-[var(--app-sidebar-muted)] hover:bg-[var(--app-sidebar-hover)] hover:text-[var(--app-sidebar-fg)] md:px-2.5 " +
      (collapsed ? "md:justify-center md:px-1" : "")
    );
  }

  function navSubBorderClass(collapsed: boolean) {
    return (
      "mt-0.5 space-y-0.5 border-l border-[var(--app-sidebar-border)] pl-2 " +
      (collapsed ? "ml-2 md:ml-3" : "ml-3")
    );
  }

  function navIconBadgeClass() {
    return "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-[11px] font-bold text-[var(--app-sidebar-fg)]";
  }

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  return (
    <div className="min-h-screen bg-(--app-canvas) text-[var(--app-fg)]">
      <RoleSwitchModal
        feedback={roleSwitchFeedback}
        onClose={() => setRoleSwitchFeedback(null)}
      />
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-[3.25rem] items-center justify-between gap-2 border-b border-[var(--app-sidebar-border)] bg-[var(--app-sidebar-bg)] px-3 print:hidden md:hidden">
        <button
          type="button"
          aria-expanded={mobileNavOpen}
          aria-controls="operations-mobile-drawer"
          onClick={() => setMobileNavOpen((o) => !o)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--app-sidebar-border)] bg-white/10 text-[var(--app-sidebar-fg)]"
        >
          <span className="sr-only">Open menu</span>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
          </svg>
        </button>
        <Link href="/delivery-notes" className="truncate text-center">
          <Image
            src="/delta-controls-logo.png"
            alt="Delta Controls"
            width={120}
            height={28}
            className="mx-auto h-7 w-auto max-w-[9.5rem] object-contain object-center"
            priority
          />
        </Link>
        <AccountMenu
          me={me}
          meLoading={meLoading}
          roleLabelFallback={role}
          roleSwitchCode={roleSwitchCode}
          switchActiveRole={switchActiveRole}
          onSignOut={() => {
            clearSession();
            router.push("/login");
          }}
          variant="mobile"
        />
      </header>

      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-slate-900/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 md:min-h-screen">
        <aside
          id="operations-mobile-drawer"
          className={
            "fixed inset-y-0 left-0 z-50 flex w-[min(17.5rem,88vw)] flex-col border-r border-[var(--app-sidebar-border)] bg-[var(--app-sidebar-bg)] text-[var(--app-sidebar-fg)] shadow-xl transition-transform duration-200 ease-out print:hidden md:static md:z-0 md:min-h-screen md:translate-x-0 md:shadow-none " +
            (sidebarCollapsed ? "md:w-[4.25rem]" : "md:w-56") +
            " " +
            (mobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0")
          }
        >

          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--app-sidebar-border)] px-2 md:px-2.5">
            <Link
              href="/delivery-notes"
              onClick={closeMobileNav}
              className="group flex min-w-0 flex-1 items-center truncate"
              title="Delta Controls — Shipping"
            >
              {sidebarCollapsed ? (
                <span
                  className="mx-auto text-lg font-bold text-[var(--app-brand)]"
                  aria-hidden
                >
                  Δ
                </span>
              ) : (
                <Image
                  src="/delta-controls-logo.png"
                  alt="Delta Controls"
                  width={140}
                  height={32}
                  className="h-8 w-auto max-w-[10.5rem] object-contain object-left"
                  priority
                />
              )}
            </Link>
            <button
              type="button"
              onClick={toggleCollapsed}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!sidebarCollapsed}
              className="hidden shrink-0 rounded-lg border border-[var(--app-sidebar-border)] bg-white/10 px-2 py-1.5 text-xs font-medium text-[var(--app-sidebar-muted)] hover:bg-[var(--app-sidebar-hover)] hover:text-[var(--app-sidebar-fg)] md:inline-flex md:items-center md:gap-1"
            >
              <span aria-hidden>{sidebarCollapsed ? "»" : "«"}</span>
              {!sidebarCollapsed ? <span>Collapse</span> : null}
            </button>
          </div>

          <div className="flex h-12 items-center justify-between border-b border-[var(--app-sidebar-border)] px-3 md:hidden">
            <span className="text-sm font-semibold text-[var(--app-sidebar-fg)]">Menu</span>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="rounded-lg p-2 text-[var(--app-sidebar-muted)] hover:text-[var(--app-sidebar-fg)]"
              aria-label="Close menu"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2" aria-label="Main">
            <Link
              href="/delivery-notes"
              onClick={closeMobileNav}
              title="Delivery notes"
              aria-current={isDeliveryNotesPath(pathname) ? "page" : undefined}
              className={leafClass(isDeliveryNotesPath(pathname), sidebarCollapsed)}
            >
              <span className={navIconBadgeClass()}>DN</span>
              {!sidebarCollapsed ? <span>Delivery notes</span> : null}
            </Link>

            {roleCanCircleCount ? (
              <Link
                href="/circle-count"
                onClick={closeMobileNav}
                title="Circle Count"
                aria-current={pathname === "/circle-count" ? "page" : undefined}
                className={leafClass(pathname === "/circle-count", sidebarCollapsed)}
              >
                <span className={navIconBadgeClass()}>CC</span>
                {!sidebarCollapsed ? <span>Circle Count</span> : null}
              </Link>
            ) : null}

            {roleCanCustomers ? (
              <Link
                href="/customers"
                onClick={closeMobileNav}
                title="Customers"
                aria-current={
                  pathname === "/customers" || pathname.startsWith("/customers/")
                    ? "page"
                    : undefined
                }
                className={leafClass(
                  pathname === "/customers" ||
                    pathname.startsWith("/customers/"),
                  sidebarCollapsed,
                )}
              >
                <span className={navIconBadgeClass()}>CU</span>
                {!sidebarCollapsed ? <span>Customers</span> : null}
              </Link>
            ) : null}

            {roleCanImport ? (
            <div className="pt-1">
              <button
                type="button"
                title="Data import"
                aria-expanded={openImporter}
                onClick={() => {
                  setOpenImporter((o) => {
                    const next = !o;
                    writeBool(NAV_EXPAND_IMPORTER_KEY, next);
                    return next;
                  });
                }}
                className={
                  navGroupButtonClass(sidebarCollapsed)
                }
              >
                <Chevron open={openImporter} />
                {!sidebarCollapsed ? <span>Data import</span> : <span className="sr-only">Data import</span>}
              </button>
              {openImporter ? (
                <div
                  className={
                    navSubBorderClass(sidebarCollapsed)
                  }
                >
                  {roleCanDailyImport ? (
                    <Link
                      href="/import"
                      onClick={closeMobileNav}
                      title="Daily DN import"
                      aria-current={pathname === "/import" ? "page" : undefined}
                      className={leafClass(pathname === "/import", sidebarCollapsed)}
                    >
                      {!sidebarCollapsed ? (
                        <span className="pl-1">Daily DN import</span>
                      ) : (
                        <span className={`${navIconBadgeClass()} text-xs`} title="Daily DN import">
                          +
                        </span>
                      )}
                    </Link>
                  ) : null}
                  {roleCanShippingIdsImport ? (
                    <Link
                      href="/import/shipping-ids"
                      onClick={closeMobileNav}
                      title="Shipping IDs"
                      aria-current={
                        pathname === "/import/shipping-ids" ? "page" : undefined
                      }
                      className={leafClass(
                        pathname === "/import/shipping-ids",
                        sidebarCollapsed,
                      )}
                    >
                      {!sidebarCollapsed ? (
                        <span className="pl-1">Shipping IDs</span>
                      ) : (
                        <span
                          className={`${navIconBadgeClass()} text-xs`}
                          title="Shipping IDs"
                        >
                          ID
                        </span>
                      )}
                    </Link>
                  ) : null}
                  <Link
                    href="/import/revert"
                    onClick={closeMobileNav}
                    title="Past Imports"
                    aria-current={isImportHistoryPath(pathname) ? "page" : undefined}
                    className={leafClass(isImportHistoryPath(pathname), sidebarCollapsed)}
                  >
                    {!sidebarCollapsed ? (
                      <span className="pl-1">Past Imports</span>
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200" title="Past Imports">
                        H
                      </span>
                    )}
                  </Link>
                </div>
              ) : null}
            </div>
            ) : null}

            {roleCanManageUsers ? (
              <div className="pt-1">
                <button
                  type="button"
                  title="User management"
                  aria-expanded={openUsers}
                  onClick={() => {
                    setOpenUsers((o) => {
                      const next = !o;
                      writeBool(NAV_EXPAND_USERS_KEY, next);
                      return next;
                    });
                  }}
                  className={navGroupButtonClass(sidebarCollapsed)}
                >
                  <Chevron open={openUsers} />
                  {!sidebarCollapsed ? (
                    <span>User management</span>
                  ) : (
                    <span className="sr-only">User management</span>
                  )}
                </button>
                {openUsers ? (
                  <div className={navSubBorderClass(sidebarCollapsed)}>
                    <Link
                      href="/users/new"
                      onClick={closeMobileNav}
                      title="Create user"
                      aria-current={pathname === "/users/new" ? "page" : undefined}
                      className={leafClass(pathname === "/users/new", sidebarCollapsed)}
                    >
                      {!sidebarCollapsed ? (
                        <span className="pl-1">Create user</span>
                      ) : (
                        <span className={`${navIconBadgeClass()} text-xs`} title="Create user">
                          +
                        </span>
                      )}
                    </Link>
                    <Link
                      href="/users"
                      onClick={closeMobileNav}
                      title="Managed users"
                      aria-current={pathname === "/users" ? "page" : undefined}
                      className={leafClass(pathname === "/users", sidebarCollapsed)}
                    >
                      {!sidebarCollapsed ? (
                        <span className="pl-1">Managed users</span>
                      ) : (
                        <span className={`${navIconBadgeClass()} text-xs`} title="Managed users">
                          #
                        </span>
                      )}
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : null}

            {roleCanManageUsers ? (
              <div className="pt-1">
                <button
                  type="button"
                  title="Access control"
                  aria-expanded={openAccess}
                  onClick={() => {
                    setOpenAccess((o) => {
                      const next = !o;
                      writeBool(NAV_EXPAND_ACCESS_KEY, next);
                      return next;
                    });
                  }}
                  className={navGroupButtonClass(sidebarCollapsed)}
                >
                  <Chevron open={openAccess} />
                  {!sidebarCollapsed ? (
                    <span>Access control</span>
                  ) : (
                    <span className="sr-only">Access control</span>
                  )}
                </button>
                {openAccess ? (
                  <div className={navSubBorderClass(sidebarCollapsed)}>
                    <Link
                      href="/access-control/permissions"
                      onClick={closeMobileNav}
                      title="All permissions"
                      aria-current={
                        pathname === "/access-control/permissions"
                          ? "page"
                          : undefined
                      }
                      className={leafClass(
                        pathname === "/access-control/permissions",
                        sidebarCollapsed,
                      )}
                    >
                      {!sidebarCollapsed ? (
                        <span className="pl-1">All permissions</span>
                      ) : (
                        <span className={`${navIconBadgeClass()} text-xs`} title="All permissions">
                          P
                        </span>
                      )}
                    </Link>
                    <Link
                      href="/access-control/role-matrix"
                      onClick={closeMobileNav}
                      title="Role matrix"
                      aria-current={
                        pathname === "/access-control/role-matrix"
                          ? "page"
                          : undefined
                      }
                      className={leafClass(
                        pathname === "/access-control/role-matrix",
                        sidebarCollapsed,
                      )}
                    >
                      {!sidebarCollapsed ? (
                        <span className="pl-1">Role matrix</span>
                      ) : (
                        <span className={`${navIconBadgeClass()} text-xs`} title="Role matrix">
                          M
                        </span>
                      )}
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="pt-1">
              <button
                type="button"
                title="Settings"
                aria-expanded={openSettings}
                onClick={() => {
                  setOpenSettings((o) => {
                    const next = !o;
                    writeBool(NAV_EXPAND_SETTINGS_KEY, next);
                    return next;
                  });
                }}
                className={
                  navGroupButtonClass(sidebarCollapsed)
                }
              >
                <Chevron open={openSettings} />
                {!sidebarCollapsed ? (
                  <span>Settings</span>
                ) : (
                  <span className="sr-only">Settings</span>
                )}
              </button>
              {openSettings ? (
                <div
                  className={
                    navSubBorderClass(sidebarCollapsed)
                  }
                >
                  <Link
                    href="/settings/delivery-notes"
                    onClick={closeMobileNav}
                    title="DN list columns"
                    aria-current={
                      isDeliveryNotesListColumnsSettingsPath(pathname)
                        ? "page"
                        : undefined
                    }
                    className={leafClass(
                      isDeliveryNotesListColumnsSettingsPath(pathname),
                      sidebarCollapsed,
                    )}
                  >
                    {!sidebarCollapsed ? (
                      <span className="pl-1">DN list columns</span>
                    ) : (
                      <span
                        className={navIconBadgeClass()}
                        title="DN list columns"
                      >
                        L
                      </span>
                    )}
                  </Link>
                  {roleCanManageUsers ? (
                    <Link
                      href="/settings/dn-combination-rules"
                      onClick={closeMobileNav}
                      title="DNs combination rules"
                      aria-current={
                        isDnCombinationRulesSettingsPath(pathname)
                          ? "page"
                          : undefined
                      }
                      className={leafClass(
                        isDnCombinationRulesSettingsPath(pathname),
                        sidebarCollapsed,
                      )}
                    >
                      {!sidebarCollapsed ? (
                        <span className="pl-1">DNs combination rules</span>
                      ) : (
                        <span
                          className={navIconBadgeClass()}
                          title="DNs combination rules"
                        >
                          C
                        </span>
                      )}
                    </Link>
                  ) : null}
                  {roleCanManageUsers ? (
                    <Link
                      href="/settings/carrier-rates"
                      onClick={closeMobileNav}
                      title="Carrier rates"
                      aria-current={
                        isCarrierRatesSettingsPath(pathname)
                          ? "page"
                          : undefined
                      }
                      className={leafClass(
                        isCarrierRatesSettingsPath(pathname),
                        sidebarCollapsed,
                      )}
                    >
                      {!sidebarCollapsed ? (
                        <span className="pl-1">Carrier rates</span>
                      ) : (
                        <span
                          className={navIconBadgeClass()}
                          title="Carrier rates"
                        >
                          R
                        </span>
                      )}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:min-h-screen">
          <header className="relative z-30 hidden border-b border-[var(--app-border)] bg-[var(--app-surface)]/80 px-6 py-3 backdrop-blur-sm md:block">
            <div className="flex items-center justify-end">
              <AccountMenu
                me={me}
                meLoading={meLoading}
                roleLabelFallback={role}
                roleSwitchCode={roleSwitchCode}
                switchActiveRole={switchActiveRole}
                onSignOut={() => {
                  clearSession();
                  router.push("/login");
                }}
                variant="desktop"
              />
            </div>
          </header>

          {(title || subtitle || headerActions) && (
            <div className="shrink-0 border-b border-[var(--app-border)] bg-linear-to-b from-white/90 to-transparent dark:from-slate-950/90 dark:to-transparent">
              <div
                className={
                  compact
                    ? "px-4 py-2.5 sm:px-6 sm:py-3"
                    : "px-4 py-5 sm:px-6 sm:py-7"
                }
              >
                <div
                  className={
                    compact
                      ? "flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between"
                      : "flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
                  }
                >
                  <div className="min-w-0 flex-1">
                    {title ? (
                      <h1
                        className={
                          compact
                            ? "flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 sm:text-[1.35rem]"
                            : "flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 sm:text-[1.65rem]"
                        }
                      >
                        <span
                          className={
                            compact
                              ? "mt-0.5 size-0 shrink-0 border-y-[4px] border-l-[7px] border-y-transparent border-l-[var(--app-brand)]"
                              : "mt-0.5 size-0 shrink-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-[var(--app-brand)]"
                          }
                          aria-hidden
                        />
                        <span className="min-w-0">{title}</span>
                      </h1>
                    ) : null}
                    {subtitle ? (
                      <div
                        className={
                          compact
                            ? "mt-1 max-w-3xl text-xs leading-snug text-slate-600 dark:text-slate-400"
                            : "mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400"
                        }
                      >
                        {subtitle}
                      </div>
                    ) : null}
                  </div>
                  {headerActions ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                      {headerActions}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          <div
            className={
              compact
                ? "mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 flex-col px-4 pb-6 pt-2 sm:px-6 sm:pt-3"
                : "mx-auto w-full max-w-[110rem] flex-1 px-4 pb-12 pt-5 sm:px-6 sm:pt-6"
            }
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Workflow status chip for detail screens */
export function StatusBadge({
  status,
  isOpen,
}: {
  status: string;
  isOpen?: boolean;
}) {
  const cls =
    isOpen === true
      ? "border-emerald-200/90 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300"
      : isOpen === false
        ? "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400"
        : "border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {formatDnStatusLabel(status)}
    </span>
  );
}
