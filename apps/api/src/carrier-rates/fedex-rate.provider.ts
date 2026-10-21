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
  QuoteAddress,
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
  ratedShipmentDetails?: FedExRatedDetail[];
}

interface FedExRatedDetail {
  rateType?: string;
  totalNetCharge?: number;
  currency?: string;
}

/**
 * Estimates are shown in US dollars. FedEx returns the account currency
 * first (CAD, or PLN on the sandbox) and, when asked, a second
 * PREFERRED_CURRENCY row converted to the requested currency.
 */
function pickRatedDetail(
  details: FedExRatedDetail[] | undefined,
): FedExRatedDetail | undefined {
  const rates = (details ?? []).filter(
    (rate) => typeof rate.totalNetCharge === 'number',
  );
  return (
    rates.find(
      (rate) =>
        rate.currency === 'USD' && rate.rateType === 'PREFERRED_CURRENCY',
    ) ??
    rates.find((rate) => rate.currency === 'USD') ??
    rates[0]
  );
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

/**
 * FedEx rates Ground services by the recipient's state/province and its
 * documented request shape includes city + stateOrProvinceCode on both
 * addresses. The service layer already collects them — send them, omitting
 * any that are blank (empty strings fail FedEx validation on their own).
 */
function toFedExAddress(addr: QuoteAddress) {
  const out: Record<string, string> = {
    postalCode: addr.postalCode,
    countryCode: addr.countryCode,
  };
  const city = (addr.city ?? '').trim();
  if (city) out.city = city;
  const state = (addr.stateOrProvinceCode ?? '').trim();
  if (state) out.stateOrProvinceCode = state;
  return out;
}

function isInternational(request: QuoteRequest): boolean {
  return (
    request.origin.countryCode.trim().toUpperCase() !==
    request.destination.countryCode.trim().toUpperCase()
  );
}

/**
 * FedEx rejects international rate quotes with
 * RATE.CUSTOMCLEARANCEDETAIL.INVALID when this object is missing.
 * A single commodity stands in for the shipment so the transportation
 * rate can be returned; duty estimates use a nominal customs value
 * because the delivery note has no commercial invoice on the quote.
 */
function customsClearanceDetail(request: QuoteRequest) {
  const weight = round2(
    request.packages.reduce((sum, pkg) => sum + pkg.weightLb, 0),
  );
  const customsValue = { amount: 1, currency: 'USD' };
  return {
    dutiesPayment: { paymentType: 'SENDER' },
    commodities: [
      {
        description: 'Industrial control equipment',
        countryOfManufacture: request.origin.countryCode.trim().toUpperCase(),
        quantity: 1,
        quantityUnits: 'PCS',
        weight: { units: 'LB', value: Math.max(weight, 0.01) },
        customsValue,
        unitPrice: customsValue,
      },
    ],
  };
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
    const requestedShipment: Record<string, unknown> = {
      shipper: { address: toFedExAddress(request.origin) },
      recipient: { address: toFedExAddress(request.destination) },
      pickupType: 'USE_SCHEDULED_PICKUP',
      packagingType: 'YOUR_PACKAGING',
      // ACCOUNT (or LIST) is the price FedEx bills. PREFERRED asks for that
      // same price converted into preferredCurrency, which is USD.
      rateRequestType: [creds.accountNumber ? 'ACCOUNT' : 'LIST', 'PREFERRED'],
      preferredCurrency: 'USD',
      requestedPackageLineItems: request.packages.map(toLineItem),
      ...(isInternational(request)
        ? { customsClearanceDetail: customsClearanceDetail(request) }
        : {}),
    };
    const payload: Record<string, unknown> = {
      rateRequestControlParameters: { returnTransitTimes: true },
      requestedShipment,
    };
    if (creds.accountNumber) {
      payload.accountNumber = { value: creds.accountNumber };
      // Do not also send shippingChargesPayment. FedEx defaults payment to
      // SENDER and then compares that payor with the account enrolled on the
      // API project, which is not this accountNumber. Sending the payor
      // returns ACCOUNT.NUMBER.MISMATCH even when both values are identical.
      // Account-specific rates come from accountNumber alone.
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
      const rated = pickRatedDetail(d.ratedShipmentDetails);
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
