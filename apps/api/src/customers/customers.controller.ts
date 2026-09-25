import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentPayload } from '../auth/decorators/current-payload.decorator';
import type { JwtPayload } from '../auth/jwt-payload';
import { CustomersService } from './customers.service';
import { CreateCarrierAccountDto } from './dto/create-carrier-account.dto';
import { ListCustomersQueryDto } from './dto/list-customers.query.dto';
import { UpdateCarrierAccountDto } from './dto/update-carrier-account.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
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

  @Get()
  @RequirePermissions('customers.read')
  listCustomers(@Query() query: ListCustomersQueryDto) {
    return this.customers.listCustomers(query);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  getCustomer(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.getCustomer(id);
  }

  @Patch(':id')
  @RequirePermissions('customers.write')
  updateCustomer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.updateCustomer(id, dto);
  }

  @Post(':id/carrier-accounts')
  @RequirePermissions('customers.write')
  createCarrierAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCarrierAccountDto,
  ) {
    return this.customers.createCarrierAccount(id, dto);
  }

  @Patch(':id/carrier-accounts/:accountId')
  @RequirePermissions('customers.write')
  updateCarrierAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: UpdateCarrierAccountDto,
  ) {
    return this.customers.updateCarrierAccount(id, accountId, dto);
  }
}
