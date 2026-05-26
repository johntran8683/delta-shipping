import { dn_status, Prisma } from '@prisma/client';

export type DeliveryNoteStatusContextDto = {
  message: string | null;
  changed_at: string;
  from_status: string | null;
  actor_display: string | null;
  actor_role: string | null;
  pack_completion_note: string | null;
  pack_box_count: number | null;
};

const CONTEXT_STATUSES: dn_status[] = [
  dn_status.PICKED,
  dn_status.PACKED,
  dn_status.ON_HOLD,
  dn_status.CANCELLED,
];

function normStatus(s: string): string {
  return String(s ?? '')
    .trim()
    .toUpperCase();
}

function actorDisplay(user: {
  display_name: string | null;
  email: string;
}): string {
  return user.display_name?.trim() || user.email;
}

/**
 * Attach latest status-transition context for list hover tooltips.
 */
export async function attachDeliveryNoteStatusContexts<
  T extends { id: string; current_status: string },
>(
  prisma: Prisma.TransactionClient | Prisma.DefaultPrismaClient,
  items: T[],
): Promise<(T & { status_context: DeliveryNoteStatusContextDto | null })[]> {
  if (items.length === 0) return [];

  const ids = items.map((i) => i.id);
  const histories = await prisma.dnStatusHistory.findMany({
    where: {
      delivery_note_id: { in: ids },
      to_status: { in: CONTEXT_STATUSES },
    },
    orderBy: { changed_at: 'desc' },
    select: {
      delivery_note_id: true,
      to_status: true,
      from_status: true,
      message: true,
      changed_at: true,
      actor_user: {
        select: { email: true, display_name: true },
      },
      actor_role: {
        select: { code: true, name: true },
      },
    },
  });

  const contextById = new Map<string, DeliveryNoteStatusContextDto>();

  for (const row of histories) {
    const id = row.delivery_note_id;
    if (contextById.has(id)) continue;
    const item = items.find((i) => i.id === id);
    if (
      !item ||
      normStatus(item.current_status) !== normStatus(row.to_status)
    ) {
      continue;
    }
    contextById.set(id, {
      message: row.message?.trim() || null,
      changed_at: row.changed_at.toISOString(),
      from_status: row.from_status,
      actor_display: actorDisplay(row.actor_user),
      actor_role: row.actor_role?.name || row.actor_role?.code || null,
      pack_completion_note: null,
      pack_box_count: null,
    });
  }

  const packedIds = items
    .filter((i) => normStatus(i.current_status) === dn_status.PACKED)
    .map((i) => i.id);

  if (packedIds.length > 0) {
    const memberships = await prisma.packSessionDeliveryNote.findMany({
      where: {
        delivery_note_id: { in: packedIds },
        pack_session: { completed_at: { not: null } },
      },
      orderBy: [{ pack_session: { completed_at: 'desc' } }],
      select: {
        delivery_note_id: true,
        pack_session: {
          select: {
            pack_completion_note: true,
            completed_at: true,
            boxes: { select: { id: true } },
          },
        },
      },
    });

    const packByDn = new Map<string, (typeof memberships)[number]>();
    for (const m of memberships) {
      if (!packByDn.has(m.delivery_note_id)) {
        packByDn.set(m.delivery_note_id, m);
      }
    }

    for (const dnId of packedIds) {
      const m = packByDn.get(dnId);
      const existing = contextById.get(dnId);
      const packNote = m?.pack_session.pack_completion_note?.trim() || null;
      const boxCount = m?.pack_session.boxes.length ?? 0;
      if (existing) {
        contextById.set(dnId, {
          ...existing,
          pack_completion_note: packNote,
          pack_box_count: boxCount > 0 ? boxCount : null,
        });
      } else if (m) {
        contextById.set(dnId, {
          message: null,
          changed_at: m.pack_session.completed_at!.toISOString(),
          from_status: null,
          actor_display: null,
          actor_role: null,
          pack_completion_note: packNote,
          pack_box_count: boxCount > 0 ? boxCount : null,
        });
      }
    }
  }

  return items.map((item) => ({
    ...item,
    status_context: contextById.get(item.id) ?? null,
  }));
}
