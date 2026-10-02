import { dn_status } from '@prisma/client';
import {
  buildCircleCountResult,
  normalizePartNumbers,
  type CircleCountLineRow,
} from './circle-count.policy';

describe('normalizePartNumbers', () => {
  it('trims, drops empties, dedupes, keeps typed order', () => {
    expect(
      normalizePartNumbers([' 333226 ', '', '328546', '333226', '  ', '275401']),
    ).toEqual(['333226', '328546', '275401']);
  });

  it('handles empty input', () => {
    expect(normalizePartNumbers([])).toEqual([]);
  });
});

function line(
  part: string,
  overrides: Partial<CircleCountLineRow['delivery_note']> & {
    qty?: string | null;
    description?: string | null;
  } = {},
): CircleCountLineRow {
  const { qty = '2', description = null, ...dnOverrides } = overrides;
  return {
    material_code: part,
    material_description: description,
    shipped_qty: qty == null ? null : { toString: () => qty },
    delivery_note: {
      id: `dn-${part}-${dnOverrides.dn_number ?? 'x'}`,
      dn_number: '9199188205',
      current_status: dn_status.PICKED,
      current_priority_no: 5,
      sold_to_code: 'C12345',
      customer: { sold_to_name: 'Delta Controls' },
      packing_started_by: null,
      shipping_started_by: null,
      ...dnOverrides,
    },
  };
}

describe('buildCircleCountResult', () => {
  it('shapes rows and reports missing parts as notFound', () => {
    const { rows, notFound } = buildCircleCountResult(
      ['333226', '999999'],
      [line('333226', { qty: '7', description: 'Controller' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      part: '333226',
      description: 'Controller',
      qty: 7,
      dn_number: '9199188205',
      status: dn_status.PICKED,
      priority: 5,
      customer: 'Delta Controls',
      processing_by: null,
    });
    expect(notFound).toEqual(['999999']);
  });

  it('shows the packer while PACKING and the shipper while SHIPPING', () => {
    const { rows } = buildCircleCountResult(
      ['111', '222'],
      [
        line('111', {
          dn_number: '1001',
          current_status: dn_status.PACKING,
          packing_started_by: { display_name: 'Pat Packer', email: 'p@x.ca' },
        }),
        line('222', {
          dn_number: '1002',
          current_status: dn_status.SHIPPING_IN_PROGRESS,
          shipping_started_by: { display_name: null, email: 'ship@x.ca' },
        }),
      ],
    );
    expect(rows[0].processing_by).toBe('Pat Packer');
    expect(rows[1].processing_by).toBe('ship@x.ca');
  });

  it('orders by searched order, then priority (unset last), then DN number', () => {
    const { rows } = buildCircleCountResult(
      ['B', 'A'],
      [
        line('A', { dn_number: '2002', current_priority_no: 3 }),
        line('B', { dn_number: '2003', current_priority_no: null }),
        line('B', { dn_number: '2001', current_priority_no: 1 }),
        line('B', { dn_number: '2000', current_priority_no: null }),
      ],
    );
    expect(rows.map((r) => r.dn_number)).toEqual([
      '2001',
      '2000',
      '2003',
      '2002',
    ]);
  });

  it('treats a missing qty as null', () => {
    const { rows } = buildCircleCountResult(
      ['111'],
      [line('111', { qty: null })],
    );
    expect(rows[0].qty).toBeNull();
  });
});
