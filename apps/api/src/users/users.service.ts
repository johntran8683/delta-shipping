import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { JwtPayload } from '../auth/jwt-payload';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { ResetManagedUserPasswordDto } from './dto/reset-managed-user-password.dto';
import type { UpdateManagedUserActiveDto } from './dto/update-managed-user-active.dto';
import type { UpdateUserRolesDto } from './dto/update-user-roles.dto';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertSupervisorOrSystemActiveRole(activeRoleId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: activeRoleId },
    });
    if (!role || !['SUPERVISOR', 'SYSTEM'].includes(role.code)) {
      throw new ForbiddenException(
        'User management is only available when your active role is SUPERVISOR or SYSTEM.',
      );
    }
  }

  async listActiveRoles(payload: JwtPayload) {
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);
    return this.prisma.role.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { code: 'asc' }],
      select: {
        code: true,
        name: true,
      },
    });
  }

  async createUser(dto: CreateUserDto, payload: JwtPayload) {
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);

    const email = dto.email.toLowerCase();
    const roleCodes = Array.from(
      new Set(dto.roleCodes.map((r) => r.trim().toUpperCase()).filter(Boolean)),
    );
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const roles = await this.prisma.role.findMany({
      where: { code: { in: roleCodes }, is_active: true },
      select: { id: true, code: true, name: true },
    });
    if (roles.length !== roleCodes.length) {
      const found = new Set(roles.map((r) => r.code));
      const missing = roleCodes.filter((code) => !found.has(code));
      throw new ConflictException(
        `Unknown or inactive roles: ${missing.join(', ')}`,
      );
    }

    const passwordHash = await bcrypt.hash(
      dto.temporaryPassword,
      BCRYPT_ROUNDS,
    );
    const user = await this.prisma.user.create({
      data: {
        email,
        display_name: dto.displayName?.trim() || null,
        password_hash: passwordHash,
        must_change_password: true,
        user_roles_assigned: {
          create: roles.map((role) => ({
            role_id: role.id,
            assigned_by: payload.sub,
          })),
        },
      },
      include: {
        user_roles_assigned: {
          include: {
            role: true,
          },
        },
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        mustChangePassword: user.must_change_password,
        roles: user.user_roles_assigned.map((ur) => ({
          code: ur.role.code,
          name: ur.role.name,
        })),
      },
    };
  }

  async listManagedUsers(payload: JwtPayload) {
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);
    const rows = await this.prisma.user.findMany({
      where: {
        user_roles_assigned: {
          some: {
            assigned_by: payload.sub,
          },
        },
      },
      include: {
        user_roles_assigned: {
          include: { role: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      mustChangePassword: u.must_change_password,
      isActive: u.is_active,
      roles: u.user_roles_assigned.map((ur) => ({
        code: ur.role.code,
        name: ur.role.name,
      })),
    }));
  }

  private async assertManagedUserCreatedBy(
    userId: string,
    supervisorId: string,
  ) {
    const managed = await this.prisma.userRole.findFirst({
      where: { user_id: userId, assigned_by: supervisorId },
      select: { user_id: true },
    });
    if (!managed) {
      throw new ForbiddenException('You can only manage users you created.');
    }
  }

  async updateManagedUserRoles(
    userId: string,
    dto: UpdateUserRolesDto,
    payload: JwtPayload,
  ) {
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);

    await this.assertManagedUserCreatedBy(userId, payload.sub);

    const roleCodes = Array.from(
      new Set(dto.roleCodes.map((r) => r.trim().toUpperCase()).filter(Boolean)),
    );
    const roles = await this.prisma.role.findMany({
      where: { code: { in: roleCodes }, is_active: true },
      select: { id: true, code: true, name: true },
    });
    if (roles.length !== roleCodes.length) {
      const found = new Set(roles.map((r) => r.code));
      const missing = roleCodes.filter((code) => !found.has(code));
      throw new ConflictException(
        `Unknown or inactive roles: ${missing.join(', ')}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, display_name: true, is_active: true },
      });
      if (!user) throw new NotFoundException('User not found');

      await tx.userRole.deleteMany({
        where: { user_id: userId },
      });
      await tx.userRole.createMany({
        data: roles.map((role) => ({
          user_id: userId,
          role_id: role.id,
          assigned_by: payload.sub,
        })),
      });
      return user;
    });

    return {
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.display_name,
        isActive: updated.is_active,
        roles: roles.map((r) => ({ code: r.code, name: r.name })),
      },
    };
  }

  async resetManagedUserPassword(
    userId: string,
    dto: ResetManagedUserPasswordDto,
    payload: JwtPayload,
  ) {
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);
    await this.assertManagedUserCreatedBy(userId, payload.sub);

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        password_hash: passwordHash,
        must_change_password: true,
      },
      select: {
        id: true,
        email: true,
        display_name: true,
        must_change_password: true,
        is_active: true,
      },
    });

    return {
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.display_name,
        mustChangePassword: updated.must_change_password,
        isActive: updated.is_active,
      },
    };
  }

  async updateManagedUserActive(
    userId: string,
    dto: UpdateManagedUserActiveDto,
    payload: JwtPayload,
  ) {
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);
    await this.assertManagedUserCreatedBy(userId, payload.sub);

    if (!dto.isActive && userId === payload.sub) {
      throw new ForbiddenException('You cannot disable your own account.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { is_active: dto.isActive },
      select: {
        id: true,
        email: true,
        display_name: true,
        is_active: true,
        must_change_password: true,
      },
    });

    return {
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.display_name,
        isActive: updated.is_active,
        mustChangePassword: updated.must_change_password,
      },
    };
  }
}
