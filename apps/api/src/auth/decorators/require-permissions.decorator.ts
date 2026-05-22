import { SetMetadata } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../permissions.constants';

/**
 * Active session role (JWT `activeRoleId`) must have all listed permission codes.
 * Use with JwtAuthGuard + PermissionsGuard.
 */
export const RequirePermissions = (...codes: string[]) =>
  SetMetadata(PERMISSIONS_KEY, codes);
