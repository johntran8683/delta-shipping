import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async roleHasPermission(roleId: string, permissionCode: string): Promise<boolean> {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { code: true },
    });
    if (role && ['SYSTEM', 'SUPERVISOR'].includes(role.code)) {
      return true;
    }
    const row = await this.prisma.rolePermission.findFirst({
      where: {
        role_id: roleId,
        permission: { code: permissionCode },
      },
      select: { role_id: true },
    });
    return row !== null;
  }
}
