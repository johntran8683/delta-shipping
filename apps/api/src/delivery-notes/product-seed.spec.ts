import 'reflect-metadata';
import {
  backfillProducts,
  mergeProductSeedRows,
  normalizeProductCode,
  readWeightRows,
} from '../../prisma/product-seed';

describe('normalizeProductCode', () => {
  it('trims and uppercases part numbers', () => {
    expect(normalizeProductCode('  dcw-100 ')).toBe('DCW-100');
  });

  it('converts numeric ITEM # values to plain digit strings', () => {
    expect(normalizeProductCode(101889)).toBe('101889');
    expect(normalizeProductCode('121059                         ')).toBe(
      '121059',
    );
  });

  it('returns empty string for nullish input', () => {
    expect(normalizeProductCode(null)).toBe('');
    expect(normalizeProductCode(undefined)).toBe('');
  });
});

describe('mergeProductSeedRows', () => {
  it('merges history and weights by normalized code', () => {
    const rows = mergeProductSeedRows(
      [{ code: 'dcw-100', description: 'Widget', unit_price: '12.5000' }],
      [{ code: 'DCW-100', description: 'Other name', weight_lb: 2.5 }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      code: 'DCW-100',
      description: 'Widget',
      unit_price: '12.5000',
      weight_lb: 2.5,
    });
  });

  it('keeps weights-only parts with their spreadsheet description', () => {
    const rows = mergeProductSeedRows(
      [],
      [{ code: '101889', description: 'Ogio Backpack', weight_lb: 2.35 }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      code: '101889',
      description: 'Ogio Backpack',
      unit_price: null,
      weight_lb: 2.35,
    });
  });

  it('uses the spreadsheet description when history has none', () => {
    const rows = mergeProductSeedRows(
      [{ code: 'X-1', description: null, unit_price: null }],
      [{ code: 'X-1', description: 'From sheet', weight_lb: null }],
    );
    expect(rows[0].description).toBe('From sheet');
  });

  it('dedupes history rows that normalize to the same code', () => {
    const rows = mergeProductSeedRows(
      [
        { code: 'dcw-100', description: 'First', unit_price: 1 },
        { code: 'DCW-100', description: 'Second', unit_price: 2 },
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('First');
  });

  it('skips blank codes', () => {
    expect(
      mergeProductSeedRows(
        [{ code: '  ', description: null, unit_price: null }],
        [],
      ),
    ).toHaveLength(0);
  });
});

describe('readWeightRows', () => {
  it('parses the committed item-weights spreadsheet', () => {
    const rows = readWeightRows();
    // 858 data rows in the sheet; 2 have a blank ITEM # and are skipped,
    // 1 fully-empty row is ignored by the parser
    expect(rows.length).toBe(855);
    const backpack = rows.find((r) => r.code === '101889');
    expect(backpack).toMatchObject({
      code: '101889',
      description: 'Ogio Backpack',
      weight_lb: 2.35,
    });
    // padded string ITEM # values are trimmed
    const cbl = rows.find((r) => r.code === '121059');
    expect(cbl).toBeDefined();
  });
});

describe('backfillProducts', () => {
  it('upserts merged rows create-only (never overwrites)', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        // overlaps the real weights spreadsheet (101889 -> 2.35 lb)
        { code: '101889', description: 'Backpack', unit_price: '10.0000' },
        { code: 'dcw-100', description: 'Widget', unit_price: '12.5000' },
      ]),
      product: { upsert },
    };
    await backfillProducts(prisma as never);
    const calls = upsert.mock.calls.map((c) => c[0]);
    const byCode = new Map(calls.map((c) => [c.where.code, c]));

    // history description/price win; spreadsheet contributes the weight
    expect(byCode.get('101889')).toMatchObject({
      update: {},
      create: {
        code: '101889',
        description: 'Backpack',
        unit_price: '10.0000',
        weight_lb: 2.35,
      },
    });
    // code normalized; no weight on file
    expect(byCode.get('DCW-100')).toMatchObject({
      update: {},
      create: {
        code: 'DCW-100',
        description: 'Widget',
        unit_price: '12.5000',
        weight_lb: null,
      },
    });
    // create-only: update clause is always empty
    for (const c of calls) expect(c.update).toEqual({});
  });
});
