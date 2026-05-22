const TOKEN_KEY = "ds_access_token";
const ROLE_KEY = "ds_active_role";

/** Fired when the active role changes (e.g. sidebar role switch). Same-tab only. */
export const ACTIVE_ROLE_CHANGED_EVENT = "ds:active-role-changed";

export type ActiveRoleChangedDetail = {
  previousRoleCode: string;
  activeRoleCode: string;
};

export function setSession(accessToken: string, activeRoleCode?: string) {
  if (typeof window === "undefined") return;
  const previousRoleCode = window.localStorage.getItem(ROLE_KEY);
  window.localStorage.setItem(TOKEN_KEY, accessToken);
  if (activeRoleCode) {
    window.localStorage.setItem(ROLE_KEY, activeRoleCode);
    const prev = (previousRoleCode ?? "").trim().toUpperCase();
    const next = activeRoleCode.trim().toUpperCase();
    if (prev && next !== prev) {
      window.dispatchEvent(
        new CustomEvent<ActiveRoleChangedDetail>(ACTIVE_ROLE_CHANGED_EVENT, {
          detail: {
            previousRoleCode: previousRoleCode!,
            activeRoleCode,
          },
        }),
      );
    }
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ROLE_KEY);
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getActiveRoleCode(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ROLE_KEY);
}
