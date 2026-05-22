import { ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt-payload';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateDnCombinationRulesDto } from './dto/update-dn-combination-rules.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertSupervisorOrSystemActiveRole(activeRoleId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: activeRoleId },
    });
    if (!role || !['SUPERVISOR', 'SYSTEM'].includes(role.code)) {
      throw new ForbiddenException(
        'DNs combination rules are only available when your active role is SUPERVISOR or SYSTEM.',
      );
    }
  }

  async getDnCombinationRules(payload: JwtPayload) {
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);
    const rows = await this.prisma.customer.findMany({
      select: {
        id: true,
        sold_to_code: true,
        sold_to_name: true,
        is_active: true,
        dn_combine_hints_disallowed: true,
      },
      orderBy: [{ sold_to_name: 'asc' }, { sold_to_code: 'asc' }],
    });
    return { items: rows };
  }

  async updateDnCombinationRules(
    payload: JwtPayload,
    dto: UpdateDnCombinationRulesDto,
  ) {
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);
    const disallow = new Set(
      dto.disallowingSoldToCodes.map((c) => c.trim()).filter(Boolean),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.updateMany({
        data: { dn_combine_hints_disallowed: false },
      });
      if (disallow.size > 0) {
        await tx.customer.updateMany({
          where: { sold_to_code: { in: [...disallow] } },
          data: { dn_combine_hints_disallowed: true },
        });
      }
    });

    return this.getDnCombinationRules(payload);
  }
}
