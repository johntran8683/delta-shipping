import {
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { JwtPayload } from '../auth/jwt-payload';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCarrierAccountDto } from './dto/create-carrier-account.dto';
import type { ListCustomersQueryDto } from './dto/list-customers.query.dto';
import type { UpdateCarrierAccountDto } from './dto/update-carrier-account.dto';
import type { UpdateCustomerDto } from './dto/update-customer.dto';
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

  async listCustomers(query: ListCustomersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const q = query.q?.trim() ?? '';

    const where: Prisma.CustomerWhereInput = {};
    if (typeof query.is_active === 'boolean') {
      where.is_active = query.is_active;
    }
    if (q) {
      where.OR = [
        { sold_to_code: { contains: q, mode: 'insensitive' } },
        { sold_to_name: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: [{ sold_to_name: 'asc' }, { sold_to_code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          sold_to_code: true,
          sold_to_name: true,
          fed_id_number: true,
          default_contact_name: true,
          default_phone: true,
          default_email: true,
          is_active: true,
          updated_at: true,
          _count: {
            select: {
              customer_carrier_accounts: true,
              ship_to_locations: true,
            },
          },
        },
      }),
    ]);

    return {
      items: items.map((c) => ({
        id: c.id,
        sold_to_code: c.sold_to_code,
        sold_to_name: c.sold_to_name,
        fed_id_number: c.fed_id_number,
        default_contact_name: c.default_contact_name,
        default_phone: c.default_phone,
        default_email: c.default_email,
        is_active: c.is_active,
        updated_at: c.updated_at,
        carrier_account_count: c._count.customer_carrier_accounts,
        ship_to_count: c._count.ship_to_locations,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Ship-to locations for one customer (for the manual DN form picker). */
  async listShipToLocations(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    const rows = await this.prisma.shipToLocation.findMany({
      where: { customer_id: customerId, is_active: true },
      orderBy: [{ ship_to_code: 'asc' }],
      select: {
        id: true,
        ship_to_code: true,
        ship_to_name: true,
        street1: true,
        city: true,
        state_region: true,
        country_code: true,
      },
    });
    return { items: rows };
  }

  async getCustomer(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        customer_carrier_accounts: {
          orderBy: [
            { is_active: 'desc' },
            { carrier_code: 'asc' },
            { account_number: 'asc' },
          ],
        },
        _count: { select: { ship_to_locations: true, delivery_notes: true } },
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return {
      id: customer.id,
      sold_to_code: customer.sold_to_code,
      sold_to_name: customer.sold_to_name,
      fed_id_number: customer.fed_id_number,
      default_contact_name: customer.default_contact_name,
      default_phone: customer.default_phone,
      default_email: customer.default_email,
      shipping_preference: customer.shipping_preference,
      is_active: customer.is_active,
      dn_combine_hints_disallowed: customer.dn_combine_hints_disallowed,
      requires_box_content: customer.requires_box_content,
      created_at: customer.created_at,
      updated_at: customer.updated_at,
      ship_to_count: customer._count.ship_to_locations,
      delivery_note_count: customer._count.delivery_notes,
      carrier_accounts: customer.customer_carrier_accounts.map((a) => ({
        id: a.id,
        carrier_code: a.carrier_code,
        account_number: a.account_number,
        is_collect_enabled: a.is_collect_enabled,
        notes: a.notes,
        is_active: a.is_active,
        created_at: a.created_at,
        updated_at: a.updated_at,
      })),
    };
  }

  async updateCustomer(id: string, dto: UpdateCustomerDto) {
    const existing = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Customer not found');
    }

    const data: Prisma.CustomerUpdateInput = {};
    if (dto.sold_to_name !== undefined) {
      const name = dto.sold_to_name.trim();
      if (!name) {
        throw new ConflictException('sold_to_name cannot be empty');
      }
      data.sold_to_name = name.slice(0, 255);
    }
    if (dto.fed_id_number !== undefined) {
      data.fed_id_number = dto.fed_id_number?.trim().slice(0, 50) || null;
    }
    if (dto.default_contact_name !== undefined) {
      data.default_contact_name =
        dto.default_contact_name?.trim().slice(0, 120) || null;
    }
    if (dto.default_phone !== undefined) {
      data.default_phone = dto.default_phone?.trim().slice(0, 50) || null;
    }
    if (dto.default_email !== undefined) {
      data.default_email =
        dto.default_email?.trim().toLowerCase().slice(0, 255) || null;
    }
    if (dto.shipping_preference !== undefined) {
      data.shipping_preference = dto.shipping_preference?.trim() || null;
    }
    if (dto.is_active !== undefined) {
      data.is_active = dto.is_active;
    }
    if (dto.requires_box_content !== undefined) {
      data.requires_box_content = dto.requires_box_content;
    }

    await this.prisma.customer.update({ where: { id }, data });
    return this.getCustomer(id);
  }

  async createCarrierAccount(customerId: string, dto: CreateCarrierAccountDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const carrier_code = dto.carrier_code.trim().toUpperCase().slice(0, 30);
    const account_number = dto.account_number.trim().slice(0, 80);
    if (!carrier_code || !account_number) {
      throw new ConflictException(
        'carrier_code and account_number are required',
      );
    }

    try {
      await this.prisma.customerCarrierAccount.create({
        data: {
          customer_id: customerId,
          carrier_code,
          account_number,
          is_collect_enabled: dto.is_collect_enabled ?? true,
          notes: dto.notes?.trim() || null,
          is_active: true,
        },
      });
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          `Carrier account already exists for ${carrier_code} / ${account_number}`,
        );
      }
      throw err;
    }

    return this.getCustomer(customerId);
  }

  async updateCarrierAccount(
    customerId: string,
    accountId: string,
    dto: UpdateCarrierAccountDto,
  ) {
    const account = await this.prisma.customerCarrierAccount.findFirst({
      where: { id: accountId, customer_id: customerId },
    });
    if (!account) {
      throw new NotFoundException('Carrier account not found');
    }

    const data: Prisma.CustomerCarrierAccountUpdateInput = {};
    if (dto.account_number !== undefined) {
      const account_number = dto.account_number.trim().slice(0, 80);
      if (!account_number) {
        throw new ConflictException('account_number cannot be empty');
      }
      data.account_number = account_number;
    }
    if (dto.is_collect_enabled !== undefined) {
      data.is_collect_enabled = dto.is_collect_enabled;
    }
    if (dto.notes !== undefined) {
      data.notes = dto.notes?.trim() || null;
    }
    if (dto.is_active !== undefined) {
      data.is_active = dto.is_active;
    }

    try {
      await this.prisma.customerCarrierAccount.update({
        where: { id: accountId },
        data,
      });
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          'Another account already uses this carrier_code / account_number',
        );
      }
      throw err;
    }

    return this.getCustomer(customerId);
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
