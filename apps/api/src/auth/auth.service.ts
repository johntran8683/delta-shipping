import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './jwt-payload';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';

const BCRYPT_ROUNDS = 10;

/** Normalize role code from login / switch-body so `Supervisor` matches stored `SUPERVISOR`. */
function normalizeRoleCode(input: string): string {
  return input.trim().toUpperCase();
}

function findAssignedRoleByCode<T extends { code: string }>(
  assignments: T[],
  requested: string,
): T | undefined {
  const want = normalizeRoleCode(requested);
  return assignments.find((r) => normalizeRoleCode(r.code) === want);
}

/** Default JWT active role at login: SUPERVISOR first, then SYSTEM, then operational roles. */
function pickDefaultActiveRole<T extends { code: string }>(
  assignments: T[],
): T {
  const priority = ['SUPERVISOR', 'SYSTEM', 'PICKER', 'PACKER', 'SHIPPER'];
  const sorted = [...assignments].sort((a, b) => {
    const ia = priority.indexOf(a.code);
    const ib = priority.indexOf(b.code);
    const pa = ia === -1 ? 999 : ia;
    const pb = ib === -1 ? 999 : ib;
    if (pa !== pb) return pa - pb;
    return a.code.localeCompare(b.code);
  });
  return sorted[0]!;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const roleCodes = dto.roleCodes?.length ? dto.roleCodes : ['PICKER'];

    const roles = await this.prisma.role.findMany({
      where: { code: { in: roleCodes }, is_active: true },
    });
    if (roles.length !== roleCodes.length) {
      const found = new Set(roles.map((r) => r.code));
      const missing = roleCodes.filter((c) => !found.has(c));
      throw new ConflictException(
        `Unknown or inactive roles: ${missing.join(', ')}`,
      );
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        display_name: dto.displayName,
        password_hash: hash,
        user_roles_assigned: {
          create: roles.map((r) => ({
            role_id: r.id,
          })),
        },
      },
      include: {
        user_roles_assigned: { include: { role: true } },
      },
    });

    const activeRoleId = roles[0].id;
    const token = await this.signToken({
      sub: user.id,
      email: user.email,
      activeRoleId,
    });

    return {
      access_token: token,
      user: this.sanitizeUser(user),
      activeRoleCode: roles[0].code,
      mustChangePassword: user.must_change_password,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: {
        user_roles_assigned: { include: { role: true } },
      },
    });
    if (!user?.password_hash || !user.is_active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(dto.password, user.password_hash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const assignments = user.user_roles_assigned.map((ur) => ur.role);
    if (assignments.length === 0) {
      throw new UnauthorizedException('User has no roles assigned');
    }

    const active = pickDefaultActiveRole(assignments);

    const token = await this.signToken({
      sub: user.id,
      email: user.email,
      activeRoleId: active.id,
    });

    return {
      access_token: token,
      user: this.sanitizeUser(user),
      activeRoleCode: active.code,
      mustChangePassword: user.must_change_password,
    };
  }

  async switchActiveRole(userId: string, roleCode: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        user_roles_assigned: { include: { role: true } },
      },
    });
    if (!user?.is_active) {
      throw new UnauthorizedException();
    }
    const assignments = user.user_roles_assigned.map((ur) => ur.role);
    const picked = findAssignedRoleByCode(assignments, roleCode);
    if (!picked) {
      throw new UnauthorizedException('Role not assigned to this user');
    }

    const token = await this.signToken({
      sub: user.id,
      email: user.email,
      activeRoleId: picked.id,
    });

    return {
      access_token: token,
      activeRoleCode: picked.code,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        password_hash: true,
        is_active: true,
      },
    });
    if (!user?.is_active || !user.password_hash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.currentPassword, user.password_hash);
    if (!ok) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const hash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password_hash: hash,
        must_change_password: false,
      },
    });
    return { ok: true };
  }

  async getProfile(userId: string, payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        user_roles_assigned: { include: { role: true } },
      },
    });
    if (!user) {
      throw new UnauthorizedException();
    }

    const activeRole = user.user_roles_assigned.find(
      (ur) => ur.role_id === payload.activeRoleId,
    )?.role;
    const permissions =
      activeRole?.code && ['SYSTEM', 'SUPERVISOR'].includes(activeRole.code)
        ? await this.prisma.permission.findMany({ select: { code: true } })
        : activeRole
          ? (
              await this.prisma.rolePermission.findMany({
                where: { role_id: activeRole.id },
                include: { permission: true },
              })
            ).map((rp) => ({ code: rp.permission.code }))
          : [];

    return {
      user: this.sanitizeUser(user),
      activeRoleCode: activeRole?.code ?? null,
      mustChangePassword: user.must_change_password,
      permissions: permissions.map((p) => p.code),
    };
  }

  private async signToken(payload: JwtPayload): Promise<string> {
    return this.jwt.signAsync(payload);
  }

  private sanitizeUser(user: {
    id: string;
    email: string;
    display_name: string | null;
    must_change_password?: boolean;
    user_roles_assigned: { role: { code: string; name: string } }[];
  }) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      roles: user.user_roles_assigned.map((ur) => ({
        code: ur.role.code,
        name: ur.role.name,
      })),
    };
  }
}
