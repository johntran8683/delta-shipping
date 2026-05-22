import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentPayload } from '../auth/decorators/current-payload.decorator';
import type { JwtPayload } from '../auth/jwt-payload';
import { UpdateDeliveryNotesColumnsDto } from './dto/update-delivery-notes-columns.dto';
import { MeService } from './me.service';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('delivery-notes-table-columns')
  getDeliveryNotesTableColumns(@CurrentPayload() payload: JwtPayload) {
    return this.me.getDeliveryNotesTableColumns(payload.sub);
  }

  @Put('delivery-notes-table-columns')
  putDeliveryNotesTableColumns(
    @CurrentPayload() payload: JwtPayload,
    @Body() dto: UpdateDeliveryNotesColumnsDto,
  ) {
    return this.me.putDeliveryNotesTableColumns(
      payload.sub,
      dto.visibleColumns,
    );
  }
}
