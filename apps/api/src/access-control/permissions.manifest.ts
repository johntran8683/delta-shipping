/**
 * Single source of truth for permission catalog shown in Access control UI
 * and wired by seed. Only `assignable` permissions appear in the role matrix.
 */
export type PermissionCategoryId =
  | 'delivery_notes'
  | 'shipping'
  | 'customers'
  | 'import'
  | 'administration';

export type PermissionManifestEntry = {
  code: string;
  description: string;
  category: PermissionCategoryId;
  /** Shown in role matrix; supervisors can assign to operational roles. */
  assignable: boolean;
  /** Warn before save when removing from an operational role that had it. */
  critical?: boolean;
  sortOrder: number;
};

export const PERMISSION_CATEGORIES: {
  id: PermissionCategoryId;
  label: string;
  sortOrder: number;
}[] = [
  { id: 'delivery_notes', label: 'Delivery notes', sortOrder: 10 },
  { id: 'shipping', label: 'Shipping', sortOrder: 20 },
  { id: 'customers', label: 'Customers', sortOrder: 25 },
  { id: 'import', label: 'Data import', sortOrder: 30 },
  { id: 'administration', label: 'Administration', sortOrder: 40 },
];

export const PERMISSION_MANIFEST: PermissionManifestEntry[] = [
  {
    code: 'dn.read',
    description: 'View delivery note lists and detail',
    category: 'delivery_notes',
    assignable: true,
    critical: true,
    sortOrder: 10,
  },
  {
    code: 'dn.status.supervise',
    description: 'Supervisor status: prioritize, hold, cancel, resume',
    category: 'delivery_notes',
    assignable: true,
    sortOrder: 20,
  },
  {
    code: 'dn.priority.set',
    description: 'Set or change DN priority',
    category: 'delivery_notes',
    assignable: true,
    sortOrder: 30,
  },
  {
    code: 'dn.rush.set',
    description: 'Mark or clear rush on a delivery note',
    category: 'delivery_notes',
    assignable: true,
    sortOrder: 35,
  },
  {
    code: 'dn.status.pick',
    description: 'Picking workflow status transitions',
    category: 'delivery_notes',
    assignable: true,
    sortOrder: 40,
  },
  {
    code: 'dn.status.pack',
    description: 'Packing workflow status transitions',
    category: 'delivery_notes',
    assignable: true,
    sortOrder: 50,
  },
  {
    code: 'shipment.create',
    description: 'Shipping workflow status transitions',
    category: 'shipping',
    assignable: true,
    sortOrder: 10,
  },
  {
    code: 'customers.read',
    description: 'View customer profiles and courier accounts',
    category: 'customers',
    assignable: true,
    critical: true,
    sortOrder: 10,
  },
  {
    code: 'customers.write',
    description: 'Update customer profiles and courier accounts',
    category: 'customers',
    assignable: true,
    sortOrder: 20,
  },
  {
    code: 'import.daily_dn',
    description: 'Import daily DN file / pipeline',
    category: 'import',
    assignable: true,
    sortOrder: 10,
  },
  {
    code: 'import.shipping_ids',
    description: 'Import Shipping IDs (customer / carrier accounts) file',
    category: 'import',
    assignable: true,
    sortOrder: 20,
  },
  {
    code: 'users.manage',
    description: 'Create users and assign roles',
    category: 'administration',
    assignable: true,
    sortOrder: 10,
  },
  {
    code: 'permissions.manage',
    description: 'View role matrix and permission catalog',
    category: 'administration',
    assignable: true,
    sortOrder: 20,
  },
];

/** Roles that bypass the matrix on the API (full access regardless of checkboxes). */
export const BYPASS_MATRIX_ROLE_CODES = ['SUPERVISOR', 'SYSTEM'] as const;

/** Default permission sets for restore — operational roles only. */
export const ROLE_PERMISSION_DEFAULTS: Record<string, string[]> = {
  SUPERVISOR: [
    'dn.read',
    'dn.status.supervise',
    'dn.priority.set',
    'dn.rush.set',
    'customers.read',
    'customers.write',
    'import.daily_dn',
    'import.shipping_ids',
    'users.manage',
    'permissions.manage',
  ],
  SYSTEM: [
    'dn.read',
    'customers.read',
    'customers.write',
    'import.shipping_ids',
    'users.manage',
    'permissions.manage',
  ],
  CSA: [
    'customers.read',
    'customers.write',
    'import.shipping_ids',
    'dn.read',
    'dn.status.supervise',
    'dn.rush.set',
  ],
  TEAM_LEAD: [
    'dn.read',
    'dn.status.supervise',
    'dn.priority.set',
    'dn.rush.set',
    'customers.read',
  ],
  PICKER: ['dn.read', 'dn.status.pick'],
  PACKER: ['dn.read', 'dn.status.pack'],
  SHIPPER: ['dn.read', 'shipment.create', 'customers.read'],
};

export const ASSIGNABLE_PERMISSION_CODES = PERMISSION_MANIFEST.filter(
  (p) => p.assignable,
).map((p) => p.code);

const manifestByCode = new Map(
  PERMISSION_MANIFEST.map((p) => [p.code, p] as const),
);

export function getManifestEntry(
  code: string,
): PermissionManifestEntry | undefined {
  return manifestByCode.get(code.trim().toLowerCase());
}

export function sortPermissionsForMatrix<
  T extends { code: string; sortOrder?: number },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ma = manifestByCode.get(a.code);
    const mb = manifestByCode.get(b.code);
    const ca = ma?.sortOrder ?? 999;
    const cb = mb?.sortOrder ?? 999;
    if (ca !== cb) return ca - cb;
    return a.code.localeCompare(b.code);
  });
}
