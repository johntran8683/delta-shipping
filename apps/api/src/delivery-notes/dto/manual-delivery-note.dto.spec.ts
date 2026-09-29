import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDeliveryNoteDto } from './manual-delivery-note.dto';

function validPayload(): Record<string, any> {
  return {
    dn_number: '  987654  ',
    customer_id: '11111111-1111-4111-8111-111111111111',
    ship_to_location_id: '22222222-2222-4222-8222-222222222222',
    customer_po: 'PO-1',
    currency_code: 'CAD',
    shipping_type: 'FedEx Ground',
    charging_method: 'Prepaid and Added',
    is_rushed: true,
    rush_reason: 'Urgent',
    lines: [
      {
        material_code: 'DCW-100',
        material_description: 'Widget',
        so_number: 'SO-9',
        order_qty: 3,
        unit_price: 12.5,
      },
    ],
  };
}

async function violationsOf(payload: object) {
  const dto = plainToInstance(CreateDeliveryNoteDto, payload);
  return validate(dto);
}

describe('CreateDeliveryNoteDto', () => {
  it('accepts a valid manual delivery note payload', async () => {
    expect(await violationsOf(validPayload())).toHaveLength(0);
  });

  it('accepts inline new customer / ship-to instead of ids', async () => {
    const p = validPayload();
    delete (p as Record<string, unknown>).customer_id;
    delete (p as Record<string, unknown>).ship_to_location_id;
    (p as Record<string, unknown>).new_customer = {
      sold_to_code: 'C-100',
      sold_to_name: 'Acme',
    };
    (p as Record<string, unknown>).new_ship_to = {
      ship_to_code: 'S-1',
      ship_to_name: 'Acme Warehouse',
    };
    expect(await violationsOf(p)).toHaveLength(0);
  });

  it('rejects a blank dn_number', async () => {
    const violations = await violationsOf({
      ...validPayload(),
      dn_number: '   ',
    });
    expect(violations.some((v) => v.property === 'dn_number')).toBe(true);
  });

  it('rejects an empty lines array', async () => {
    const violations = await violationsOf({ ...validPayload(), lines: [] });
    expect(violations.some((v) => v.property === 'lines')).toBe(true);
  });

  it('rejects a line with zero quantity', async () => {
    const p = validPayload();
    p.lines = [{ material_code: 'DCW-100', order_qty: 0 }];
    const violations = await violationsOf(p);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('rejects a line with a blank part number', async () => {
    const p = validPayload();
    p.lines = [{ material_code: '  ', order_qty: 2 }];
    const violations = await violationsOf(p);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('rejects priority_no below 1', async () => {
    const violations = await violationsOf({
      ...validPayload(),
      priority_no: 0,
    });
    expect(violations.some((v) => v.property === 'priority_no')).toBe(true);
  });

  it('rejects a missing shipping_type', async () => {
    const p = validPayload();
    delete (p as Record<string, unknown>).shipping_type;
    const violations = await violationsOf(p);
    expect(violations.some((v) => v.property === 'shipping_type')).toBe(true);
  });

  it('rejects a charging_method outside the fixed list', async () => {
    const violations = await violationsOf({
      ...validPayload(),
      charging_method: 'Bill me later',
    });
    expect(violations.some((v) => v.property === 'charging_method')).toBe(true);
  });

  it('accepts every fixed-list charging method', async () => {
    for (const m of ['Prepaid and Added', 'Collect', 'Prepaid but No Charge']) {
      const violations = await violationsOf({
        ...validPayload(),
        charging_method: m,
      });
      expect(violations).toHaveLength(0);
    }
  });
});
