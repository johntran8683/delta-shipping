import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentPayload } from '../auth/decorators/current-payload.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { JwtPayload } from '../auth/jwt-payload';
import { AccessControlService } from './access-control.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';

@Controller('access-control')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccessControlController {
  constructor(private readonly accessControl: AccessControlService) {}

  @Get('permissions')
  @RequirePermissions('permissions.manage')
  listPermissions(@CurrentPayload() payload: JwtPayload) {
    return this.accessControl.listPermissions(payload);
  }

  @Post('permissions')
  @RequirePermissions('permissions.manage')
  createPermission(
    @Body() dto: CreatePermissionDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.accessControl.createPermission(dto, payload);
  }

  @Get('matrix')
  @RequirePermissions('permissions.manage')
  matrix(@CurrentPayload() payload: JwtPayload) {
    return this.accessControl.getMatrix(payload);
  }

  @Patch('roles/:roleId/permissions')
  @RequirePermissions('permissions.manage')
  setRolePermissions(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRolePermissionsDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.accessControl.setRolePermissions(roleId, dto, payload);
  }
}
