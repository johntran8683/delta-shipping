import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ActiveRoleDto } from './dto/active-role.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentPayload } from './decorators/current-payload.decorator';
import type { JwtPayload } from './jwt-payload';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentPayload() payload: JwtPayload) {
    return this.auth.getProfile(payload.sub, payload);
  }

  @UseGuards(JwtAuthGuard)
  @Post('active-role')
  activeRole(
    @CurrentPayload() payload: JwtPayload,
    @Body() dto: ActiveRoleDto,
  ) {
    return this.auth.switchActiveRole(payload.sub, dto.roleCode);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(
    @CurrentPayload() payload: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(payload.sub, dto);
  }
}
