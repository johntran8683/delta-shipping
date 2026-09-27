import { dn_status } from '@prisma/client';

export type TransitionMeta = {
  permission: string;
  allowedRoles: string[];
};

/** Roles that may supervise delivery notes (hold/cancel/resume/rush). */
export const SUPERVISING_ROLES = ['SUPERVISOR', 'TEAM_LEAD', 'CSA'] as const;

/**
 * Maps (from,to) to required permission + allowed role codes.
 * Permissions are checked against ALL roles assigned to the user (flexible),
 * not just the active role — the active role only controls which view is shown.
 */
export function getTransitionMeta(
  from: dn_status,
  to: dn_status,
): TransitionMeta | null {
  if (from === to) return null;

  if (to === dn_status.ON_HOLD) {
    if (from === dn_status.SHIPPED || from === dn_status.CANCELLED) return null;
    return {
      permission: 'dn.status.supervise',
      allowedRoles: [...SUPERVISING_ROLES],
    };
  }

  if (to === dn_status.CANCELLED) {
    if (from === dn_status.CANCELLED || from === dn_status.SHIPPED) return null;
    return {
      permission: 'dn.status.supervise',
      allowedRoles: [...SUPERVISING_ROLES],
    };
  }

  if (from === dn_status.ON_HOLD) {
    // Resume to the status the note was in before being held.
    // The service resolves the target from on_hold_from_status.
    const resumable: dn_status[] = [
      dn_status.NEW,
      dn_status.PICKING,
      dn_status.PICKED,
      dn_status.PACKING,
      dn_status.PACKED,
      dn_status.SHIPPING_IN_PROGRESS,
    ];
    if (resumable.includes(to)) {
      return {
        permission: 'dn.status.supervise',
        allowedRoles: [...SUPERVISING_ROLES],
      };
    }
    return null;
  }

  // Cancelled is terminal — no reopening.
  if (from === dn_status.CANCELLED) return null;

  const chain: [dn_status, dn_status, string, string[]][] = [
    [dn_status.NEW, dn_status.PICKING, 'dn.status.pick', ['PICKER']],
    [dn_status.PICKING, dn_status.PICKED, 'dn.status.pick', ['PICKER']],
    [dn_status.PICKED, dn_status.PACKING, 'dn.status.pack', ['PACKER']],
    /** Packer may undo start-packing and return to picked (leaves combined peers still packing). */
    [dn_status.PACKING, dn_status.PICKED, 'dn.status.pack', ['PACKER']],
    [dn_status.PACKING, dn_status.PACKED, 'dn.status.pack', ['PACKER']],
    /** Reopen last completed pack: whole session back to PACKING; box rows removed. */
    [dn_status.PACKED, dn_status.PACKING, 'dn.status.pack', ['PACKER']],
    /** Full undo of last completed pack: whole session removed; all members PICKED. */
    [dn_status.PACKED, dn_status.PICKED, 'dn.status.pack', ['PACKER']],
    [
      dn_status.PACKED,
      dn_status.SHIPPING_IN_PROGRESS,
      'shipment.create',
      ['SHIPPER'],
    ],
    [
      dn_status.SHIPPING_IN_PROGRESS,
      dn_status.SHIPPED,
      'shipment.create',
      ['SHIPPER'],
    ],
    /** Shipper may return a note to packed before it is marked shipped. */
    [
      dn_status.SHIPPING_IN_PROGRESS,
      dn_status.PACKED,
      'shipment.create',
      ['SHIPPER'],
    ],
  ];

  for (const [f, t, permission, allowedRoles] of chain) {
    if (from === f && to === t) return { permission, allowedRoles };
  }

  return null;
}

export const ALL_DN_STATUSES: dn_status[] = [
  dn_status.NEW,
  dn_status.PICKING,
  dn_status.PICKED,
  dn_status.PACKING,
  dn_status.PACKED,
  dn_status.SHIPPING_IN_PROGRESS,
  dn_status.SHIPPED,
  dn_status.ON_HOLD,
  dn_status.CANCELLED,
];
