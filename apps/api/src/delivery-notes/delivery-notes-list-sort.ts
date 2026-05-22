import { Prisma } from '@prisma/client';

export const DELIVERY_NOTE_LIST_SORT_FIELDS = [
  'priority',
  'customer',
  'dn_number',
  'status',
  'shipping_type',
] as const;

export type DeliveryNoteListSortField =
  (typeof DELIVERY_NOTE_LIST_SORT_FIELDS)[number];

export type DeliveryNoteListSortDir = 'asc' | 'desc';

/** Rushed notes always appear before non-rushed, regardless of user sort. */
const RUSH_FIRST: Prisma.DeliveryNoteOrderByWithRelationInput = {
  is_rushed: 'desc',
};

function withRushFirst(
  order: Prisma.DeliveryNoteOrderByWithRelationInput[],
): Prisma.DeliveryNoteOrderByWithRelationInput[] {
  return [RUSH_FIRST, ...order];
}

export function buildDeliveryNoteListOrderBy(
  sortBy?: string,
  sortDir?: string,
): Prisma.DeliveryNoteOrderByWithRelationInput[] {
  const dir: Prisma.SortOrder = sortDir === 'desc' ? 'desc' : 'asc';
  const tieDn: Prisma.DeliveryNoteOrderByWithRelationInput = { dn_number: 'asc' };

  switch (sortBy) {
    case 'priority':
      return withRushFirst([
        { current_priority_no: { sort: dir, nulls: 'last' } },
        tieDn,
      ]);
    case 'customer':
      return withRushFirst([
        { customer: { sold_to_name: dir } },
        { sold_to_code: dir },
        tieDn,
      ]);
    case 'dn_number':
      return withRushFirst([{ dn_number: dir }]);
    case 'status':
      return withRushFirst([{ current_status: dir }, tieDn]);
    case 'shipping_type':
      return withRushFirst([
        { shipping_type: { sort: dir, nulls: 'last' } },
        tieDn,
      ]);
    default:
      return withRushFirst([
        { current_priority_no: { sort: 'asc', nulls: 'last' } },
        tieDn,
      ]);
  }
}

export function isDeliveryNoteListSortField(
  value: string,
): value is DeliveryNoteListSortField {
  return (DELIVERY_NOTE_LIST_SORT_FIELDS as readonly string[]).includes(value);
}
