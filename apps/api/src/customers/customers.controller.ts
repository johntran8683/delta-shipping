import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentPayload } from '../auth/decorators/current-payload.decorator';
import type { JwtPayload } from '../auth/jwt-payload';
import { CustomersService } from './customers.service';
import { UpdateDnCombinationRulesDto } from './dto/update-dn-combination-rules.dto';

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('dn-combination-rules')
  @RequirePermissions('users.manage')
  getDnCombinationRules(@CurrentPayload() payload: JwtPayload) {
    return this.customers.getDnCombinationRules(payload);
  }

  @Put('dn-combination-rules')
  @RequirePermissions('users.manage')
  updateDnCombinationRules(
    @CurrentPayload() payload: JwtPayload,
    @Body() dto: UpdateDnCombinationRulesDto,
  ) {
    return this.customers.updateDnCombinationRules(payload, dto);
  }
}
