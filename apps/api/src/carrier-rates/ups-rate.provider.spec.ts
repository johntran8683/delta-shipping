import { UpsRateProvider } from './ups-rate.provider';
import type {
  CarrierRateCredentials,
  QuoteRequest,
} from './carrier-rate-provider';

const CREDS: CarrierRateCredentials = {
  clientId: 'cid',
  clientSecret: 'csecret',
  accountNumber: 'ABC123',
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

describe('UpsRateProvider', () => {
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

  it('authenticates with a Basic header and parses Shop quotes', async () => {
    const calls = mockFetchSequence([
      // UPS reports expires_in as a string; must be parsed, not hardcoded.
      jsonResponse({
        access_token: 'tok',
        expires_in: '14399',
        token_type: 'Bearer',
      }),
      jsonResponse({
        RateResponse: {
          RatedShipment: [
            {
              Service: { Code: '03', Description: 'UPS Ground' },
              TotalCharges: { MonetaryValue: '35.20', CurrencyCode: 'USD' },
              GuaranteedDelivery: { BusinessDaysInTransit: '5' },
            },
            {
              Service: { Code: '99' },
              TotalCharges: {
                MonetaryValue: 'not-a-number',
                CurrencyCode: 'USD',
              },
            },
          ],
        },
      }),
    ]);
    const provider = new UpsRateProvider();
    const quotes = await provider.getQuotes(REQUEST, CREDS);

    const authCall = calls[0];
    expect(authCall.url).toBe('https://wwwcie.ups.com/security/v1/oauth/token');
    const headers = authCall.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('cid:csecret').toString('base64')}`,
    );
    expect(calls[1].url).toBe(
      'https://wwwcie.ups.com/api/rating/v1/Shop?additionalinfo=timeintransit',
    );
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      carrierCode: 'UPS',
      serviceCode: '03',
      serviceName: 'UPS Ground',
      totalCharge: 35.2,
      currency: 'USD',
      transitDays: 5,
    });
  });

  it('falls back to the service-code map when no description is returned', async () => {
    mockFetchSequence([
      jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      jsonResponse({
        RateResponse: {
          RatedShipment: {
            Service: { Code: '03' },
            TotalCharges: { MonetaryValue: '10.00', CurrencyCode: 'USD' },
          },
        },
      }),
    ]);
    const provider = new UpsRateProvider();
    const quotes = await provider.getQuotes(REQUEST, CREDS);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].serviceName).toBe('UPS Ground');
  });

  it('throws a readable error when UPS rejects the request', async () => {
    mockFetchSequence([
      jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      jsonResponse({ response: { errors: [{ message: 'Invalid' }] } }, 400),
    ]);
    const provider = new UpsRateProvider();
    await expect(provider.getQuotes(REQUEST, CREDS)).rejects.toThrow(
      /UPS rate request failed \(400\)/,
    );
  });
});
