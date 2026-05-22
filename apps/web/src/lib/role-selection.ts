const ELEVATED_ROLE_CODES = new Set(["SUPERVISOR", "SYSTEM"]);

/**
 * Show chooser only for operational users. If account includes SUPERVISOR or SYSTEM,
 * skip chooser and use default elevated role.
 */
export function userNeedsRoleSelection(roles: { code: string }[]): boolean {
  if (roles.length <= 1) return false;
  const hasElevatedRole = roles.some((r) =>
    ELEVATED_ROLE_CODES.has(r.code.trim().toUpperCase()),
  );
  return !hasElevatedRole;
}
