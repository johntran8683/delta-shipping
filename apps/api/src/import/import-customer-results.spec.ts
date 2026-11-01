import {
  groupCustomerImportResults,
  type ImportCustomerResultRow,
} from './import-customer-results';

function row(
  partial: Partial<ImportCustomerResultRow> & { sold_to_code: string },
): ImportCustomerResultRow {
  return {
    customer_id: null,
    sold_to_name: 'Name',
    outcome: 'CREATED',
    accounts_upserted: 0,
    excel_row: null,
    ...partial,
  };
}

describe('groupCustomerImportResults', () => {
  it('passes a single row through', () => {
    const grouped = groupCustomerImportResults([
      row({
        customer_id: 'c1',
        sold_to_code: 'A-015',
        sold_to_name: 'Automated Building Controls Ltd.',
        outcome: 'CREATED',
        accounts_upserted: 2,
        excel_row: 2,
      }),
    ]);
    expect(grouped).toEqual([
      {
        customer_id: 'c1',
        sold_to_code: 'A-015',
        sold_to_name: 'Automated Building Controls Ltd.',
        outcome: 'CREATED',
        accounts_upserted: 2,
        excel_row: 2,
      },
    ]);
  });

  it('merges a customer created then updated by the same batch', () => {
    const grouped = groupCustomerImportResults([
      row({
        customer_id: 'c1',
        sold_to_code: 'N-007',
        sold_to_name: 'Ainsworth (Delta Connects) - Washington',
        outcome: 'CREATED',
        accounts_upserted: 2,
        excel_row: 17,
      }),
      row({
        customer_id: 'c1',
        sold_to_code: 'N-007',
        sold_to_name: 'Ainsworth (Delta Connects) - Oregon',
        outcome: 'UPDATED',
        accounts_upserted: 1,
        excel_row: 18,
      }),
    ]);
    expect(grouped).toEqual([
      {
        customer_id: 'c1',
        sold_to_code: 'N-007',
        sold_to_name: 'Ainsworth (Delta Connects) - Oregon',
        outcome: 'CREATED',
        accounts_upserted: 3,
        excel_row: 17,
      },
    ]);
  });

  it('keeps distinct customers separate, in first-seen order', () => {
    const grouped = groupCustomerImportResults([
      row({ customer_id: 'c1', sold_to_code: 'A-015', outcome: 'CREATED' }),
      row({ customer_id: 'c2', sold_to_code: 'A-160', outcome: 'UPDATED' }),
      row({ customer_id: 'c1', sold_to_code: 'A-015', outcome: 'UPDATED' }),
    ]);
    expect(grouped.map((g) => g.sold_to_code)).toEqual(['A-015', 'A-160']);
    expect(grouped[0]?.outcome).toBe('CREATED');
  });

  it('groups by code when the customer id is gone', () => {
    const grouped = groupCustomerImportResults([
      row({ sold_to_code: 'A-320', outcome: 'CREATED' }),
      row({ sold_to_code: 'A-320', outcome: 'UPDATED' }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.outcome).toBe('CREATED');
  });
});
