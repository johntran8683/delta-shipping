import { ForbiddenException } from '@nestjs/common';
import { CarrierRatesService } from './carrier-rates.service';
import { encryptSecret } from './crypto';
import type { JwtPayload } from '../auth/jwt-payload';

const TEST_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('CarrierRatesService', () => {
  const realFetch = global.fetch;
  const OLD_KEY = process.env.CARRIER_CREDENTIALS_KEY;

  beforeEach(() => {
    process.env.CARRIER_CREDENTIALS_KEY = TEST_KEY;
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
    if (OLD_KEY === undefined) delete process.env.CARRIER_CREDENTIALS_KEY;
    else process.env.CARRIER_CREDENTIALS_KEY = OLD_KEY;
  });

  function buildService(prismaOverrides: Record<string, unknown> = {}) {
    const prisma = {
      role: { findUnique: jest.fn() },
      appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
      carrierRateConfig: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      deliveryNote: { findUnique: jest.fn(), findMany: jest.fn() },
      packSessionDeliveryNote: { findMany: jest.fn() },
      packBox: { findMany: jest.fn() },
      ...prismaOverrides,
    };
    const permissions = { roleHasPermission: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new CarrierRatesService(prisma as any, permissions as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { service, prisma: prisma as any, permissions: permissions as any };
  }

  const payload: JwtPayload = {
    sub: 'user-1',
    email: 's@x.com',
    activeRoleId: 'role-1',
  };

  function mockFetchSequence(responses: Response[]) {
    global.fetch = jest.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error('unexpected fetch call');
      return next;
    }) as unknown as typeof fetch;
  }

  it('returns quotes from both carriers sorted by price', async () => {
    const { service, prisma, permissions } = buildService();
    permissions.roleHasPermission.mockResolvedValue(true);
    prisma.deliveryNote.findUnique.mockResolvedValue({
      id: 'dn-1',
      dn_number: 'DN-1',
      current_status: 'SHIPPING_IN_PROGRESS',
      shipping_group_id: null,
      ship_to_location: {
        postal_code: '10001',
        country_code: 'US',
        city: 'New York',
        state_region: 'NY',
      },
    });
    prisma.appSetting.findUnique.mockImplementation(
      async ({ where }: { where: { key: string } }) => {
        if (where.key === 'rate_quote_origin') {
          return {
            value: JSON.stringify({ postalCode: 'V3S 1A1', countryCode: 'CA' }),
          };
        }
        return null;
      },
    );
    const fedexRow = {
      client_id: 'fcid',
      client_secret_enc: encryptSecret('fsecret'),
      account_number: '999',
      is_enabled: true,
    };
    const upsRow = {
      client_id: 'ucid',
      client_secret_enc: encryptSecret('usecret'),
      account_number: null,
      is_enabled: true,
    };
    prisma.carrierRateConfig.findUnique.mockImplementation(
      async ({
        where,
      }: {
        where: { carrier_code_environment: { carrier_code: string } };
      }) =>
        where.carrier_code_environment.carrier_code === 'FEDEX'
          ? fedexRow
          : upsRow,
    );
    prisma.packSessionDeliveryNote.findMany.mockResolvedValue([
      { pack_session_id: 'ps-1' },
    ]);
    prisma.packBox.findMany.mockResolvedValue([
      { weight_lb: '10.5', length_in: '24', width_in: '18', height_in: '12' },
      { weight_lb: '5', length_in: '12', width_in: '12', height_in: '12' },
    ]);
    mockFetchSequence([
      jsonResponse({ access_token: 'ftok', expires_in: 3600 }),
      jsonResponse({
        output: {
          rateReplyDetails: [
            {
              serviceType: 'FEDEX_GROUND',
              serviceName: 'FedEx Ground',
              ratedShipmentDetails: [
                { totalNetCharge: 42.17, currency: 'USD' },
              ],
            },
          ],
        },
      }),
      jsonResponse({ access_token: 'utok', expires_in: '14399' }),
      jsonResponse({
        RateResponse: {
          RatedShipment: {
            Service: { Code: '03', Description: 'UPS Ground' },
            TotalCharges: { MonetaryValue: '30.00', CurrencyCode: 'USD' },
          },
        },
      }),
    ]);

    const result = await service.getQuotesForDeliveryNote('dn-1', payload);

    expect(result.packageCount).toBe(2);
    expect(result.deliveryNoteCount).toBe(1);
    expect(result.notices).toEqual([]);
    expect(result.quotes).toHaveLength(2);
    // Sorted by price: UPS 30.00 before FedEx 42.17.
    expect(result.quotes[0].carrierCode).toBe('UPS');
    expect(result.quotes[0].totalCharge).toBe(30);
    expect(result.quotes[1].carrierCode).toBe('FEDEX');
  });

  it('adds a notice when a carrier fails but still returns the other quotes', async () => {
    const { service, prisma, permissions } = buildService();
    permissions.roleHasPermission.mockResolvedValue(true);
    prisma.deliveryNote.findUnique.mockResolvedValue({
      id: 'dn-1',
      dn_number: 'DN-1',
      current_status: 'SHIPPING_IN_PROGRESS',
      shipping_group_id: null,
      ship_to_location: { postal_code: '10001', country_code: 'US' },
    });
    prisma.appSetting.findUnique.mockImplementation(
      async ({ where }: { where: { key: string } }) =>
        where.key === 'rate_quote_origin'
          ? {
              value: JSON.stringify({
                postalCode: 'V3S1A1',
                countryCode: 'CA',
              }),
            }
          : null,
    );
    prisma.carrierRateConfig.findUnique.mockImplementation(
      async ({
        where: _where,
      }: {
        where: { carrier_code_environment: { carrier_code: string } };
      }) => ({
        client_id: 'cid',
        client_secret_enc: encryptSecret('secret'),
        account_number: null,
        is_enabled: true,
      }),
    );
    prisma.packSessionDeliveryNote.findMany.mockResolvedValue([
      { pack_session_id: 'ps-1' },
    ]);
    prisma.packBox.findMany.mockResolvedValue([
      { weight_lb: '10', length_in: '24', width_in: '18', height_in: '12' },
    ]);
    mockFetchSequence([
      jsonResponse({ access_token: 'ftok', expires_in: 3600 }),
      jsonResponse({ errors: [{ message: 'Boom' }] }),
      jsonResponse({ access_token: 'utok', expires_in: 3600 }),
      jsonResponse({
        RateResponse: {
          RatedShipment: {
            Service: { Code: '03' },
            TotalCharges: { MonetaryValue: '30.00', CurrencyCode: 'USD' },
          },
        },
      }),
    ]);

    const result = await service.getQuotesForDeliveryNote('dn-1', payload);

    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0].carrierCode).toBe('UPS');
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatch(/FedEx/);
  });

  it('rejects quotes when the note is not in SHIPPING_IN_PROGRESS', async () => {
    const { service, prisma, permissions } = buildService();
    permissions.roleHasPermission.mockResolvedValue(true);
    prisma.deliveryNote.findUnique.mockResolvedValue({
      id: 'dn-1',
      dn_number: 'DN-1',
      current_status: 'PACKED',
      shipping_group_id: null,
      ship_to_location: null,
    });
    await expect(
      service.getQuotesForDeliveryNote('dn-1', payload),
    ).rejects.toThrow(/only available while shipping is in progress/);
  });

  it('masks secrets in the settings view and gates non-supervisors', async () => {
    const { service, prisma } = buildService();
    prisma.role.findUnique.mockResolvedValue({ code: 'SUPERVISOR' });
    prisma.appSetting.findUnique.mockResolvedValue(null);
    prisma.carrierRateConfig.findMany.mockResolvedValue([
      {
        carrier_code: 'FEDEX',
        environment: 'SANDBOX',
        client_id: 'fcid',
        client_secret_enc: encryptSecret('fsecret-value'),
        account_number: '999',
        is_enabled: true,
      },
    ]);

    const view = await service.getSettings(payload);

    const fedexSandbox = view.carriers.FEDEX.sandbox;
    expect(fedexSandbox?.clientId).toBe('fcid');
    expect(fedexSandbox?.secretSet).toBe(true);
    expect(fedexSandbox?.secretLast4).toBe('alue');
    expect(JSON.stringify(view)).not.toContain('fsecret-value');
    expect(view.carriers.FEDEX.production).toBeNull();

    prisma.role.findUnique.mockResolvedValue({ code: 'CSA' });
    await expect(service.getSettings(payload)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
