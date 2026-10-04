/**
 * Orchestrates live carrier rate quotes and owns the carrier-rate settings.
 *
 * Quotes are computed for a delivery note's whole shipment group (all boxes
 * across grouped notes), using the configured warehouse origin and the note's
 * ship-to address. Secrets are encrypted at rest and never leave the server.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt-payload';
import { inferCarrierCodeFromShippingType } from '../delivery-notes/carrier-match';
import { PermissionsService } from '../auth/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from './crypto';
import { countryCodeFromName } from './country-codes';
import { DhlRateProvider } from './dhl-rate.provider';
import { FedExRateProvider } from './fedex-rate.provider';
import { UpsRateProvider } from './ups-rate.provider';
import type {
  CarrierCode,
  CarrierEnvironment,
  CarrierRateCredentials,
  CarrierRateProvider,
  QuotePackage,
  QuoteRequest,
  RateQuote,
} from './carrier-rate-provider';
import type {
  SaveCarrierSettingsDto,
  SaveOriginAddressDto,
} from './dto/carrier-rates.dto';

const ORIGIN_SETTING_KEY = 'rate_quote_origin';
const ACTIVE_ENV_SETTING_KEY = 'rate_quote_active_env';

interface OriginAddress {
  street?: string;
  city?: string;
  stateOrProvinceCode?: string;
  postalCode: string;
  countryCode: string;
}

interface MaskedCredentials {
  clientId: string;
  secretSet: boolean;
  secretLast4: string | null;
  accountNumber: string | null;
  isEnabled: boolean;
}

export interface CarrierSettingsView {
  origin: OriginAddress | null;
  carriers: Record<
    CarrierCode,
    {
      activeEnvironment: CarrierEnvironment;
      sandbox: MaskedCredentials | null;
      production: MaskedCredentials | null;
    }
  >;
}

export interface RateQuotesResult {
  quotes: RateQuote[];
  notices: string[];
  packageCount: number;
  deliveryNoteCount: number;
  dnNumbers: string[];
}

function maskLast4(secret: string): string {
  return secret.length <= 4 ? '****' : secret.slice(-4);
}

function normalizeCountryCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

export class CarrierRateProviderRegistry {
  private readonly providers: CarrierRateProvider[] = [
    new FedExRateProvider(),
    new UpsRateProvider(),
    new DhlRateProvider(),
  ];

  get(code: CarrierCode): CarrierRateProvider {
    const provider = this.providers.find((p) => p.code === code);
    if (!provider) throw new Error(`Unknown carrier: ${code}`);
    return provider;
  }

  all(): CarrierRateProvider[] {
    return [...this.providers];
  }
}

@Injectable()
export class CarrierRatesService {
  private readonly registry = new CarrierRateProviderRegistry();

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private async assertSupervisorOrSystem(activeRoleId: string): Promise<void> {
    const role = await this.prisma.role.findUnique({
      where: { id: activeRoleId },
    });
    if (!role || !['SUPERVISOR', 'SYSTEM'].includes(role.code)) {
      throw new ForbiddenException(
        'Carrier rate settings are only available when your active role is SUPERVISOR or SYSTEM.',
      );
    }
  }

  private async assertCanQuote(activeRoleId: string): Promise<void> {
    const ok = await this.permissions.roleHasPermission(
      activeRoleId,
      'shipment.create',
    );
    if (!ok) {
      throw new ForbiddenException(
        'You do not have permission to estimate shipping fees.',
      );
    }
  }

  private async readOrigin(): Promise<OriginAddress | null> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: ORIGIN_SETTING_KEY },
    });
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value) as OriginAddress;
      if (!parsed.postalCode || !parsed.countryCode) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async readActiveEnvironments(): Promise<
    Record<CarrierCode, CarrierEnvironment>
  > {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: ACTIVE_ENV_SETTING_KEY },
    });
    const fallback: Record<CarrierCode, CarrierEnvironment> = {
      FEDEX: 'SANDBOX',
      UPS: 'SANDBOX',
      DHL: 'SANDBOX',
    };
    if (!row) return fallback;
    try {
      const parsed = JSON.parse(row.value) as Partial<
        Record<CarrierCode, CarrierEnvironment>
      >;
      return {
        FEDEX: parsed.FEDEX === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
        UPS: parsed.UPS === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
        DHL: parsed.DHL === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
      };
    } catch {
      return fallback;
    }
  }

  private async loadCredentials(
    carrier: CarrierCode,
    environment: CarrierEnvironment,
  ): Promise<CarrierRateCredentials | null> {
    const row = await this.prisma.carrierRateConfig.findUnique({
      where: {
        carrier_code_environment: { carrier_code: carrier, environment },
      },
    });
    if (!row || !row.is_enabled) return null;
    let clientSecret: string;
    try {
      clientSecret = decryptSecret(row.client_secret_enc);
    } catch (e) {
      throw new BadRequestException(
        `Stored ${carrier} ${environment} credentials cannot be decrypted: ${(e as Error).message}`,
      );
    }
    return {
      clientId: row.client_id,
      clientSecret,
      accountNumber: row.account_number?.trim() || null,
      environment,
    };
  }

  // ------------------------------------------------------------------ quotes

  async getQuotesForDeliveryNote(
    deliveryNoteId: string,
    payload: JwtPayload,
  ): Promise<RateQuotesResult> {
    await this.assertCanQuote(payload.activeRoleId);

    const dn = await this.prisma.deliveryNote.findUnique({
      where: { id: deliveryNoteId },
      select: {
        id: true,
        dn_number: true,
        current_status: true,
        shipping_group_id: true,
        shipping_type: true,
        ship_to_location: {
          select: {
            postal_code: true,
            country_code: true,
            country_name: true,
            city: true,
            state_region: true,
          },
        },
      },
    });
    if (!dn) throw new NotFoundException('Delivery note not found.');
    if (dn.current_status !== 'SHIPPING_IN_PROGRESS') {
      throw new BadRequestException(
        `Rate quotes are only available while shipping is in progress (this note is ${dn.current_status}).`,
      );
    }

    // The quote always comes from the carrier on the note's ship method —
    // quoting a different carrier's API would price the wrong service.
    // (Grouped notes share one ship method; the clicked note's decides.)
    // Checked before origin/address so a bad ship method is reported first.
    const shipMethod = (dn.shipping_type ?? '').trim();
    const inferred = inferCarrierCodeFromShippingType(shipMethod);
    if (inferred !== 'FEDEX' && inferred !== 'UPS' && inferred !== 'DHL') {
      throw new BadRequestException(
        shipMethod
          ? `Live estimates are only available for FedEx, UPS, and DHL shipments — this note's ship method is "${shipMethod}".`
          : 'This delivery note has no ship method set, so no carrier can be quoted. Set the ship method to FedEx, UPS, or DHL first.',
      );
    }
    const provider = this.registry.get(inferred);

    const origin = await this.readOrigin();
    if (!origin) {
      throw new BadRequestException(
        'No warehouse origin address is configured. Ask a supervisor to set it in Settings → Carrier rates.',
      );
    }

    const destinationPostal = (dn.ship_to_location?.postal_code ?? '').trim();
    let destinationCountry = normalizeCountryCode(
      dn.ship_to_location?.country_code,
    );
    if (!destinationCountry) {
      // Workbooks with a "Country" name column but no code column leave the
      // code blank — derive it from the name so existing notes can be quoted.
      destinationCountry =
        countryCodeFromName(dn.ship_to_location?.country_name) ?? '';
    }
    if (!destinationPostal || !destinationCountry) {
      const missing = [
        !destinationPostal ? 'postal code' : null,
        !destinationCountry ? 'country code' : null,
      ]
        .filter(Boolean)
        .join(' and ');
      throw new BadRequestException(
        `The ship-to address is missing ${missing}, so no quote can be requested.`,
      );
    }

    // Boxes across the whole shipment group (all member notes' latest packs).
    const groupIds = dn.shipping_group_id
      ? (
          await this.prisma.deliveryNote.findMany({
            where: { shipping_group_id: dn.shipping_group_id },
            select: { id: true, dn_number: true },
          })
        ).map((m) => m.id)
      : [dn.id];
    const dnNumbers = dn.shipping_group_id
      ? (
          await this.prisma.deliveryNote.findMany({
            where: { shipping_group_id: dn.shipping_group_id },
            select: { dn_number: true },
            orderBy: { dn_number: 'asc' },
          })
        ).map((m) => m.dn_number)
      : [dn.dn_number];

    const packages = await this.loadGroupBoxes(groupIds);
    if (packages.length === 0) {
      throw new BadRequestException(
        'No packed boxes were found for this shipment, so no quote can be requested.',
      );
    }

    const request: QuoteRequest = {
      origin: {
        postalCode: origin.postalCode.replace(/\s+/g, ''),
        countryCode: normalizeCountryCode(origin.countryCode),
        city: origin.city,
        stateOrProvinceCode: origin.stateOrProvinceCode,
      },
      destination: {
        postalCode: destinationPostal.replace(/\s+/g, ''),
        countryCode: destinationCountry,
        city: dn.ship_to_location?.city ?? undefined,
        stateOrProvinceCode: dn.ship_to_location?.state_region ?? undefined,
      },
      packages,
      shipDate: new Date().toISOString().slice(0, 10),
    };

    const activeEnvs = await this.readActiveEnvironments();

    const environment = activeEnvs[inferred];
    let creds: CarrierRateCredentials | null = null;
    try {
      creds = await this.loadCredentials(inferred, environment);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (!creds) {
      throw new BadRequestException(
        `${provider.displayName} is not configured for ${environment}. A supervisor can enable it in Settings → Carrier rates.`,
      );
    }

    const notices: string[] = [];
    let quotes: RateQuote[];
    try {
      quotes = await provider.getQuotes(request, creds);
    } catch (e) {
      throw new BadRequestException(
        `${provider.displayName} quote failed: ${(e as Error).message}`,
      );
    }
    if (quotes.length === 0) {
      notices.push(
        `${provider.displayName} returned no quotes for this shipment.`,
      );
    }

    quotes.sort((a, b) => a.totalCharge - b.totalCharge);
    return {
      quotes,
      notices,
      packageCount: packages.length,
      deliveryNoteCount: groupIds.length,
      dnNumbers,
    };
  }

  private async loadGroupBoxes(groupIds: string[]): Promise<QuotePackage[]> {
    const memberships = await this.prisma.packSessionDeliveryNote.findMany({
      where: {
        delivery_note_id: { in: groupIds },
        pack_session: { completed_at: { not: null } },
      },
      select: { pack_session_id: true },
      distinct: ['pack_session_id'],
    });
    if (memberships.length === 0) return [];
    const boxes = await this.prisma.packBox.findMany({
      where: {
        pack_session_id: { in: memberships.map((m) => m.pack_session_id) },
      },
      select: {
        weight_lb: true,
        length_in: true,
        width_in: true,
        height_in: true,
      },
      orderBy: { sort_order: 'asc' },
    });
    return boxes
      .map((b) => ({
        weightLb: Number(b.weight_lb),
        lengthIn: Number(b.length_in),
        widthIn: Number(b.width_in),
        heightIn: Number(b.height_in),
      }))
      .filter(
        (p) =>
          p.weightLb > 0 && p.lengthIn > 0 && p.widthIn > 0 && p.heightIn > 0,
      );
  }

  // ----------------------------------------------------------------- settings

  async getSettings(payload: JwtPayload): Promise<CarrierSettingsView> {
    await this.assertSupervisorOrSystem(payload.activeRoleId);
    const origin = await this.readOrigin();
    const activeEnvs = await this.readActiveEnvironments();
    const rows = await this.prisma.carrierRateConfig.findMany();
    const byKey = new Map(
      rows.map((r) => [`${r.carrier_code}:${r.environment}`, r]),
    );

    const view = {} as CarrierSettingsView['carriers'];
    for (const code of ['FEDEX', 'UPS', 'DHL'] as CarrierCode[]) {
      const entry = {
        activeEnvironment: activeEnvs[code],
        sandbox: null as MaskedCredentials | null,
        production: null as MaskedCredentials | null,
      };
      for (const env of ['SANDBOX', 'PRODUCTION'] as CarrierEnvironment[]) {
        const row = byKey.get(`${code}:${env}`);
        if (!row) continue;
        let secretLast4: string | null = null;
        try {
          secretLast4 = maskLast4(decryptSecret(row.client_secret_enc));
        } catch {
          secretLast4 = null;
        }
        entry[env === 'SANDBOX' ? 'sandbox' : 'production'] = {
          clientId: row.client_id,
          secretSet: true,
          secretLast4,
          accountNumber: row.account_number,
          isEnabled: row.is_enabled,
        };
      }
      view[code] = entry;
    }
    return { origin, carriers: view };
  }

  /** Save the warehouse origin address only. */
  async saveOrigin(
    dto: SaveOriginAddressDto,
    payload: JwtPayload,
  ): Promise<void> {
    await this.assertSupervisorOrSystem(payload.activeRoleId);

    const value = JSON.stringify({
      street: dto.origin.street?.trim() || undefined,
      city: dto.origin.city?.trim() || undefined,
      stateOrProvinceCode: dto.origin.stateOrProvinceCode?.trim() || undefined,
      postalCode: dto.origin.postalCode.trim(),
      countryCode: normalizeCountryCode(dto.origin.countryCode),
    });
    await this.prisma.appSetting.upsert({
      where: { key: ORIGIN_SETTING_KEY },
      create: { key: ORIGIN_SETTING_KEY, value },
      update: { value },
    });
  }

  /** Save one carrier's settings (active environment + both environments). */
  async saveCarrier(
    carrierCode: string,
    dto: SaveCarrierSettingsDto,
    payload: JwtPayload,
  ): Promise<void> {
    await this.assertSupervisorOrSystem(payload.activeRoleId);
    const code = (carrierCode ?? '').toUpperCase();
    if (code !== 'FEDEX' && code !== 'UPS' && code !== 'DHL') {
      throw new BadRequestException(`Unknown carrier: ${carrierCode}`);
    }

    const activeEnvs = await this.readActiveEnvironments();
    const value = JSON.stringify({ ...activeEnvs, [code]: dto.activeEnvironment });
    await this.prisma.appSetting.upsert({
      where: { key: ACTIVE_ENV_SETTING_KEY },
      create: { key: ACTIVE_ENV_SETTING_KEY, value },
      update: { value },
    });

    for (const env of ['SANDBOX', 'PRODUCTION'] as CarrierEnvironment[]) {
      const envDto = env === 'SANDBOX' ? dto.sandbox : dto.production;
      const secretTrimmed = envDto.clientSecret.trim();
      const existing = await this.prisma.carrierRateConfig.findUnique({
        where: {
          carrier_code_environment: { carrier_code: code, environment: env },
        },
      });
      if (!envDto.isEnabled) {
        // Disabled environments need no credentials. Keep any stored ones
        // and just switch the environment off; skip when nothing was ever
        // saved for it.
        if (!existing) continue;
        await this.prisma.carrierRateConfig.update({
          where: {
            carrier_code_environment: { carrier_code: code, environment: env },
          },
          data: {
            client_id: envDto.clientId.trim(),
            account_number: envDto.accountNumber?.trim() || null,
            is_enabled: false,
            ...(secretTrimmed
              ? { client_secret_enc: encryptSecret(secretTrimmed) }
              : {}),
          },
        });
        continue;
      }
      // Blank secret keeps the stored one; a missing stored one with a blank
      // secret is a user error.
      if (!secretTrimmed && !existing) {
        throw new BadRequestException(
          `${code} ${env}: a client secret is required the first time credentials are saved.`,
        );
      }
      const data = {
        client_id: envDto.clientId.trim(),
        account_number: envDto.accountNumber?.trim() || null,
        is_enabled: envDto.isEnabled,
        ...(secretTrimmed
          ? { client_secret_enc: encryptSecret(secretTrimmed) }
          : {}),
      };
      await this.prisma.carrierRateConfig.upsert({
        where: {
          carrier_code_environment: { carrier_code: code, environment: env },
        },
        create: {
          carrier_code: code,
          environment: env,
          client_secret_enc: data.client_secret_enc!,
          client_id: data.client_id,
          account_number: data.account_number,
          is_enabled: data.is_enabled,
        },
        update: data,
      });
    }
  }

  async testConnection(
    dto: { carrierCode: CarrierCode; environment: CarrierEnvironment } & {
      clientId?: string;
      clientSecret?: string;
      accountNumber?: string;
    },
    payload: JwtPayload,
  ): Promise<{ ok: true; detail: string }> {
    await this.assertSupervisorOrSystem(payload.activeRoleId);
    const { carrierCode, environment } = dto;
    // Draft credentials from the form take precedence so supervisors can test
    // before saving; otherwise the stored credentials are used.
    let creds: CarrierRateCredentials | null = null;
    if (dto.clientId?.trim() && dto.clientSecret?.trim()) {
      creds = {
        clientId: dto.clientId.trim(),
        clientSecret: dto.clientSecret.trim(),
        accountNumber: dto.accountNumber?.trim() || null,
        environment,
      };
    } else {
      creds = await this.loadCredentials(carrierCode, environment);
    }
    if (!creds) {
      throw new BadRequestException(
        `No ${carrierCode} ${environment} credentials to test (nothing saved and no draft entered).`,
      );
    }
    try {
      await this.registry.get(carrierCode).testConnection(creds);
    } catch (e) {
      throw new BadRequestException(
        `${carrierCode} connection failed: ${(e as Error).message}`,
      );
    }
    return {
      ok: true,
      detail: `${carrierCode} ${environment}: authentication succeeded.`,
    };
  }
}
