import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../permissions.constants';
import type { JwtPayload } from '../jwt-payload';
import { PermissionsService } from '../permissions.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = req.user;
    if (!user?.activeRoleId) {
      throw new ForbiddenException('No active role in session');
    }

    for (const code of required) {
      const ok = await this.permissions.roleHasPermission(
        user.activeRoleId,
        code,
      );
      if (!ok) {
        throw new ForbiddenException(`Missing permission: ${code}`);
      }
    }
    return true;
  }
}
