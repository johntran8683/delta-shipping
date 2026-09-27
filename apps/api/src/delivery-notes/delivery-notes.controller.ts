import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentPayload } from '../auth/decorators/current-payload.decorator';
import type { JwtPayload } from '../auth/jwt-payload';
import { DeliveryNotesService } from './delivery-notes.service';
import { BulkTransitionDto } from './dto/bulk-transition.dto';
import { CompletePackDto } from './dto/complete-pack.dto';
import { ListDeliveryNotesQueryDto } from './dto/list-delivery-notes.query.dto';
import { SuggestDeliveryNotesQueryDto } from './dto/suggest-delivery-notes.query.dto';
import { StartPackDto } from './dto/start-pack.dto';
import { TransitionDto } from './dto/transition.dto';
import { SetPriorityDto } from './dto/set-priority.dto';
import { SetRushDto } from './dto/set-rush.dto';

@Controller('delivery-notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DeliveryNotesController {
  constructor(private readonly deliveryNotes: DeliveryNotesService) {}

  /** List delivery notes (default: open only, ordered by priority number then DN). */
  @Get()
  @RequirePermissions('dn.read')
  list(
    @Query() query: ListDeliveryNotesQueryDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.deliveryNotes.list(query, payload.sub);
  }

  @Post('bulk-transition')
  bulkTransition(
    @Body() dto: BulkTransitionDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.deliveryNotes.bulkTransition(
      dto.ids,
      dto.toStatus,
      payload,
      dto.message,
    );
  }

  @Get('suggestions')
  @RequirePermissions('dn.read')
  suggest(@Query() query: SuggestDeliveryNotesQueryDto) {
    return this.deliveryNotes.suggestByDnSuffix(query.q);
  }

  /** Daily throughput / backlog for the Vancouver calendar day. */
  @Get('stats')
  @RequirePermissions('dn.read')
  dailyStats(@CurrentPayload() payload: JwtPayload) {
    return this.deliveryNotes.getDailyStats(payload);
  }

  /** Eligible peers that share the same customer / ship-to / location / ship-type cluster. */
  @Get(':id/ship-together-peers')
  @RequirePermissions('dn.read')
  listShipTogetherPeers(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliveryNotes.listShipTogetherPeers(id);
  }

  /** Peers in the same pack cluster (see GET response: only `eligible_for_pack_session` may be POSTed to pack/start). */
  @Get(':id/packing-combine-peers')
  @RequirePermissions('dn.read')
  listPackingCombinePeers(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliveryNotes.listPackingCombinePeers(id);
  }

  /** 4×6 in shipping label PDF: company name + ship-to address + country. */
  @Get(':id/print/shipping-label.pdf')
  @RequirePermissions('dn.read')
  async printShippingLabel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPayload() payload: JwtPayload,
    @Res({ passthrough: false }) res: Response,
  ) {
    const buf = await this.deliveryNotes.buildShippingLabelPdf(id, payload);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'inline; filename="shipping-label.pdf"',
    );
    res.send(buf);
  }

  /** 4×2 in PO label PDF: customer PO number only. */
  @Get(':id/print/po-label.pdf')
  @RequirePermissions('dn.read')
  async printPoLabel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPayload() payload: JwtPayload,
    @Res({ passthrough: false }) res: Response,
  ) {
    const buf = await this.deliveryNotes.buildPoLabelPdf(id, payload);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="po-label.pdf"');
    res.send(buf);
  }

  @Post(':id/pack/start')
  @RequirePermissions('dn.status.pack')
  startPacking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartPackDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.deliveryNotes.startPacking(id, dto, payload);
  }

  @Post(':id/pack/complete')
  @RequirePermissions('dn.status.pack')
  completePacking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompletePackDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.deliveryNotes.completePacking(id, dto, payload);
  }

  @Post(':id/pack/update')
  @RequirePermissions('dn.status.pack')
  updateCompletedPacking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompletePackDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.deliveryNotes.updateCompletedPacking(id, dto, payload);
  }

  @Get(':id')
  @RequirePermissions('dn.read')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.deliveryNotes.findOne(id, payload);
  }

  @Post(':id/transition')
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.deliveryNotes.transition(
      id,
      dto.toStatus,
      payload,
      dto.message,
      dto.trackingNumber,
      dto.confirmDoubleClaim,
    );
  }

  @Patch(':id/priority')
  setPriority(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPriorityDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.deliveryNotes.setPriority(
      id,
      dto.toPriorityNo,
      dto.reason,
      payload,
    );
  }

  @Patch(':id/rush')
  setRush(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRushDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.deliveryNotes.setRush(id, dto.rushed, dto.reason, payload);
  }
}
