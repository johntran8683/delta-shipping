import {
  sameShipGroup,
  splitShipGroupOptions,
  type ShipPeerRow,
} from './ship-group.policy';

const baseKeys = {
  sold_to_code: 'CUST-1',
  ship_to_code: 'ST-1',
  ship_to_location_id: 'loc-1',
  shipping_type: 'UPS Ground',
};

describe('sameShipGroup', () => {
  it('matches identical keys', () => {
    expect(sameShipGroup(baseKeys, { ...baseKeys })).toBe(true);
  });

  it('rejects a different customer, ship-to, or ship method', () => {
    expect(
      sameShipGroup(baseKeys, { ...baseKeys, sold_to_code: 'CUST-2' }),
    ).toBe(false);
    expect(sameShipGroup(baseKeys, { ...baseKeys, ship_to_code: 'ST-9' })).toBe(
      false,
    );
    expect(
      sameShipGroup(baseKeys, { ...baseKeys, ship_to_location_id: 'loc-9' }),
    ).toBe(false);
    expect(
      sameShipGroup(baseKeys, { ...baseKeys, shipping_type: 'FedEx' }),
    ).toBe(false);
  });

  it('treats null and empty shipping_type as equal after trimming', () => {
    expect(
      sameShipGroup(
        { ...baseKeys, shipping_type: null },
        { ...baseKeys, shipping_type: '' },
      ),
    ).toBe(true);
    expect(
      sameShipGroup(
        { ...baseKeys, shipping_type: '  UPS Ground  ' },
        { ...baseKeys, shipping_type: 'UPS Ground' },
      ),
    ).toBe(true);
  });

  it('treats null location ids as equal', () => {
    expect(
      sameShipGroup(
        { ...baseKeys, ship_to_location_id: null },
        { ...baseKeys, ship_to_location_id: null },
      ),
    ).toBe(true);
  });
});

function peer(
  id: string,
  current_status: string,
  dn_number = `DN-${id}`,
): ShipPeerRow {
  return { id, dn_number, current_status, total_products: '0' };
}

describe('splitShipGroupOptions', () => {
  it('splits PACKED peers into pickable and pre-pack peers into notPacked', () => {
    const peers = [
      peer('a', 'PACKED'),
      peer('b', 'PICKING'),
      peer('c', 'PACKED'),
      peer('d', 'NEW'),
    ];
    const { pickable, notPacked } = splitShipGroupOptions(peers, new Set());
    expect(pickable.map((p) => p.id)).toEqual(['a', 'c']);
    expect(notPacked.map((p) => p.id)).toEqual(['b', 'd']);
  });

  it('excludes pack-session mates from both lists', () => {
    const peers = [peer('a', 'PACKED'), peer('b', 'PICKING')];
    const { pickable, notPacked } = splitShipGroupOptions(
      peers,
      new Set(['a', 'b']),
    );
    expect(pickable).toEqual([]);
    expect(notPacked).toEqual([]);
  });

  it('ignores notes already shipping or in terminal states', () => {
    const peers = [
      peer('a', 'SHIPPING_IN_PROGRESS'),
      peer('b', 'SHIPPED'),
      peer('c', 'PACKED'),
    ];
    const { pickable, notPacked } = splitShipGroupOptions(peers, new Set());
    expect(pickable.map((p) => p.id)).toEqual(['c']);
    expect(notPacked).toEqual([]);
  });
});
