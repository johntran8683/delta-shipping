import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentPayload } from '../auth/decorators/current-payload.decorator';
import type { JwtPayload } from '../auth/jwt-payload';
import { CarrierRatesService } from './carrier-rates.service';
import {
  GetRateQuotesDto,
  SaveCarrierRateSettingsDto,
  TestCarrierConnectionDto,
} from './dto/carrier-rates.dto';

@Controller('carrier-rates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CarrierRatesController {
  constructor(private readonly carrierRates: CarrierRatesService) {}

  /** Live rate quotes for a delivery note's shipment group (shipper). */
  @Post('quotes')
  @RequirePermissions('shipment.create')
  getQuotes(
    @Body() dto: GetRateQuotesDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.carrierRates.getQuotesForDeliveryNote(
      dto.deliveryNoteId,
      payload,
    );
  }

  /** Current carrier-rate configuration; secrets are masked (supervisor). */
  @Get('settings')
  @RequirePermissions('users.manage')
  getSettings(@CurrentPayload() payload: JwtPayload) {
    return this.carrierRates.getSettings(payload);
  }

  /** Save origin address + carrier credentials (supervisor). */
  @Put('settings')
  @RequirePermissions('users.manage')
  saveSettings(
    @Body() dto: SaveCarrierRateSettingsDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.carrierRates
      .saveSettings(dto, payload)
      .then(() => ({ ok: true }));
  }

  /** Verify credentials against the carrier (supervisor). */
  @Post('test-connection')
  @RequirePermissions('users.manage')
  testConnection(
    @Body() dto: TestCarrierConnectionDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.carrierRates.testConnection(dto, payload);
  }
}
