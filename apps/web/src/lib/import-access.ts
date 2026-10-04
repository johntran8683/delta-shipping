/** Daily DN import: SUPERVISOR and SYSTEM. */
export function canUseDataImport(role: string | null | undefined): boolean {
  const code = role?.trim().toUpperCase();
  return code === "SUPERVISOR" || code === "SYSTEM";
}

/** Shipping IDs import: CSA, SUPERVISOR, SYSTEM. */
export function canUseShippingIdsImport(
  role: string | null | undefined,
): boolean {
  const code = role?.trim().toUpperCase();
  return code === "CSA" || code === "SUPERVISOR" || code === "SYSTEM";
}

/** Show Data import nav group when either import path is available. */
export function canSeeImportNav(role: string | null | undefined): boolean {
  return canUseDataImport(role) || canUseShippingIdsImport(role);
}

/** Customers list/detail nav. */
export function canSeeCustomersNav(role: string | null | undefined): boolean {
  const code = role?.trim().toUpperCase();
  return (
    code === "CSA" ||
    code === "SHIPPER" ||
    code === "SUPERVISOR" ||
    code === "TEAM_LEAD" ||
    code === "SYSTEM"
  );
}

/** Who may flip the per-customer "requires box content" toggle. */
export function canManageBoxContent(role: string | null | undefined): boolean {
  const code = role?.trim().toUpperCase();
  return code === "SUPERVISOR" || code === "TEAM_LEAD" || code === "SYSTEM";
}

export function canWriteCustomers(role: string | null | undefined): boolean {
  const code = role?.trim().toUpperCase();
  return code === "CSA" || code === "SUPERVISOR" || code === "SYSTEM";
}

/** Circle Count nav: every role except CSA. */
export function canUseCircleCount(role: string | null | undefined): boolean {
  const code = role?.trim().toUpperCase();
  return !!code && code !== "CSA";
}
