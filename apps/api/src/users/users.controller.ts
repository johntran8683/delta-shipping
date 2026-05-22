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
import { CreateUserDto } from './dto/create-user.dto';
import { ResetManagedUserPasswordDto } from './dto/reset-managed-user-password.dto';
import { UpdateManagedUserActiveDto } from './dto/update-managed-user-active.dto';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('roles')
  @RequirePermissions('users.manage')
  listActiveRoles(@CurrentPayload() payload: JwtPayload) {
    return this.usersService.listActiveRoles(payload);
  }

  @Post()
  @RequirePermissions('users.manage')
  createUser(
    @Body() dto: CreateUserDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.usersService.createUser(dto, payload);
  }

  @Get()
  @RequirePermissions('users.manage')
  listManagedUsers(@CurrentPayload() payload: JwtPayload) {
    return this.usersService.listManagedUsers(payload);
  }

  @Patch(':id/roles')
  @RequirePermissions('users.manage')
  updateUserRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRolesDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.usersService.updateManagedUserRoles(id, dto, payload);
  }

  @Patch(':id/password')
  @RequirePermissions('users.manage')
  resetManagedUserPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetManagedUserPasswordDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.usersService.resetManagedUserPassword(id, dto, payload);
  }

  @Patch(':id/active')
  @RequirePermissions('users.manage')
  updateManagedUserActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManagedUserActiveDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.usersService.updateManagedUserActive(id, dto, payload);
  }
}
