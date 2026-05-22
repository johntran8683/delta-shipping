/** Daily DN import: SUPERVISOR (operational) and SYSTEM (full access). */
export function canUseDataImport(role: string | null | undefined): boolean {
  const code = role?.trim().toUpperCase();
  return code === "SUPERVISOR" || code === "SYSTEM";
}
