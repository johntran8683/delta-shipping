export type MatrixPermission = {
  id: string;
  code: string;
  description: string;
  category: string;
  assignable: boolean;
  critical: boolean;
  sortOrder?: number;
};

export type MatrixCategory = {
  id: string;
  label: string;
  sortOrder: number;
};

export type MatrixRole = {
  id: string;
  code: string;
  name: string;
  bypassApiMatrix: boolean;
  defaultPermissionCodes: string[];
  permissionCodes: string[];
};

export function codesEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export function groupPermissionsByCategory(
  permissions: MatrixPermission[],
  categories: MatrixCategory[],
): { category: MatrixCategory; permissions: MatrixPermission[] }[] {
  const catOrder = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
  return catOrder
    .map((category) => ({
      category,
      permissions: permissions.filter((p) => p.category === category.id),
    }))
    .filter((g) => g.permissions.length > 0);
}

export function filterPermissionsBySearch(
  permissions: MatrixPermission[],
  query: string,
): MatrixPermission[] {
  const q = query.trim().toLowerCase();
  if (!q) return permissions;
  return permissions.filter(
    (p) =>
      p.code.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q),
  );
}

export function describeRiskySave(
  role: MatrixRole,
  baseline: string[],
  next: string[],
): string[] {
  if (role.bypassApiMatrix) return [];
  const reasons: string[] = [];
  const base = new Set(baseline);
  const nxt = new Set(next);

  if (next.length === 0) {
    reasons.push('This role will have no API permissions assigned.');
  }
  if (base.has('dn.read') && !nxt.has('dn.read')) {
    reasons.push(
      'Removing “View delivery notes” (dn.read) blocks list and detail API access for this role.',
    );
  }

  return reasons;
}

export function isRiskySave(
  role: MatrixRole,
  baseline: string[],
  next: string[],
): boolean {
  return describeRiskySave(role, baseline, next).length > 0;
}
