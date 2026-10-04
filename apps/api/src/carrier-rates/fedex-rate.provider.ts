/**
 * FedEx Rate API v1 client.
 *
 * Auth: OAuth 2.0 client credentials — POST /oauth/token (token lasts 60 min).
 * Rates: POST /rate/v1/rates/quotes with the account number so quotes reflect
 * the customer's negotiated rates.
 *
 * Docs: https://developer.fedex.com/api/en-us/catalog/rate/v1/docs.html
 */

import type {
  CarrierRateCredentials,
  CarrierRateProvider,
  QuotePackage,
  QuoteRequest,
  RateQuote,
} from './carrier-rate-provider';
import { OAuthTokenCache } from './oauth-token-cache';

const BASE_URLS: Record<string, string> = {
  SANDBOX: 'https://apis-sandbox.fedex.com',
  PRODUCTION: 'https://apis.fedex.com',
};

const REQUEST_TIMEOUT_MS = 20000;

interface FedExRateReplyDetail {
  serviceType?: string;
  serviceName?: string;
  commit?: {
    dateDetail?: { dayFormat?: string };
  };
  operationalDetail?: {
    transitTime?: string;
  };
  ratedShipmentDetails?: Array<{
    totalNetCharge?: number;
    currency?: string;
  }>;
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return `HTTP ${res.status}`;
  }
}

function parseTransitDays(detail: FedExRateReplyDetail): number | null {
  const raw = detail.operationalDetail?.transitTime?.trim().toUpperCase();
  if (!raw) return null;
  // FedEx values look like "ONE_DAY", "TWO_DAYS", "THREE_DAYS", ...
  const words: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
    SIX: 6,
    SEVEN: 7,
    EIGHT: 8,
    NINE: 9,
    TEN: 10,
  };
  for (const [word, days] of Object.entries(words)) {
    if (raw.startsWith(word)) return days;
  }
  return null;
}

function toLineItem(pkg: QuotePackage) {
  return {
    weight: { units: 'LB', value: round2(pkg.weightLb) },
    dimensions: {
      length: round2(pkg.lengthIn),
      width: round2(pkg.widthIn),
      height: round2(pkg.heightIn),
      units: 'IN',
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class FedExRateProvider implements CarrierRateProvider {
  readonly code = 'FEDEX' as const;
  readonly displayName = 'FedEx';

  constructor(private readonly tokenCache = new OAuthTokenCache()) {}

  private baseUrl(creds: CarrierRateCredentials): string {
    return BASE_URLS[creds.environment] ?? BASE_URLS.PRODUCTION;
  }

  private cacheKey(creds: CarrierRateCredentials): string {
    return `fedex:${creds.environment}:${creds.clientId}`;
  }

  async testConnection(creds: CarrierRateCredentials): Promise<void> {
    this.tokenCache.clear(this.cacheKey(creds));
    await this.getAccessToken(creds);
  }

  private async getAccessToken(creds: CarrierRateCredentials): Promise<string> {
    return this.tokenCache.getToken(this.cacheKey(creds), async () => {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      });
      const res = await fetchWithTimeout(`${this.baseUrl(creds)}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        throw new Error(
          `FedEx auth failed (${res.status}): ${await readErrorBody(res)}`,
        );
      }
      const json = (await res.json()) as {
        access_token?: string;
        expires_in?: number | string;
      };
      if (!json.access_token) {
        throw new Error('FedEx auth returned no access token.');
      }
      return {
        accessToken: json.access_token,
        expiresInSec: Number(json.expires_in ?? 3600) || 3600,
      };
    });
  }

  async getQuotes(
    request: QuoteRequest,
    creds: CarrierRateCredentials,
  ): Promise<RateQuote[]> {
    if (request.packages.length === 0) {
      throw new Error('At least one package is needed for a FedEx rate quote.');
    }
    const token = await this.getAccessToken(creds);
    const payload: Record<string, unknown> = {
      rateRequestControlParameters: { returnTransitTimes: true },
      requestedShipment: {
        shipper: {
          address: {
            postalCode: request.origin.postalCode,
            countryCode: request.origin.countryCode,
          },
        },
        recipient: {
          address: {
            postalCode: request.destination.postalCode,
            countryCode: request.destination.countryCode,
          },
        },
        pickupType: 'USE_SCHEDULED_PICKUP',
        packagingType: 'YOUR_PACKAGING',
        // FedEx requires the rate type: account-specific rates when an
        // account number is configured, otherwise list rates.
        rateRequestType: [creds.accountNumber ? 'ACCOUNT' : 'LIST'],
        requestedPackageLineItems: request.packages.map(toLineItem),
      },
    };
    if (creds.accountNumber) {
      payload.accountNumber = { value: creds.accountNumber };
    }

    const res = await fetchWithTimeout(
      `${this.baseUrl(creds)}/rate/v1/rates/quotes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-locale': 'en_US',
        },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      throw new Error(
        `FedEx rate request failed (${res.status}): ${await readErrorBody(res)}`,
      );
    }
    const json = (await res.json()) as {
      output?: { rateReplyDetails?: FedExRateReplyDetail[] };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) {
      throw new Error(
        `FedEx rate error: ${json.errors.map((e) => e.message ?? 'unknown').join('; ')}`,
      );
    }
    const details = json.output?.rateReplyDetails ?? [];
    const quotes: RateQuote[] = [];
    for (const d of details) {
      const rated = d.ratedShipmentDetails?.[0];
      if (typeof rated?.totalNetCharge !== 'number') continue;
      quotes.push({
        carrierCode: 'FEDEX',
        carrierName: 'FedEx',
        serviceCode: d.serviceType ?? 'UNKNOWN',
        serviceName: d.serviceName ?? d.serviceType ?? 'FedEx service',
        totalCharge: rated.totalNetCharge,
        currency: rated.currency ?? 'USD',
        transitDays: parseTransitDays(d),
        estimatedDelivery: d.commit?.dateDetail?.dayFormat ?? null,
      });
    }
    return quotes;
  }
}
