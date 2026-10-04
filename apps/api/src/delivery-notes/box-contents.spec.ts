import { Prisma } from '@prisma/client';
import { DeliveryNotesService } from './delivery-notes.service';
import type { PackBoxInputDto } from './dto/complete-pack.dto';

type CannedLine = {
  material_code: string | null;
  material_description: string | null;
  open_qty: Prisma.Decimal;
};

function makeService(
  memberIds: string[],
  lines: CannedLine[],
  requiresBoxContent: boolean,
) {
  const tx = {
    deliveryNote: {
      findMany: jest.fn().mockResolvedValue(
        memberIds.map((id) => ({
          id,
          customer: { requires_box_content: requiresBoxContent },
          lines,
        })),
      ),
    },
  };
  const service = new DeliveryNotesService({} as never, {} as never);
  const validate = (boxes: PackBoxInputDto[]): Promise<unknown> =>
    (
      service as unknown as {
        validateBoxContents: (
          tx: unknown,
          memberIds: string[],
          boxes: PackBoxInputDto[],
        ) => Promise<unknown>;
      }
    ).validateBoxContents(tx, memberIds, boxes);
  return { validate };
}

const LINES: CannedLine[] = [
  {
    material_code: 'DCW-100',
    material_description: 'Widget A',
    open_qty: new Prisma.Decimal(10),
  },
  {
    material_code: 'dcw-200',
    material_description: 'Widget B',
    open_qty: new Prisma.Decimal(4),
  },
];

const box = (contents?: PackBoxInputDto['contents']): PackBoxInputDto => ({
  weightLb: 5,
  lengthIn: 10,
  widthIn: 10,
  heightIn: 10,
  contents,
});

describe('validateBoxContents', () => {
  it('returns null when contents are neither required nor entered', async () => {
    const { validate } = makeService(['dn1'], LINES, false);
    await expect(validate([box(), box()])).resolves.toBeNull();
  });

  it('requires contents on every box when the customer requires them', async () => {
    const { validate } = makeService(['dn1'], LINES, true);
    await expect(
      validate([
        box([
          { materialCode: 'DCW-100', quantity: 10 },
          { materialCode: 'DCW-200', quantity: 4 },
        ]),
        box(),
      ]),
    ).rejects.toThrow(/Box 2: enter which items are in this box/);
  });

  it('accepts balanced contents and normalizes part codes', async () => {
    const { validate } = makeService(['dn1'], LINES, true);
    const result = (await validate([
      box([{ materialCode: 'dcw-100', quantity: 6 }]),
      box([
        { materialCode: 'DCW-100', quantity: 4 },
        { materialCode: 'DCW-200', quantity: 4 },
      ]),
    ])) as Array<
      Array<{ material_code: string | null; quantity: Prisma.Decimal }>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(1);
    expect(result[1]).toHaveLength(2);
    expect(result[0]?.[0]?.material_code).toBe('dcw-100');
    expect(result[0]?.[0]?.quantity.toString()).toBe('6');
  });

  it('rejects unbalanced quantities naming the part', async () => {
    const { validate } = makeService(['dn1'], LINES, true);
    await expect(
      validate([
        box([{ materialCode: 'DCW-100', quantity: 9 }]),
        box([{ materialCode: 'DCW-200', quantity: 4 }]),
      ]),
    ).rejects.toThrow(/Part "DCW-100": 9 of 10 assigned/);
  });

  it('stays strict when contents are entered but not required', async () => {
    const { validate } = makeService(['dn1'], LINES, false);
    await expect(
      validate([
        box([{ materialCode: 'DCW-100', quantity: 10 }]),
        box([{ materialCode: 'DCW-200', quantity: 3 }]),
      ]),
    ).rejects.toThrow(/Part "dcw-200": 3 of 4 assigned/);
  });

  it('rejects parts not on the delivery notes', async () => {
    const { validate } = makeService(['dn1'], LINES, true);
    await expect(
      validate([
        box([
          { materialCode: 'DCW-100', quantity: 10 },
          { materialCode: 'DCW-999', quantity: 1 },
        ]),
        box([{ materialCode: 'DCW-200', quantity: 4 }]),
      ]),
    ).rejects.toThrow(/part "DCW-999" is not on these delivery notes/);
  });

  it('sums open quantities per part across the session lines', async () => {
    const { validate } = makeService(
      ['dn1'],
      [
        ...LINES,
        {
          material_code: 'DCW-100',
          material_description: 'Widget A',
          open_qty: new Prisma.Decimal(5),
        },
      ],
      true,
    );
    await expect(
      validate([
        box([
          { materialCode: 'DCW-100', quantity: 10 },
          { materialCode: 'DCW-200', quantity: 4 },
        ]),
      ]),
    ).rejects.toThrow(/Part "DCW-100": 10 of 15 assigned/);
  });
});
