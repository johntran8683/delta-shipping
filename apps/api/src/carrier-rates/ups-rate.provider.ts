/**
 * UPS Rating API client (REST, OAuth 2.0).
 *
 * Auth: POST /security/v1/oauth/token with HTTP Basic (client_id:client_secret)
 * and form body grant_type=client_credentials (token lasts ~1 hour).
 * Rates: POST /api/rating/v1/Shop with RequestOption "Shop" returns all
 * services; additionalinfo=timeintransit adds business days in transit.
 *
 * Docs: https://developer.ups.com/api/reference?loc=en_US#tag/Rating
 */

import type {
  CarrierRateCredentials,
  CarrierRateProvider,
  QuoteRequest,
  RateQuote,
} from './carrier-rate-provider';
import { OAuthTokenCache } from './oauth-token-cache';

const BASE_URLS: Record<string, string> = {
  SANDBOX: 'https://wwwcie.ups.com',
  PRODUCTION: 'https://onlinetools.ups.com',
};

const REQUEST_TIMEOUT_MS = 20000;

const SERVICE_NAMES: Record<string, string> = {
  '01': 'UPS Next Day Air',
  '02': 'UPS 2nd Day Air',
  '03': 'UPS Ground',
  '07': 'UPS Express',
  '08': 'UPS Expedited',
  '11': 'UPS Standard',
  '12': 'UPS 3 Day Select',
  '13': 'UPS Next Day Air Saver',
  '14': 'UPS Next Day Air Early',
  '54': 'UPS Express Plus',
  '59': 'UPS 2nd Day Air A.M.',
  '65': 'UPS Saver',
};

interface UpsRatedShipment {
  Service?: { Code?: string; Description?: string };
  TotalCharges?: { MonetaryValue?: string; CurrencyCode?: string };
  GuaranteedDelivery?: { BusinessDaysInTransit?: string };
  TimeInTransit?: {
    ServiceSummary?: { EstimatedArrival?: { Arrival?: { Date?: string } } };
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
    return text.slice(0, 500);
  } catch {
    return `HTTP ${res.status}`;
  }
}

export class UpsRateProvider implements CarrierRateProvider {
  readonly code = 'UPS' as const;
  readonly displayName = 'UPS';

  constructor(private readonly tokenCache = new OAuthTokenCache()) {}

  private baseUrl(creds: CarrierRateCredentials): string {
    return BASE_URLS[creds.environment] ?? BASE_URLS.PRODUCTION;
  }

  private cacheKey(creds: CarrierRateCredentials): string {
    return `ups:${creds.environment}:${creds.clientId}`;
  }

  async testConnection(creds: CarrierRateCredentials): Promise<void> {
    this.tokenCache.clear(this.cacheKey(creds));
    await this.getAccessToken(creds);
  }

  private async getAccessToken(creds: CarrierRateCredentials): Promise<string> {
    return this.tokenCache.getToken(this.cacheKey(creds), async () => {
      const basic = Buffer.from(
        `${creds.clientId}:${creds.clientSecret}`,
      ).toString('base64');
      const res = await fetchWithTimeout(
        `${this.baseUrl(creds)}/security/v1/oauth/token`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
        },
      );
      if (!res.ok) {
        throw new Error(
          `UPS auth failed (${res.status}): ${await readErrorBody(res)}`,
        );
      }
      const json = (await res.json()) as {
        access_token?: string;
        expires_in?: number | string;
      };
      if (!json.access_token) {
        throw new Error('UPS auth returned no access token.');
      }
      return {
        accessToken: json.access_token,
        // UPS reports expires_in as a string; never hardcode the TTL.
        expiresInSec: Number(json.expires_in ?? 3600) || 3600,
      };
    });
  }

  async getQuotes(
    request: QuoteRequest,
    creds: CarrierRateCredentials,
  ): Promise<RateQuote[]> {
    if (request.packages.length === 0) {
      throw new Error('At least one package is needed for a UPS rate quote.');
    }
    const token = await this.getAccessToken(creds);

    const shipperAddress = {
      PostalCode: request.origin.postalCode,
      CountryCode: request.origin.countryCode,
    };
    const body = {
      RateRequest: {
        Request: {
          RequestOption: 'Shop',
          TransactionReference: {
            CustomerContext: 'Delta Shipping rate quote',
          },
        },
        Shipment: {
          Shipper: {
            ...(creds.accountNumber
              ? { ShipperNumber: creds.accountNumber }
              : {}),
            Address: shipperAddress,
          },
          ShipTo: {
            Address: {
              PostalCode: request.destination.postalCode,
              CountryCode: request.destination.countryCode,
            },
          },
          ShipFrom: { Address: shipperAddress },
          Package: request.packages.map((pkg) => ({
            PackagingType: { Code: '02', Description: 'Package' },
            Dimensions: {
              UnitOfMeasurement: { Code: 'IN' },
              Length: String(Math.round(pkg.lengthIn * 100) / 100),
              Width: String(Math.round(pkg.widthIn * 100) / 100),
              Height: String(Math.round(pkg.heightIn * 100) / 100),
            },
            PackageWeight: {
              UnitOfMeasurement: { Code: 'LBS' },
              Weight: String(Math.round(pkg.weightLb * 100) / 100),
            },
          })),
        },
      },
    };

    const res = await fetchWithTimeout(
      `${this.baseUrl(creds)}/api/rating/v1/Shop?additionalinfo=timeintransit`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(
        `UPS rate request failed (${res.status}): ${await readErrorBody(res)}`,
      );
    }
    const json = (await res.json()) as {
      RateResponse?: {
        RatedShipment?: UpsRatedShipment[] | UpsRatedShipment;
        Response?: { ResponseStatus?: { Code?: string; Description?: string } };
      };
    };
    const rated = json.RateResponse?.RatedShipment;
    const shipments = Array.isArray(rated) ? rated : rated ? [rated] : [];
    const quotes: RateQuote[] = [];
    for (const s of shipments) {
      const amount = Number(s.TotalCharges?.MonetaryValue);
      if (!Number.isFinite(amount)) continue;
      const code = s.Service?.Code ?? 'UNKNOWN';
      const transitDays = s.GuaranteedDelivery?.BusinessDaysInTransit
        ? Number(s.GuaranteedDelivery.BusinessDaysInTransit)
        : null;
      quotes.push({
        carrierCode: 'UPS',
        carrierName: 'UPS',
        serviceCode: code,
        serviceName:
          s.Service?.Description?.trim() ||
          SERVICE_NAMES[code] ||
          `UPS service ${code}`,
        totalCharge: Math.round(amount * 100) / 100,
        currency: s.TotalCharges?.CurrencyCode ?? 'USD',
        transitDays: Number.isFinite(transitDays) ? transitDays : null,
        estimatedDelivery:
          s.TimeInTransit?.ServiceSummary?.EstimatedArrival?.Arrival?.Date ??
          null,
      });
    }
    return quotes;
  }
}
