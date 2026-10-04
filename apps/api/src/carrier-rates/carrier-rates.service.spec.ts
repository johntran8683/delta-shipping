import { ForbiddenException } from '@nestjs/common';
import { CarrierRatesService } from './carrier-rates.service';
import { encryptSecret } from './crypto';
import type { SaveCarrierSettingsDto } from './dto/carrier-rates.dto';
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
        update: jest.fn(),
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

  it("quotes only the note's ship-method carrier (FedEx)", async () => {
    const { service, prisma, permissions } = buildService();
    permissions.roleHasPermission.mockResolvedValue(true);
    prisma.deliveryNote.findUnique.mockResolvedValue({
      id: 'dn-1',
      dn_number: 'DN-1',
      current_status: 'SHIPPING_IN_PROGRESS',
      shipping_group_id: null,
      shipping_type: 'FedEx Ground',
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
    prisma.carrierRateConfig.findUnique.mockResolvedValue({
      client_id: 'fcid',
      client_secret_enc: encryptSecret('fsecret'),
      account_number: '999',
      is_enabled: true,
    });
    prisma.packSessionDeliveryNote.findMany.mockResolvedValue([
      { pack_session_id: 'ps-1' },
    ]);
    prisma.packBox.findMany.mockResolvedValue([
      { weight_lb: '10.5', length_in: '24', width_in: '18', height_in: '12' },
      { weight_lb: '5', length_in: '12', width_in: '12', height_in: '12' },
    ]);
    const fetchCalls: string[] = [];
    global.fetch = jest.fn(async (url: unknown) => {
      fetchCalls.push(String(url));
      if (String(url).includes('/oauth/token')) {
        return jsonResponse({ access_token: 'ftok', expires_in: 3600 });
      }
      return jsonResponse({
        output: {
          rateReplyDetails: [
            {
              serviceType: 'FEDEX_GROUND',
              serviceName: 'FedEx Ground',
              ratedShipmentDetails: [
                { totalNetCharge: 42.17, currency: 'USD' },
              ],
            },
            {
              serviceType: 'FEDEX_2_DAY',
              serviceName: 'FedEx 2Day',
              ratedShipmentDetails: [{ totalNetCharge: 88.5, currency: 'USD' }],
            },
          ],
        },
      });
    }) as unknown as typeof fetch;

    const result = await service.getQuotesForDeliveryNote('dn-1', payload);

    // Only FedEx was called — no UPS token/rate calls.
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls.every((u) => u.includes('fedex.com'))).toBe(true);
    expect(result.packageCount).toBe(2);
    expect(result.deliveryNoteCount).toBe(1);
    expect(result.notices).toEqual([]);
    expect(result.quotes).toHaveLength(2);
    // Sorted by price: Ground 42.17 before 2Day 88.50.
    expect(result.quotes[0].carrierCode).toBe('FEDEX');
    expect(result.quotes[0].totalCharge).toBe(42.17);
    expect(result.quotes[1].totalCharge).toBe(88.5);
  });

  it('derives the destination country code from the country name', async () => {
    const { service, prisma, permissions } = buildService();
    permissions.roleHasPermission.mockResolvedValue(true);
    prisma.deliveryNote.findUnique.mockResolvedValue({
      id: 'dn-1',
      dn_number: 'DN-1',
      current_status: 'SHIPPING_IN_PROGRESS',
      shipping_group_id: null,
      shipping_type: 'FedEx Ground',
      // No country_code — only the name, as imported from a "Country" column.
      ship_to_location: {
        postal_code: '80100',
        country_code: null,
        country_name: 'United States',
        city: 'Mombasa',
        state_region: 'CA',
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
    prisma.carrierRateConfig.findUnique.mockResolvedValue({
      client_id: 'fcid',
      client_secret_enc: encryptSecret('fsecret'),
      account_number: '999',
      is_enabled: true,
    });
    prisma.packSessionDeliveryNote.findMany.mockResolvedValue([
      { pack_session_id: 'ps-1' },
    ]);
    prisma.packBox.findMany.mockResolvedValue([
      { weight_lb: '10', length_in: '15', width_in: '15', height_in: '12' },
    ]);
    const bodies: string[] = [];
    global.fetch = jest.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).includes('/oauth/token')) {
        return jsonResponse({
          access_token: 'tok',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      bodies.push(String(init?.body ?? ''));
      return jsonResponse({
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
      });
    }) as unknown as typeof fetch;

    const result = await service.getQuotesForDeliveryNote('dn-1', payload);

    expect(result.quotes).toHaveLength(1);
    expect(bodies.some((b) => b.includes('"countryCode":"US"'))).toBe(true);
  });

  it('names the missing address field in the quote error', async () => {
    const { service, prisma, permissions } = buildService();
    permissions.roleHasPermission.mockResolvedValue(true);
    prisma.deliveryNote.findUnique.mockResolvedValue({
      id: 'dn-1',
      dn_number: 'DN-1',
      current_status: 'SHIPPING_IN_PROGRESS',
      shipping_group_id: null,
      shipping_type: 'FedEx Ground',
      ship_to_location: {
        postal_code: '80100',
        country_code: null,
        country_name: null,
        city: 'Mombasa',
        state_region: 'CA',
      },
    });
    prisma.appSetting.findUnique.mockResolvedValue({
      value: JSON.stringify({ postalCode: 'V3S 1A1', countryCode: 'CA' }),
    });

    await expect(
      service.getQuotesForDeliveryNote('dn-1', payload),
    ).rejects.toThrow(
      'The ship-to address is missing country code, so no quote can be requested.',
    );
  });

  it('quotes only UPS when the ship method is UPS', async () => {
    const { service, prisma, permissions } = buildService();
    permissions.roleHasPermission.mockResolvedValue(true);
    prisma.deliveryNote.findUnique.mockResolvedValue({
      id: 'dn-1',
      dn_number: 'DN-1',
      current_status: 'SHIPPING_IN_PROGRESS',
      shipping_group_id: null,
      shipping_type: 'UPS',
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
    prisma.carrierRateConfig.findUnique.mockResolvedValue({
      client_id: 'ucid',
      client_secret_enc: encryptSecret('usecret'),
      account_number: null,
      is_enabled: true,
    });
    prisma.packSessionDeliveryNote.findMany.mockResolvedValue([
      { pack_session_id: 'ps-1' },
    ]);
    prisma.packBox.findMany.mockResolvedValue([
      { weight_lb: '10', length_in: '24', width_in: '18', height_in: '12' },
    ]);
    const fetchCalls: string[] = [];
    global.fetch = jest.fn(async (url: unknown) => {
      fetchCalls.push(String(url));
      if (String(url).includes('/oauth/token')) {
        return jsonResponse({ access_token: 'utok', expires_in: 3600 });
      }
      return jsonResponse({
        RateResponse: {
          RatedShipment: {
            Service: { Code: '03', Description: 'UPS Ground' },
            TotalCharges: { MonetaryValue: '30.00', CurrencyCode: 'USD' },
          },
        },
      });
    }) as unknown as typeof fetch;

    const result = await service.getQuotesForDeliveryNote('dn-1', payload);

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls.every((u) => u.includes('ups.com'))).toBe(true);
    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0].carrierCode).toBe('UPS');
    expect(result.quotes[0].totalCharge).toBe(30);
  });

  it('routes DHL ship methods to the DHL provider', async () => {
    const { service, prisma, permissions } = buildService();
    permissions.roleHasPermission.mockResolvedValue(true);
    prisma.deliveryNote.findUnique.mockResolvedValue({
      id: 'dn-1',
      dn_number: 'DN-1',
      current_status: 'SHIPPING_IN_PROGRESS',
      shipping_group_id: null,
      shipping_type: 'DHL Express',
      ship_to_location: {
        postal_code: '10001',
        country_code: 'US',
        city: 'New York',
      },
    });
    prisma.appSetting.findUnique.mockImplementation(
      async ({ where }: { where: { key: string } }) =>
        where.key === 'rate_quote_origin'
          ? {
              value: JSON.stringify({
                postalCode: 'V3S1A1',
                countryCode: 'CA',
                city: 'Surrey',
              }),
            }
          : null,
    );
    prisma.carrierRateConfig.findUnique.mockResolvedValue({
      client_id: 'dhl-user',
      client_secret_enc: encryptSecret('dhl-pass'),
      account_number: '123456789',
      is_enabled: true,
    });
    prisma.packSessionDeliveryNote.findMany.mockResolvedValue([
      { pack_session_id: 'ps-1' },
    ]);
    prisma.packBox.findMany.mockResolvedValue([
      { weight_lb: '10', length_in: '24', width_in: '18', height_in: '12' },
    ]);
    const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
    global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        products: [
          {
            productName: 'EXPRESS WORLDWIDE',
            productCode: 'P',
            totalPrice: [
              { currencyType: 'BILLC', priceCurrency: 'USD', price: 120.5 },
            ],
          },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await service.getQuotesForDeliveryNote('dn-1', payload);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(
      'https://express.api.dhl.com/mydhlapi/test/rates',
    );
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('dhl-user:dhl-pass').toString('base64')}`,
    );
    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0]).toMatchObject({
      carrierCode: 'DHL',
      serviceCode: 'P',
      totalCharge: 120.5,
      currency: 'USD',
    });
  });

  it('blocks a note with no ship method', async () => {
    const { service, prisma, permissions } = buildService();
    permissions.roleHasPermission.mockResolvedValue(true);
    prisma.deliveryNote.findUnique.mockResolvedValue({
      id: 'dn-1',
      dn_number: 'DN-1',
      current_status: 'SHIPPING_IN_PROGRESS',
      shipping_group_id: null,
      shipping_type: null,
      ship_to_location: { postal_code: '10001', country_code: 'US' },
    });
    await expect(
      service.getQuotesForDeliveryNote('dn-1', payload),
    ).rejects.toThrow(/no ship method/);
  });

  it('blocks a note with an unsupported ship method', async () => {
    const { service, prisma, permissions } = buildService();
    permissions.roleHasPermission.mockResolvedValue(true);
    prisma.deliveryNote.findUnique.mockResolvedValue({
      id: 'dn-1',
      dn_number: 'DN-1',
      current_status: 'SHIPPING_IN_PROGRESS',
      shipping_group_id: null,
      shipping_type: 'USPS',
      ship_to_location: { postal_code: '10001', country_code: 'US' },
    });
    await expect(
      service.getQuotesForDeliveryNote('dn-1', payload),
    ).rejects.toThrow(/only available for FedEx, UPS, and DHL/);
  });

  it('fails clearly when the ship-method carrier is not configured', async () => {
    const { service, prisma, permissions } = buildService();
    permissions.roleHasPermission.mockResolvedValue(true);
    prisma.deliveryNote.findUnique.mockResolvedValue({
      id: 'dn-1',
      dn_number: 'DN-1',
      current_status: 'SHIPPING_IN_PROGRESS',
      shipping_group_id: null,
      shipping_type: 'FedEx',
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
    prisma.carrierRateConfig.findUnique.mockResolvedValue(null);
    prisma.packSessionDeliveryNote.findMany.mockResolvedValue([
      { pack_session_id: 'ps-1' },
    ]);
    prisma.packBox.findMany.mockResolvedValue([
      { weight_lb: '10', length_in: '24', width_in: '18', height_in: '12' },
    ]);
    await expect(
      service.getQuotesForDeliveryNote('dn-1', payload),
    ).rejects.toThrow(/not configured/);
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

  it('saves the origin address and gates non-supervisors', async () => {
    const { service, prisma } = buildService();
    prisma.role.findUnique.mockResolvedValue({ code: 'SUPERVISOR' });

    await service.saveOrigin(
      {
        origin: {
          street: '17850 56 Ave',
          city: 'Surrey',
          stateOrProvinceCode: 'BC',
          postalCode: 'V3S 1A1',
          countryCode: 'ca',
        },
      },
      payload,
    );

    expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'rate_quote_origin' },
      create: {
        key: 'rate_quote_origin',
        value: JSON.stringify({
          street: '17850 56 Ave',
          city: 'Surrey',
          stateOrProvinceCode: 'BC',
          postalCode: 'V3S 1A1',
          countryCode: 'CA',
        }),
      },
      update: {
        value: JSON.stringify({
          street: '17850 56 Ave',
          city: 'Surrey',
          stateOrProvinceCode: 'BC',
          postalCode: 'V3S 1A1',
          countryCode: 'CA',
        }),
      },
    });
    expect(prisma.carrierRateConfig.upsert).not.toHaveBeenCalled();

    prisma.role.findUnique.mockResolvedValue({ code: 'PACKER' });
    await expect(
      service.saveOrigin(
        {
          origin: { postalCode: 'V3S 1A1', countryCode: 'CA' },
        },
        payload,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  function carrierDto(
    overrides: Partial<SaveCarrierSettingsDto> = {},
  ): SaveCarrierSettingsDto {
    return {
      activeEnvironment: 'SANDBOX',
      sandbox: {
        clientId: 'test-key',
        clientSecret: 'test-secret',
        accountNumber: '800717485',
        isEnabled: true,
      },
      production: {
        clientId: '',
        clientSecret: '',
        accountNumber: '',
        isEnabled: false,
      },
      ...overrides,
    };
  }

  it('saves one carrier without touching the others', async () => {
    const { service, prisma } = buildService();
    prisma.role.findUnique.mockResolvedValue({ code: 'SUPERVISOR' });
    prisma.appSetting.findUnique.mockResolvedValue(null);
    prisma.carrierRateConfig.findUnique.mockResolvedValue(null);

    await service.saveCarrier('FEDEX', carrierDto(), payload);

    // Active environment merged with the stored fallback for other carriers.
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'rate_quote_active_env' },
      create: {
        key: 'rate_quote_active_env',
        value: JSON.stringify({ FEDEX: 'SANDBOX', UPS: 'SANDBOX', DHL: 'SANDBOX' }),
      },
      update: {
        value: JSON.stringify({ FEDEX: 'SANDBOX', UPS: 'SANDBOX', DHL: 'SANDBOX' }),
      },
    });
    // Enabled sandbox env is upserted with an encrypted secret…
    expect(prisma.carrierRateConfig.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = prisma.carrierRateConfig.upsert.mock.calls[0][0];
    expect(upsertArg.where.carrier_code_environment).toEqual({
      carrier_code: 'FEDEX',
      environment: 'SANDBOX',
    });
    expect(upsertArg.create.client_id).toBe('test-key');
    expect(upsertArg.create.is_enabled).toBe(true);
    expect(upsertArg.create.client_secret_enc).not.toContain('test-secret');
    // …while the disabled production env with no stored row is skipped.
    expect(prisma.carrierRateConfig.update).not.toHaveBeenCalled();
  });

  it('requires a secret the first time an enabled environment is saved', async () => {
    const { service, prisma } = buildService();
    prisma.role.findUnique.mockResolvedValue({ code: 'SUPERVISOR' });
    prisma.carrierRateConfig.findUnique.mockResolvedValue(null);

    const dto = carrierDto();
    dto.sandbox.clientSecret = '';
    await expect(service.saveCarrier('FEDEX', dto, payload)).rejects.toThrow(
      'FEDEX SANDBOX: a client secret is required the first time credentials are saved.',
    );
  });

  it('keeps the stored secret when a blank one is sent for an enabled env', async () => {
    const { service, prisma } = buildService();
    prisma.role.findUnique.mockResolvedValue({ code: 'SUPERVISOR' });
    prisma.carrierRateConfig.findUnique.mockResolvedValue({
      carrier_code: 'FEDEX',
      environment: 'SANDBOX',
      client_secret_enc: encryptSecret('old-secret'),
    });

    const dto = carrierDto();
    dto.sandbox.clientSecret = '';
    await service.saveCarrier('FEDEX', dto, payload);

    const upsertArg = prisma.carrierRateConfig.upsert.mock.calls[0][0];
    expect(upsertArg.update.client_secret_enc).toBeUndefined();
    expect(upsertArg.update.client_id).toBe('test-key');
  });

  it('disabling an environment keeps stored credentials and switches it off', async () => {
    const { service, prisma } = buildService();
    prisma.role.findUnique.mockResolvedValue({ code: 'SUPERVISOR' });
    const existing = {
      carrier_code: 'FEDEX',
      environment: 'SANDBOX',
      client_id: 'old-key',
      client_secret_enc: encryptSecret('old-secret'),
      account_number: '111',
      is_enabled: true,
    };
    prisma.carrierRateConfig.findUnique.mockImplementation((args: {
      where: { carrier_code_environment: { environment: string } };
    }) =>
      Promise.resolve(
        args.where.carrier_code_environment.environment === 'SANDBOX'
          ? existing
          : null,
      ),
    );

    const dto = carrierDto();
    dto.sandbox.isEnabled = false;
    dto.sandbox.clientId = '';
    dto.sandbox.clientSecret = '';
    await service.saveCarrier('FEDEX', dto, payload);

    expect(prisma.carrierRateConfig.upsert).not.toHaveBeenCalled();
    expect(prisma.carrierRateConfig.update).toHaveBeenCalledTimes(1);
    const updateArg = prisma.carrierRateConfig.update.mock.calls[0][0];
    expect(updateArg.data.is_enabled).toBe(false);
    expect(updateArg.data.client_secret_enc).toBeUndefined();
  });

  it('rejects unknown carriers and non-supervisors', async () => {
    const { service, prisma } = buildService();
    prisma.role.findUnique.mockResolvedValue({ code: 'SUPERVISOR' });

    await expect(
      service.saveCarrier('USPS', carrierDto(), payload),
    ).rejects.toThrow('Unknown carrier: USPS');

    prisma.role.findUnique.mockResolvedValue({ code: 'SHIPPER' });
    await expect(
      service.saveCarrier('FEDEX', carrierDto(), payload),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
