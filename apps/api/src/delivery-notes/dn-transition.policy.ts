import { dn_status } from '@prisma/client';

export type TransitionMeta = {
  permission: string;
  allowedRoles: string[];
};

/**
 * Maps (from,to) to required permission + allowed active role codes (spec §2.2–2.3).
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
      allowedRoles: ['SUPERVISOR'],
    };
  }

  if (to === dn_status.CANCELLED) {
    if (from === dn_status.CANCELLED || from === dn_status.SHIPPED) return null;
    return {
      permission: 'dn.status.supervise',
      allowedRoles: ['SUPERVISOR'],
    };
  }

  if (from === dn_status.CANCELLED && to === dn_status.PRIORITIZED) {
    return {
      permission: 'dn.status.supervise',
      allowedRoles: ['SUPERVISOR'],
    };
  }

  if (from === dn_status.ON_HOLD && to === dn_status.PRIORITIZED) {
    return {
      permission: 'dn.status.supervise',
      allowedRoles: ['SUPERVISOR'],
    };
  }

  const chain: [dn_status, dn_status, string, string[]][] = [
    [
      dn_status.IMPORTED,
      dn_status.PRIORITIZED,
      'dn.status.supervise',
      ['SUPERVISOR'],
    ],
    /** Pickers may start picking directly from import when not yet prioritized. */
    [dn_status.IMPORTED, dn_status.PICKING, 'dn.status.pick', ['PICKER']],
    [dn_status.PRIORITIZED, dn_status.PICKING, 'dn.status.pick', ['PICKER']],
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
  dn_status.IMPORTED,
  dn_status.PRIORITIZED,
  dn_status.PICKING,
  dn_status.PICKED,
  dn_status.PACKING,
  dn_status.PACKED,
  dn_status.SHIPPING_IN_PROGRESS,
  dn_status.SHIPPED,
  dn_status.ON_HOLD,
  dn_status.CANCELLED,
];
