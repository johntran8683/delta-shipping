/**
 * DHL Express MyDHL API client (rates).
 *
 * Auth: HTTP Basic — the API username and password issued for the
 * "DHL Express - MyDHL API" app on developer.dhl.com (stored here as
 * clientId / clientSecret). No token endpoint; every call is authenticated.
 * Rates: POST /rates (multi-piece) returns every available DHL product.
 * Sandbox is rate-limited to 500 calls/day per credential set.
 *
 * Docs: https://developer.dhl.com/api-reference/dhl-express-mydhl-api
 */

import { randomUUID } from 'node:crypto';
import type {
  CarrierRateCredentials,
  CarrierRateProvider,
  QuotePackage,
  QuoteRequest,
  RateQuote,
} from './carrier-rate-provider';

const BASE_URLS: Record<string, string> = {
  SANDBOX: 'https://express.api.dhl.com/mydhlapi/test',
  PRODUCTION: 'https://express.api.dhl.com/mydhlapi',
};

const REQUEST_TIMEOUT_MS = 20000;

interface DhlProduct {
  productName?: string;
  productCode?: string;
  totalPrice?: Array<{
    currencyType?: string;
    priceCurrency?: string;
    price?: number;
  }>;
  deliveryCapabilities?: {
    estimatedDeliveryDateAndTime?: string;
  };
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
    try {
      const json = JSON.parse(text) as { title?: string; detail?: string };
      const msg = [json.title, json.detail].filter(Boolean).join(' — ');
      if (msg) return `HTTP ${res.status}: ${msg}`.slice(0, 500);
    } catch {
      // Not JSON; fall through to raw text.
    }
    return `HTTP ${res.status}: ${text.slice(0, 300)}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** DHL wants `2026-10-01T09:00:00GMT-07:00` (local time, GMT offset suffix). */
function dhlDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `GMT${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toPackage(pkg: QuotePackage) {
  return {
    weight: round2(pkg.weightLb),
    dimensions: {
      length: round2(pkg.lengthIn),
      width: round2(pkg.widthIn),
      height: round2(pkg.heightIn),
    },
  };
}

export class DhlRateProvider implements CarrierRateProvider {
  readonly code = 'DHL' as const;
  readonly displayName = 'DHL Express';

  private baseUrl(creds: CarrierRateCredentials): string {
    return BASE_URLS[creds.environment] ?? BASE_URLS.PRODUCTION;
  }

  private authHeader(creds: CarrierRateCredentials): string {
    return `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`;
  }

  private headers(creds: CarrierRateCredentials): Record<string, string> {
    const now = new Date();
    return {
      Authorization: this.authHeader(creds),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Message-Reference': randomUUID(),
      'Message-Reference-Date': dhlDateTime(now),
    };
  }

  private buildPayload(request: QuoteRequest, creds: CarrierRateCredentials) {
    const originCity = (request.origin.city ?? '').trim();
    const destCity = (request.destination.city ?? '').trim();
    if (!originCity) {
      throw new Error(
        'DHL quotes need a warehouse origin city — set it in Settings → Carrier rates.',
      );
    }
    if (!destCity) {
      throw new Error('DHL quotes need a ship-to city on the delivery note.');
    }
    // Planned date must be a future date (within 10 days): tomorrow 09:00.
    const planned = new Date(Date.now() + 24 * 60 * 60 * 1000);
    planned.setHours(9, 0, 0, 0);
    const payload: Record<string, unknown> = {
      customerDetails: {
        shipperDetails: {
          postalCode: request.origin.postalCode,
          cityName: originCity.slice(0, 45),
          countryCode: request.origin.countryCode,
        },
        receiverDetails: {
          postalCode: request.destination.postalCode,
          cityName: destCity.slice(0, 45),
          countryCode: request.destination.countryCode,
        },
      },
      plannedShippingDateAndTime: dhlDateTime(planned),
      unitOfMeasurement: 'imperial',
      isCustomsDeclarable:
        request.origin.countryCode.toUpperCase() !==
        request.destination.countryCode.toUpperCase(),
      packages: request.packages.map(toPackage),
    };
    if (creds.accountNumber) {
      payload.accounts = [{ typeCode: 'shipper', number: creds.accountNumber }];
    }
    return payload;
  }

  async testConnection(creds: CarrierRateCredentials): Promise<void> {
    // No auth-only endpoint exists; a minimal real rating call proves the
    // username/password work. 401/403 means bad credentials — any other
    // response means authentication succeeded.
    const res = await fetchWithTimeout(`${this.baseUrl(creds)}/rates`, {
      method: 'POST',
      headers: this.headers(creds),
      body: JSON.stringify({
        customerDetails: {
          shipperDetails: {
            postalCode: '00000',
            cityName: 'Test',
            countryCode: 'US',
          },
          receiverDetails: {
            postalCode: '00000',
            cityName: 'Test',
            countryCode: 'US',
          },
        },
        plannedShippingDateAndTime: dhlDateTime(
          new Date(Date.now() + 24 * 60 * 60 * 1000),
        ),
        unitOfMeasurement: 'imperial',
        isCustomsDeclarable: false,
        packages: [
          { weight: 1, dimensions: { length: 1, width: 1, height: 1 } },
        ],
      }),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `DHL authentication failed (HTTP ${res.status}): check the API username and password.`,
      );
    }
    // Anything else (quotes or a business-logic error) proves auth worked.
  }

  async getQuotes(
    request: QuoteRequest,
    creds: CarrierRateCredentials,
  ): Promise<RateQuote[]> {
    if (request.packages.length === 0) {
      throw new Error('At least one package is needed for a DHL rate quote.');
    }
    const res = await fetchWithTimeout(`${this.baseUrl(creds)}/rates`, {
      method: 'POST',
      headers: this.headers(creds),
      body: JSON.stringify(this.buildPayload(request, creds)),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `DHL authentication failed (HTTP ${res.status}): check the API username and password.`,
        );
      }
      throw new Error(`DHL rate request failed: ${await readErrorBody(res)}`);
    }
    const json = (await res.json()) as { products?: DhlProduct[] };
    const quotes: RateQuote[] = [];
    for (const p of json.products ?? []) {
      // Prefer the billing-currency price; fall back to the first price.
      const prices = (p.totalPrice ?? []).filter(
        (t) => typeof t.price === 'number',
      );
      const chosen =
        prices.find((t) => t.currencyType === 'BILLC') ?? prices[0];
      if (!chosen || typeof chosen.price !== 'number') continue;
      quotes.push({
        carrierCode: 'DHL',
        carrierName: 'DHL Express',
        serviceCode: p.productCode ?? 'UNKNOWN',
        serviceName: p.productName ?? p.productCode ?? 'DHL Express service',
        totalCharge: chosen.price,
        currency: chosen.priceCurrency ?? 'USD',
        transitDays: null,
        estimatedDelivery:
          p.deliveryCapabilities?.estimatedDeliveryDateAndTime?.slice(0, 10) ??
          null,
      });
    }
    return quotes;
  }
}
