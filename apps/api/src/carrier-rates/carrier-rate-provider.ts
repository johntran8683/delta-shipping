/**
 * Shared types for the carrier rate-quote integration.
 *
 * A provider talks to one carrier's rating API (FedEx / UPS) and returns
 * normalized quotes. Secrets never leave the API server.
 */

export type CarrierCode = 'FEDEX' | 'UPS';
export type CarrierEnvironment = 'SANDBOX' | 'PRODUCTION';

export interface QuoteAddress {
  postalCode: string;
  /** ISO 3166-1 alpha-2, e.g. "CA", "US". */
  countryCode: string;
  city?: string;
  stateOrProvinceCode?: string;
}

export interface QuotePackage {
  weightLb: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

export interface QuoteRequest {
  origin: QuoteAddress;
  destination: QuoteAddress;
  packages: QuotePackage[];
  /** Ship date as YYYY-MM-DD; defaults to today. */
  shipDate?: string;
}

export interface RateQuote {
  carrierCode: CarrierCode;
  carrierName: string;
  serviceCode: string;
  serviceName: string;
  totalCharge: number;
  currency: string;
  transitDays: number | null;
  estimatedDelivery: string | null;
}

export interface CarrierRateCredentials {
  clientId: string;
  clientSecret: string;
  accountNumber: string | null;
  environment: CarrierEnvironment;
}

export interface CarrierRateProvider {
  readonly code: CarrierCode;
  readonly displayName: string;
  /** Throws on failure; used by the settings "test connection" button. */
  testConnection(creds: CarrierRateCredentials): Promise<void>;
  getQuotes(
    request: QuoteRequest,
    creds: CarrierRateCredentials,
  ): Promise<RateQuote[]>;
}
