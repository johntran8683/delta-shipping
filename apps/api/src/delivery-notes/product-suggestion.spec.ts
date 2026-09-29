import 'reflect-metadata';
import { DeliveryNotesService } from './delivery-notes.service';

function makeService(prismaMock: Record<string, unknown>) {
  const permissionsMock = { roleHasPermission: jest.fn() };
  const service = new DeliveryNotesService(
    prismaMock as never,
    permissionsMock as never,
  );
  return { service, permissionsMock };
}

describe('suggestPart (product master first, history fallback)', () => {
  it('returns the product master row when the part is known', async () => {
    const prismaMock = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          code: 'DCW-100',
          description: 'Canonical widget',
          unit_price: '12.5000',
        }),
      },
      deliveryNoteLine: { findFirst: jest.fn() },
    };
    const { service } = makeService(prismaMock);
    const result = await service.suggestPart('  dcw-100 ');
    expect(prismaMock.product.findUnique).toHaveBeenCalledWith({
      where: { code: 'DCW-100' },
      select: { code: true, description: true, unit_price: true },
    });
    expect(prismaMock.deliveryNoteLine.findFirst).not.toHaveBeenCalled();
    expect(result).toEqual({
      material_code: 'DCW-100',
      material_description: 'Canonical widget',
      unit_price: '12.5000',
    });
  });

  it('falls back to the most recent delivery-note line', async () => {
    const prismaMock = {
      product: { findUnique: jest.fn().mockResolvedValue(null) },
      deliveryNoteLine: {
        findFirst: jest.fn().mockResolvedValue({
          material_code: 'dcw-200',
          material_description: 'From history',
          unit_price: '9.9900',
        }),
      },
    };
    const { service } = makeService(prismaMock);
    const result = await service.suggestPart('dcw-200');
    expect(result).toEqual({
      material_code: 'dcw-200',
      material_description: 'From history',
      unit_price: '9.9900',
    });
  });

  it('returns null when the part is unknown everywhere', async () => {
    const prismaMock = {
      product: { findUnique: jest.fn().mockResolvedValue(null) },
      deliveryNoteLine: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const { service } = makeService(prismaMock);
    expect(await service.suggestPart('nope-1')).toBeNull();
    expect(await service.suggestPart('   ')).toBeNull();
  });
});

describe('ensureProductsForLines', () => {
  it('upserts each distinct normalized code, create-only', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const { service } = makeService({});
    const ensureProducts = (
      service as unknown as {
        ensureProductsForLines: (
          tx: unknown,
          lines: Array<{
            material_code: string;
            material_description?: string | null;
            unit_price?: number | null;
          }>,
        ) => Promise<void>;
      }
    ).ensureProductsForLines;
    await ensureProducts({ product: { upsert } }, [
      {
        material_code: ' dcw-100 ',
        material_description: 'Widget',
        unit_price: 12.5,
      },
      {
        material_code: 'DCW-100',
        material_description: 'Widget',
        unit_price: 12.5,
      },
      { material_code: 'x-2', material_description: null, unit_price: null },
      { material_code: '   ', material_description: 'blank', unit_price: 1 },
    ]);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith({
      where: { code: 'DCW-100' },
      update: {},
      create: { code: 'DCW-100', description: 'Widget', unit_price: 12.5 },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { code: 'X-2' },
      update: {},
      create: { code: 'X-2', description: null, unit_price: null },
    });
  });
});

describe('createManual wires product upserts', () => {
  it('creates missing product rows for the note lines', async () => {
    const productUpsert = jest.fn().mockResolvedValue({});
    const tx = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'cust-1', sold_to_code: 'C-1' }),
      },
      shipToLocation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ship-1',
          customer_id: 'cust-1',
          ship_to_code: 'S-1',
        }),
      },
      deliveryNote: {
        create: jest.fn().mockResolvedValue({ id: 'dn-1', is_rushed: false }),
      },
      deliveryNoteLine: { create: jest.fn().mockResolvedValue({}) },
      dnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      product: { upsert: productUpsert },
    };
    const prismaMock = {
      deliveryNote: { findUnique: jest.fn().mockResolvedValue(null) },
      importBatch: { findFirst: jest.fn().mockResolvedValue(null) },
      deliveryNoteLine: undefined,
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    (prismaMock as Record<string, unknown>).deliveryNote = {
      findUnique: jest.fn().mockResolvedValue(null),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _max: { current_priority_no: null } }),
    };
    const { service, permissionsMock } = makeService(prismaMock);
    permissionsMock.roleHasPermission.mockResolvedValue(true);
    jest
      .spyOn(service as never, 'findOne' as never)
      .mockResolvedValue({ id: 'dn-1' } as never);

    await service.createManual(
      {
        dn_number: '  777001  ',
        customer_id: 'cust-1',
        ship_to_location_id: 'ship-1',
        shipping_type: 'FedEx Ground',
        charging_method: 'Prepaid and Added',
        lines: [
          {
            material_code: ' dcw-100 ',
            material_description: 'Widget',
            order_qty: 2,
            unit_price: 12.5,
          },
        ],
      } as never,
      { sub: 'user-1', activeRoleId: 'role-1' } as never,
    );

    expect(productUpsert).toHaveBeenCalledWith({
      where: { code: 'DCW-100' },
      update: {},
      create: { code: 'DCW-100', description: 'Widget', unit_price: 12.5 },
    });
  });
});

describe('updateManual wires product upserts', () => {
  it('creates missing product rows when lines change', async () => {
    const productUpsert = jest.fn().mockResolvedValue({});
    const tx = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'cust-1', sold_to_code: 'C-1' }),
      },
      shipToLocation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ship-1',
          customer_id: 'cust-1',
          ship_to_code: 'S-1',
        }),
      },
      deliveryNote: { update: jest.fn().mockResolvedValue({}) },
      deliveryNoteLine: {
        deleteMany: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
      dnRushHistory: { create: jest.fn().mockResolvedValue({}) },
      product: { upsert: productUpsert },
    };
    const prismaMock = {
      deliveryNote: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'dn-1',
          dn_number: '777001',
          current_status: 'NEW',
          is_rushed: false,
          current_priority_no: 3,
        }),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    const { service, permissionsMock } = makeService(prismaMock);
    permissionsMock.roleHasPermission.mockResolvedValue(true);
    jest
      .spyOn(service as never, 'findOne' as never)
      .mockResolvedValue({ id: 'dn-1' } as never);

    await service.updateManual(
      'dn-1',
      {
        dn_number: '777001',
        customer_id: 'cust-1',
        ship_to_location_id: 'ship-1',
        shipping_type: 'UPS',
        charging_method: 'Collect',
        lines: [
          {
            material_code: 'new-part-9',
            material_description: 'New',
            order_qty: 1,
          },
        ],
      } as never,
      { sub: 'user-1', activeRoleId: 'role-1' } as never,
    );

    expect(productUpsert).toHaveBeenCalledWith({
      where: { code: 'NEW-PART-9' },
      update: {},
      create: { code: 'NEW-PART-9', description: 'New', unit_price: null },
    });
  });
});
