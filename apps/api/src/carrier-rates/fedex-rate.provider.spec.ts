import { FedExRateProvider } from './fedex-rate.provider';
import type {
  CarrierRateCredentials,
  QuoteRequest,
} from './carrier-rate-provider';

const CREDS: CarrierRateCredentials = {
  clientId: 'cid',
  clientSecret: 'csecret',
  accountNumber: '123456789',
  environment: 'SANDBOX',
};

const REQUEST: QuoteRequest = {
  origin: { postalCode: 'V3S1A1', countryCode: 'CA' },
  destination: { postalCode: '10001', countryCode: 'US' },
  packages: [{ weightLb: 10.5, lengthIn: 24, widthIn: 18, heightIn: 12 }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('FedExRateProvider', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  function mockFetchSequence(responses: Response[]) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error('unexpected fetch call');
      return next;
    }) as unknown as typeof fetch;
    return calls;
  }

  it('fetches an OAuth token then parses rate quotes', async () => {
    const calls = mockFetchSequence([
      jsonResponse({
        access_token: 'tok',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
      jsonResponse({
        output: {
          rateReplyDetails: [
            {
              serviceType: 'FEDEX_GROUND',
              serviceName: 'FedEx Ground',
              operationalDetail: { transitTime: 'THREE_DAYS' },
              commit: { dateDetail: { dayFormat: '2026-10-05' } },
              ratedShipmentDetails: [
                { totalNetCharge: 42.17, currency: 'USD' },
              ],
            },
            {
              serviceType: 'FEDEX_2_DAY',
              serviceName: 'FedEx 2Day',
              ratedShipmentDetails: [{ totalNetCharge: 88.5, currency: 'USD' }],
            },
            {
              // skipped: no charge
              serviceType: 'PRIORITY_OVERNIGHT',
              ratedShipmentDetails: [],
            },
          ],
        },
      }),
    ]);
    const provider = new FedExRateProvider();
    const quotes = await provider.getQuotes(REQUEST, CREDS);

    expect(calls[0].url).toBe('https://apis-sandbox.fedex.com/oauth/token');
    expect(calls[1].url).toBe(
      'https://apis-sandbox.fedex.com/rate/v1/rates/quotes',
    );
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body.requestedShipment.customsClearanceDetail).toMatchObject({
      dutiesPayment: { paymentType: 'SENDER' },
      commodities: [
        {
          description: 'Industrial control equipment',
          countryOfManufacture: 'CA',
          quantity: 1,
          weight: { units: 'LB', value: 10.5 },
          customsValue: { amount: 1, currency: 'USD' },
        },
      ],
    });
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({
      carrierCode: 'FEDEX',
      serviceCode: 'FEDEX_GROUND',
      serviceName: 'FedEx Ground',
      totalCharge: 42.17,
      currency: 'USD',
      transitDays: 3,
      estimatedDelivery: '2026-10-05',
    });
    expect(quotes[1].transitDays).toBeNull();
  });

  it('uses the US-dollar preferred price when FedEx also returns another currency', async () => {
    mockFetchSequence([
      jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      jsonResponse({
        output: {
          rateReplyDetails: [
            {
              serviceType: 'INTERNATIONAL_ECONOMY',
              serviceName: 'FedEx International Economy',
              ratedShipmentDetails: [
                {
                  rateType: 'ACCOUNT',
                  totalNetCharge: 527.13,
                  currency: 'PLN',
                },
                {
                  rateType: 'PREFERRED_CURRENCY',
                  totalNetCharge: 134.42,
                  currency: 'USD',
                },
              ],
            },
            {
              serviceType: 'FEDEX_GROUND',
              serviceName: 'FedEx International Ground',
              ratedShipmentDetails: [
                { rateType: 'ACCOUNT', totalNetCharge: 53.95, currency: 'CAD' },
                {
                  rateType: 'PREFERRED_CURRENCY',
                  totalNetCharge: 37.82,
                  currency: 'USD',
                },
              ],
            },
          ],
        },
      }),
    ]);
    const quotes = await new FedExRateProvider().getQuotes(REQUEST, CREDS);
    expect(quotes).toEqual([
      expect.objectContaining({
        serviceCode: 'INTERNATIONAL_ECONOMY',
        totalCharge: 134.42,
        currency: 'USD',
      }),
      expect.objectContaining({
        serviceCode: 'FEDEX_GROUND',
        totalCharge: 37.82,
        currency: 'USD',
      }),
    ]);
  });

  it('omits customs clearance for a domestic quote', async () => {
    const calls = mockFetchSequence([
      jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      jsonResponse({ output: { rateReplyDetails: [] } }),
    ]);
    const provider = new FedExRateProvider();
    await provider.getQuotes(
      {
        ...REQUEST,
        destination: { postalCode: 'M5V2T6', countryCode: 'CA' },
      },
      CREDS,
    );
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body.requestedShipment.customsClearanceDetail).toBeUndefined();
  });

  it('reuses the cached token for a second quote call', async () => {
    const calls = mockFetchSequence([
      jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      jsonResponse({ output: { rateReplyDetails: [] } }),
      jsonResponse({ output: { rateReplyDetails: [] } }),
    ]);
    const provider = new FedExRateProvider();
    await provider.getQuotes(REQUEST, CREDS);
    await provider.getQuotes(REQUEST, CREDS);
    expect(calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(1);
  });

  it('surfaces FedEx error envelopes', async () => {
    mockFetchSequence([
      jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      jsonResponse({ errors: [{ message: 'Invalid postal code.' }] }),
    ]);
    const provider = new FedExRateProvider();
    await expect(provider.getQuotes(REQUEST, CREDS)).rejects.toThrow(
      /Invalid postal code/,
    );
  });

  it('testConnection only fetches a token', async () => {
    const calls = mockFetchSequence([
      jsonResponse({ access_token: 'tok', expires_in: 3600 }),
    ]);
    const provider = new FedExRateProvider();
    await provider.testConnection(CREDS);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/oauth/token');
  });

  it('sends the account number without a shipping-charges payor', async () => {
    const calls = mockFetchSequence([
      jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      jsonResponse({ output: { rateReplyDetails: [] } }),
    ]);
    const provider = new FedExRateProvider();
    await provider.getQuotes(REQUEST, CREDS);
    const body = JSON.parse(calls[1].init!.body as string);
    expect(body.accountNumber).toEqual({ value: '123456789' });
    expect(body.requestedShipment.shippingChargesPayment).toBeUndefined();
    expect(body.requestedShipment.rateRequestType).toEqual([
      'ACCOUNT',
      'PREFERRED',
    ]);
    expect(body.requestedShipment.preferredCurrency).toBe('USD');
  });

  it('omits shippingChargesPayment when no account number is configured', async () => {
    const calls = mockFetchSequence([
      jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      jsonResponse({ output: { rateReplyDetails: [] } }),
    ]);
    const provider = new FedExRateProvider();
    await provider.getQuotes(REQUEST, { ...CREDS, accountNumber: null });
    const body = JSON.parse(calls[1].init!.body as string);
    expect(body.accountNumber).toBeUndefined();
    expect(body.requestedShipment.shippingChargesPayment).toBeUndefined();
    expect(body.requestedShipment.rateRequestType).toEqual([
      'LIST',
      'PREFERRED',
    ]);
    expect(body.requestedShipment.preferredCurrency).toBe('USD');
  });

  it('sends the full shipper and recipient addresses (city + state/province)', async () => {
    const calls = mockFetchSequence([
      jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      jsonResponse({ output: { rateReplyDetails: [] } }),
    ]);
    const provider = new FedExRateProvider();
    const req: QuoteRequest = {
      origin: {
        postalCode: 'V3S6C4',
        countryCode: 'CA',
        city: 'Surrey',
        stateOrProvinceCode: 'BC',
      },
      destination: {
        postalCode: '10001',
        countryCode: 'US',
        city: 'New York',
        stateOrProvinceCode: 'NY',
      },
      packages: REQUEST.packages,
    };
    await provider.getQuotes(req, CREDS);
    const body = JSON.parse(calls[1].init!.body as string);
    expect(body.requestedShipment.shipper.address).toEqual({
      postalCode: 'V3S6C4',
      countryCode: 'CA',
      city: 'Surrey',
      stateOrProvinceCode: 'BC',
    });
    expect(body.requestedShipment.recipient.address).toEqual({
      postalCode: '10001',
      countryCode: 'US',
      city: 'New York',
      stateOrProvinceCode: 'NY',
    });
  });

  it('omits city and stateOrProvinceCode when they are blank', async () => {
    const calls = mockFetchSequence([
      jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      jsonResponse({ output: { rateReplyDetails: [] } }),
    ]);
    const provider = new FedExRateProvider();
    const req: QuoteRequest = {
      origin: {
        postalCode: 'V3S6C4',
        countryCode: 'CA',
        city: '  ',
        stateOrProvinceCode: '',
      },
      destination: { postalCode: '10001', countryCode: 'US' },
      packages: REQUEST.packages,
    };
    await provider.getQuotes(req, CREDS);
    const body = JSON.parse(calls[1].init!.body as string);
    expect(body.requestedShipment.shipper.address).toEqual({
      postalCode: 'V3S6C4',
      countryCode: 'CA',
    });
    expect(body.requestedShipment.recipient.address).toEqual({
      postalCode: '10001',
      countryCode: 'US',
    });
  });
});
