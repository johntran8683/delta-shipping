import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt-payload';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePermissionDto } from './dto/create-permission.dto';
import type { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import {
  ASSIGNABLE_PERMISSION_CODES,
  BYPASS_MATRIX_ROLE_CODES,
  getManifestEntry,
  PERMISSION_CATEGORIES,
  PERMISSION_MANIFEST,
  ROLE_PERMISSION_DEFAULTS,
  sortPermissionsForMatrix,
} from './permissions.manifest';

@Injectable()
export class AccessControlService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertSupervisorOrSystemActiveRole(activeRoleId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: activeRoleId },
    });
    if (
      !role ||
      !(BYPASS_MATRIX_ROLE_CODES as readonly string[]).includes(role.code)
    ) {
      throw new ForbiddenException(
        'Access control is only available when your active role is SUPERVISOR or SYSTEM.',
      );
    }
  }

  /** Keep DB catalog aligned with application manifest (idempotent). */
  async syncManifestPermissions() {
    for (const entry of PERMISSION_MANIFEST) {
      await this.prisma.permission.upsert({
        where: { code: entry.code },
        create: {
          code: entry.code,
          description: entry.description,
        },
        update: { description: entry.description },
      });
    }
  }

  async listPermissions(_payload: JwtPayload) {
    await this.syncManifestPermissions();
    const rows = await this.prisma.permission.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        description: true,
        created_at: true,
      },
    });
    return rows
      .map((row) => {
        const entry = getManifestEntry(row.code);
        return {
          ...row,
          description: entry?.description ?? row.description,
          category: entry?.category ?? null,
          assignable: entry?.assignable ?? false,
        };
      })
      .filter((row) => row.assignable || getManifestEntry(row.code));
  }

  async createPermission(dto: CreatePermissionDto, payload: JwtPayload) {
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);
    const code = dto.code.trim().toLowerCase();
    const existing = await this.prisma.permission.findUnique({
      where: { code },
    });
    if (existing) {
      throw new ConflictException(`Permission code already exists: ${code}`);
    }
    return this.prisma.permission.create({
      data: {
        code,
        description: dto.description?.trim() || null,
      },
      select: {
        id: true,
        code: true,
        description: true,
        created_at: true,
      },
    });
  }

  async getMatrix(_payload: JwtPayload) {
    await this.syncManifestPermissions();

    const assignableCodes = new Set(ASSIGNABLE_PERMISSION_CODES);
    const [roles, permissions] = await Promise.all([
      this.prisma.role.findMany({
        where: { is_active: true },
        orderBy: [{ sort_order: 'asc' }, { code: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          role_permissions: {
            select: { permission: { select: { code: true } } },
          },
        },
      }),
      this.prisma.permission.findMany({
        where: { code: { in: [...assignableCodes] } },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, description: true },
      }),
    ]);

    const permissionRows = sortPermissionsForMatrix(
      permissions.map((p) => {
        const entry = getManifestEntry(p.code)!;
        return {
          id: p.id,
          code: p.code,
          description: entry.description,
          category: entry.category,
          assignable: entry.assignable,
          critical: entry.critical ?? false,
          sortOrder: entry.sortOrder,
        };
      }),
    );

    return {
      categories: PERMISSION_CATEGORIES,
      permissions: permissionRows,
      roles: roles.map((r) => {
        const bypassApiMatrix = (
          BYPASS_MATRIX_ROLE_CODES as readonly string[]
        ).includes(r.code);
        const defaultPermissionCodes = (
          ROLE_PERMISSION_DEFAULTS[r.code] ?? []
        )
          .filter((c) => assignableCodes.has(c))
          .sort();
        return {
          id: r.id,
          code: r.code,
          name: r.name,
          bypassApiMatrix,
          defaultPermissionCodes,
          permissionCodes: r.role_permissions
            .map((rp) => rp.permission.code)
            .filter((c) => assignableCodes.has(c))
            .sort(),
        };
      }),
    };
  }

  async setRolePermissions(
    roleId: string,
    dto: UpdateRolePermissionsDto,
    payload: JwtPayload,
  ) {
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);

    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
    });
    if (!role?.is_active) {
      throw new NotFoundException('Role not found or inactive');
    }

    if ((BYPASS_MATRIX_ROLE_CODES as readonly string[]).includes(role.code)) {
      throw new ForbiddenException(
        `${role.code} always has full API access. Matrix changes are not saved for this role.`,
      );
    }

    const allowed = new Set(ASSIGNABLE_PERMISSION_CODES);
    const codes = Array.from(
      new Set(
        dto.permissionCodes.map((c) => c.trim().toLowerCase()).filter(Boolean),
      ),
    );
    const invalid = codes.filter((c) => !allowed.has(c));
    if (invalid.length > 0) {
      throw new ConflictException(
        `Permissions not assignable via matrix: ${invalid.join(', ')}`,
      );
    }

    const perms = await this.prisma.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    if (perms.length !== codes.length) {
      const found = new Set(perms.map((p) => p.code));
      const missing = codes.filter((c) => !found.has(c));
      throw new ConflictException(`Unknown permission codes: ${missing.join(', ')}`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { role_id: roleId } });
      if (perms.length > 0) {
        await tx.rolePermission.createMany({
          data: perms.map((p) => ({
            role_id: roleId,
            permission_id: p.id,
          })),
        });
      }
    });

    return {
      roleId,
      roleCode: role.code,
      permissionCodes: perms.map((p) => p.code).sort(),
    };
  }
}
