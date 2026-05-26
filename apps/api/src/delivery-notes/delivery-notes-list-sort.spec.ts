import { buildDeliveryNoteListOrderBy } from './delivery-notes-list-sort';

const rushFirst = { is_rushed: 'desc' as const };

describe('buildDeliveryNoteListOrderBy', () => {
  it('always puts rushed notes first', () => {
    expect(buildDeliveryNoteListOrderBy('dn_number', 'asc')[0]).toEqual(
      rushFirst,
    );
    expect(buildDeliveryNoteListOrderBy('customer', 'desc')[0]).toEqual(
      rushFirst,
    );
  });

  it('defaults to rush first then priority asc', () => {
    expect(buildDeliveryNoteListOrderBy()).toEqual([
      rushFirst,
      { current_priority_no: { sort: 'asc', nulls: 'last' } },
      { dn_number: 'asc' },
    ]);
  });

  it('sorts by customer name after rush', () => {
    expect(buildDeliveryNoteListOrderBy('customer', 'desc')[1]).toEqual({
      customer: { sold_to_name: 'desc' },
    });
  });

  it('sorts by dn number after rush', () => {
    expect(buildDeliveryNoteListOrderBy('dn_number', 'asc')).toEqual([
      rushFirst,
      { dn_number: 'asc' },
    ]);
  });
});
