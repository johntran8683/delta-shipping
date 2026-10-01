import { DhlRateProvider } from './dhl-rate.provider';
import type {
  CarrierRateCredentials,
  QuoteRequest,
} from './carrier-rate-provider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const creds: CarrierRateCredentials = {
  clientId: 'dhl-user',
  clientSecret: 'dhl-pass',
  accountNumber: '123456789',
  environment: 'SANDBOX',
};

const request: QuoteRequest = {
  origin: { postalCode: 'V3S1A1', countryCode: 'CA', city: 'Surrey' },
  destination: { postalCode: '10001', countryCode: 'US', city: 'New York' },
  packages: [{ weightLb: 10.5, lengthIn: 24, widthIn: 18, heightIn: 12 }],
};

describe('DhlRateProvider', () => {
  const realFetch = global.fetch;
  let calls: Array<{ url: string; init: RequestInit }> = [];

  beforeEach(() => {
    calls = [];
    global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ products: [] });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('posts a multi-piece rate request with Basic auth and DHL headers', async () => {
    await new DhlRateProvider().getQuotes(request, creds);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe('https://express.api.dhl.com/mydhlapi/test/rates');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('dhl-user:dhl-pass').toString('base64')}`,
    );
    expect(headers['Message-Reference']).toBeTruthy();
    expect(headers['Message-Reference-Date']).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}GMT[+-]\d{2}:\d{2}$/,
    );
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.unitOfMeasurement).toBe('imperial');
    expect(body.isCustomsDeclarable).toBe(true); // CA -> US
    expect(body.accounts).toEqual([
      { typeCode: 'shipper', number: '123456789' },
    ]);
    const details = body.customerDetails as Record<
      string,
      Record<string, string>
    >;
    expect(details.shipperDetails).toMatchObject({
      postalCode: 'V3S1A1',
      cityName: 'Surrey',
      countryCode: 'CA',
    });
    expect(details.receiverDetails).toMatchObject({
      postalCode: '10001',
      cityName: 'New York',
      countryCode: 'US',
    });
    expect(body.packages).toEqual([
      { weight: 10.5, dimensions: { length: 24, width: 18, height: 12 } },
    ]);
    expect(String(body.plannedShippingDateAndTime)).toMatch(
      /^\d{4}-\d{2}-\d{2}T09:00:00GMT[+-]\d{2}:\d{2}$/,
    );
  });

  it('uses the production base URL for production credentials', async () => {
    await new DhlRateProvider().getQuotes(request, {
      ...creds,
      environment: 'PRODUCTION',
    });
    expect(calls[0].url).toBe('https://express.api.dhl.com/mydhlapi/rates');
  });

  it('omits accounts when no account number is configured', async () => {
    await new DhlRateProvider().getQuotes(request, {
      ...creds,
      accountNumber: null,
    });
    const body = JSON.parse(String(calls[0].init.body)) as Record<
      string,
      unknown
    >;
    expect(body.accounts).toBeUndefined();
  });

  it('prefers the billing-currency price and normalizes products', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        products: [
          {
            productName: 'EXPRESS WORLDWIDE',
            productCode: 'P',
            totalPrice: [
              { currencyType: 'PULCL', priceCurrency: 'USD', price: 200 },
              { currencyType: 'BILLC', priceCurrency: 'USD', price: 141.51 },
            ],
            deliveryCapabilities: {
              estimatedDeliveryDateAndTime: '2026-10-05T12:00:00',
            },
          },
          {
            productName: 'EXPRESS 12:00',
            productCode: 'T',
            totalPrice: [
              { currencyType: 'PULCL', priceCurrency: 'USD', price: 180 },
            ],
          },
          { productName: 'NO PRICE', productCode: 'X', totalPrice: [] },
        ],
      }),
    ) as unknown as typeof fetch;

    const quotes = await new DhlRateProvider().getQuotes(request, creds);
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({
      carrierCode: 'DHL',
      carrierName: 'DHL Express',
      serviceCode: 'P',
      serviceName: 'EXPRESS WORLDWIDE',
      totalCharge: 141.51,
      currency: 'USD',
      estimatedDelivery: '2026-10-05',
    });
    expect(quotes[1]).toMatchObject({ serviceCode: 'T', totalCharge: 180 });
  });

  it('throws a clear auth error on 401', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ title: 'Unauthorized' }, 401),
    ) as unknown as typeof fetch;
    await expect(
      new DhlRateProvider().getQuotes(request, creds),
    ).rejects.toThrow(/authentication failed/i);
  });

  it('surfaces DHL problem+json error details', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(
        { title: 'Bad request', detail: 'planned date in the past' },
        400,
      ),
    ) as unknown as typeof fetch;
    await expect(
      new DhlRateProvider().getQuotes(request, creds),
    ).rejects.toThrow(/planned date in the past/);
  });

  it('requires a destination city', async () => {
    await expect(
      new DhlRateProvider().getQuotes(
        { ...request, destination: { postalCode: '10001', countryCode: 'US' } },
        creds,
      ),
    ).rejects.toThrow(/ship-to city/i);
    expect(calls).toHaveLength(0);
  });

  it('testConnection passes when auth succeeds even with a business error', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ title: 'Bad request', detail: 'no products' }, 400),
    ) as unknown as typeof fetch;
    await expect(
      new DhlRateProvider().testConnection(creds),
    ).resolves.toBeUndefined();
  });

  it('testConnection fails on 401', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ title: 'Unauthorized' }, 401),
    ) as unknown as typeof fetch;
    await expect(new DhlRateProvider().testConnection(creds)).rejects.toThrow(
      /authentication failed/i,
    );
  });
});
