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

  it('sends shippingChargesPayment with the payor account matching the shipper account', async () => {
    const calls = mockFetchSequence([
      jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      jsonResponse({ output: { rateReplyDetails: [] } }),
    ]);
    const provider = new FedExRateProvider();
    await provider.getQuotes(REQUEST, CREDS);
    const body = JSON.parse(calls[1].init!.body as string);
    expect(body.accountNumber).toEqual({ value: '123456789' });
    expect(body.requestedShipment.shippingChargesPayment).toEqual({
      paymentType: 'SENDER',
      payor: {
        responsibleParty: { accountNumber: { value: '123456789' } },
      },
    });
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
    expect(body.requestedShipment.rateRequestType).toEqual(['LIST']);
  });
});
