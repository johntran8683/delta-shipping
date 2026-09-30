import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, batch_status, dn_status, source_type } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import type { JwtPayload } from '../auth/jwt-payload';
import { PermissionsService } from '../auth/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
/** CJS-only package: default import emits `.default`, which breaks at runtime. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFKit = require('pdfkit');
import {
  filterCarrierAccountsForShippingType,
  inferCarrierCodeFromShippingType,
} from './carrier-match';
import { attachDeliveryNoteStatusContexts } from './delivery-notes-status-context';
import { buildDeliveryNoteListOrderBy } from './delivery-notes-list-sort';
import {
  deliveryNoteEligibleForRush,
  rushMarkBlockedMessage,
} from './dn-rush.policy';
import { sameShipGroup, splitShipGroupOptions } from './ship-group.policy';
import { parseChargingMethod } from './charging-method';
import {
  ALL_DN_STATUSES,
  SUPERVISING_ROLES,
  getTransitionMeta,
} from './dn-transition.policy';
import {
  DELIVERY_NOTE_STATS_TIMEZONE,
  getVancouverDayBoundsUtc,
} from './delivery-note-stats';
import type { CompletePackDto } from './dto/complete-pack.dto';
import type { CreateDeliveryNoteDto } from './dto/manual-delivery-note.dto';
import type { ListDeliveryNotesQueryDto } from './dto/list-delivery-notes.query.dto';
import type { StartPackDto } from './dto/start-pack.dto';

type WorkflowActorRow = {
  id: string;
  email: string;
  display_name: string | null;
};

type WorkflowStatusHistoryRow = {
  to_status: dn_status;
  actor_user: WorkflowActorRow;
};

/** Whole calendar days between `from` and today (floored at 0). */
function calendarDayAge(from: Date, now: Date = new Date()): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / 86_400_000),
  );
}

@Injectable()
export class DeliveryNotesService {
  private readonly logger = new Logger(DeliveryNotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async list(query: ListDeliveryNotesQueryDto, currentUserId?: string) {
    const normalizeCode = (value: string | null | undefined): string => {
      const raw = (value ?? '').trim().toUpperCase();
      if (!raw) return '';
      if (/^\d+$/.test(raw)) {
        return raw.replace(/^0+/, '') || '0';
      }
      return raw;
    };

    const pageSize = Math.min(query.pageSize ?? query.limit ?? 50, 200);
    const page = Math.max(query.page ?? 1, 1);
    const skip = (page - 1) * pageSize;

    const conditions: Prisma.DeliveryNoteWhereInput[] = [];
    const myQueueFilter =
      query.myPicking || query.myPacking || query.myShipping;
    const shippedTodayFilter =
      !myQueueFilter && query.status === dn_status.SHIPPED;

    if (!shippedTodayFilter) {
      if (query.is_open === undefined) {
        conditions.push({ is_open: true });
      } else {
        conditions.push({ is_open: query.is_open });
      }
    }

    if (query.myPicking) {
      if (!currentUserId?.trim()) {
        throw new BadRequestException(
          'myPicking requires an authenticated user',
        );
      }
      conditions.push({
        current_status: dn_status.PICKING,
        picking_started_by_user_id: currentUserId,
      });
    } else if (query.myPacking) {
      if (!currentUserId?.trim()) {
        throw new BadRequestException(
          'myPacking requires an authenticated user',
        );
      }
      conditions.push({
        current_status: dn_status.PACKING,
        packing_started_by_user_id: currentUserId,
      });
    } else if (query.myShipping) {
      if (!currentUserId?.trim()) {
        throw new BadRequestException(
          'myShipping requires an authenticated user',
        );
      }
      conditions.push({
        current_status: dn_status.SHIPPING_IN_PROGRESS,
        shipping_started_by_user_id: currentUserId,
      });
    } else if (shippedTodayFilter) {
      const { startUtc, endUtc } = getVancouverDayBoundsUtc();
      conditions.push({
        status_history: {
          some: {
            to_status: dn_status.SHIPPED,
            changed_at: { gte: startUtc, lt: endUtc },
          },
        },
      });
    } else if (query.status) {
      conditions.push({ current_status: query.status });
    }

    if (query.isRushed) {
      conditions.push({ is_rushed: true });
    }

    const dnNumber = query.dnNumber?.trim();
    if (dnNumber) {
      conditions.push({
        dn_number: { contains: dnNumber, mode: 'insensitive' },
      });
    }

    const customer = query.customer?.trim();
    if (customer) {
      conditions.push({
        OR: [
          { sold_to_code: { contains: customer, mode: 'insensitive' } },
          {
            customer: {
              sold_to_name: { contains: customer, mode: 'insensitive' },
            },
          },
          {
            customer: {
              sold_to_code: { contains: customer, mode: 'insensitive' },
            },
          },
        ],
      });
    }

    const shipTo = query.shipTo?.trim();
    if (shipTo) {
      conditions.push({
        OR: [
          { ship_to_code: { contains: shipTo, mode: 'insensitive' } },
          {
            ship_to_location: {
              OR: [
                { ship_to_name: { contains: shipTo, mode: 'insensitive' } },
                { street1: { contains: shipTo, mode: 'insensitive' } },
                { street2: { contains: shipTo, mode: 'insensitive' } },
                { city: { contains: shipTo, mode: 'insensitive' } },
                { state_region: { contains: shipTo, mode: 'insensitive' } },
                { postal_code: { contains: shipTo, mode: 'insensitive' } },
                { country_name: { contains: shipTo, mode: 'insensitive' } },
              ],
            },
          },
        ],
      });
    }

    const where: Prisma.DeliveryNoteWhereInput =
      conditions.length === 1 ? conditions[0]! : { AND: conditions };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.deliveryNote.count({ where }),
      this.prisma.deliveryNote.findMany({
        where,
        orderBy: buildDeliveryNoteListOrderBy(query.sortBy, query.sortDir),
        skip,
        take: pageSize,
        select: {
          id: true,
          dn_number: true,
          sold_to_code: true,
          ship_to_code: true,
          customer: {
            select: {
              sold_to_name: true,
            },
          },
          ship_to_location: {
            select: {
              ship_to_name: true,
              street1: true,
              street2: true,
              city: true,
              state_region: true,
              postal_code: true,
              country_name: true,
            },
          },
          current_priority_no: true,
          is_rushed: true,
          latest_rush_reason: true,
          current_status: true,
          currency_code: true,
          is_open: true,
          dn_create_date: true,
          requested_delivery_date: true,
          projected_ship_date: true,
          shipping_type: true,
          po_date: true,
          customer_po: true,
          ship_to_region_state: true,
          created_at: true,
        },
      }),
    ]);

    const soldToCodes = Array.from(new Set(rows.map((r) => r.sold_to_code)));
    const customersByCode = new Map<string, { sold_to_name: string }>();
    if (soldToCodes.length > 0) {
      const customers = await this.prisma.customer.findMany({
        where: { sold_to_code: { in: soldToCodes } },
        select: { sold_to_code: true, sold_to_name: true },
      });
      for (const c of customers) {
        customersByCode.set(normalizeCode(c.sold_to_code), {
          sold_to_name: c.sold_to_name,
        });
      }
      if (customers.length === 0) {
        const fallbackCustomers = await this.prisma.customer.findMany({
          select: { sold_to_code: true, sold_to_name: true },
        });
        for (const c of fallbackCustomers) {
          customersByCode.set(normalizeCode(c.sold_to_code), {
            sold_to_name: c.sold_to_name,
          });
        }
      }
    }

    const shipToRows = await this.prisma.shipToLocation.findMany({
      where: {
        ship_to_code: {
          in: Array.from(new Set(rows.map((r) => r.ship_to_code))),
        },
        customer: { sold_to_code: { in: soldToCodes } },
      },
      select: {
        ship_to_code: true,
        ship_to_name: true,
        street1: true,
        street2: true,
        city: true,
        state_region: true,
        postal_code: true,
        country_name: true,
        customer: { select: { sold_to_code: true } },
      },
    });
    const shipToByCompositeCode = new Map<
      string,
      (typeof shipToRows)[number]
    >();
    for (const s of shipToRows) {
      shipToByCompositeCode.set(
        `${normalizeCode(s.customer.sold_to_code)}::${normalizeCode(s.ship_to_code)}`,
        s,
      );
    }
    if (shipToRows.length === 0) {
      const fallbackShipToRows = await this.prisma.shipToLocation.findMany({
        select: {
          ship_to_code: true,
          ship_to_name: true,
          street1: true,
          street2: true,
          city: true,
          state_region: true,
          postal_code: true,
          country_name: true,
          customer: { select: { sold_to_code: true } },
        },
      });
      for (const s of fallbackShipToRows) {
        shipToByCompositeCode.set(
          `${normalizeCode(s.customer.sold_to_code)}::${normalizeCode(s.ship_to_code)}`,
          s,
        );
      }
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const peerCountsById = await this.getShipmentCombinePeerCountsByIds(
      rows.map((r) => r.id),
    );
    /** Distinct SO numbers per DN, from lines (a DN can carry several SOs). */
    const soNumberById = new Map<string, string[]>();
    if (rows.length > 0) {
      const soRows = await this.prisma.deliveryNoteLine.findMany({
        where: {
          delivery_note_id: { in: rows.map((r) => r.id) },
          so_number: { not: null },
        },
        select: { delivery_note_id: true, so_number: true },
        distinct: ['delivery_note_id', 'so_number'],
      });
      for (const soRow of soRows) {
        const so = soRow.so_number?.trim();
        if (!so) continue;
        const arr = soNumberById.get(soRow.delivery_note_id) ?? [];
        if (!arr.includes(so)) arr.push(so);
        soNumberById.set(soRow.delivery_note_id, arr);
      }
      for (const arr of soNumberById.values()) arr.sort();
    }
    const mapped = rows.map((row) => {
      const joinedShipTo =
        shipToByCompositeCode.get(
          `${normalizeCode(row.sold_to_code)}::${normalizeCode(row.ship_to_code)}`,
        ) ?? row.ship_to_location;
      const joinedCustomer = customersByCode.get(
        normalizeCode(row.sold_to_code),
      );
      const shipToDisplayName =
        joinedShipTo?.ship_to_name?.trim() ||
        row.ship_to_location?.ship_to_name?.trim() ||
        '';
      const rawShipToStreet =
        joinedShipTo?.street1?.trim() ||
        row.ship_to_location?.street1?.trim() ||
        null;
      const shipToStreet =
        rawShipToStreet &&
        normalizeCode(rawShipToStreet) !== normalizeCode(row.ship_to_code) &&
        normalizeCode(rawShipToStreet) !== normalizeCode(shipToDisplayName)
          ? rawShipToStreet
          : null;
      return {
        ...row,
        sold_to_name:
          row.customer?.sold_to_name ??
          joinedCustomer?.sold_to_name ??
          row.sold_to_code,
        /** Human-readable ship-to name (matches Excel "Ship-to Name"). */
        ship_to_address: shipToDisplayName || row.ship_to_code,
        ship_to_street: shipToStreet,
        ship_together_other_count: peerCountsById.get(row.id) ?? 0,
        /** Distinct SO numbers pulled from the DN's lines (line-level field). */
        so_numbers: soNumberById.get(row.id) ?? [],
        /**
         * Whole calendar days the note has been sitting in NEW
         * (null for any other status). Lets same-status notes from
         * different daily imports be told apart at a glance.
         */
        new_age_days:
          row.current_status === 'NEW' ? calendarDayAge(row.created_at) : null,
      };
    });

    const items = await attachDeliveryNoteStatusContexts(this.prisma, mapped);

    return {
      items,
      page,
      pageSize,
      total,
      totalPages,
    };
  }

  /**
   * How many other delivery notes (globally, ignoring list filters) share the same
   * customer, ship-to code, ship-to location, and ship type, excluding terminal/hold
   * statuses — useful as a picker hint only (not enforced when creating shipments).
   */
  private async getShipmentCombinePeerCountsByIds(
    ids: string[],
  ): Promise<Map<string, number>> {
    if (ids.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.$queryRaw<
      { id: string; peer_count: number }[]
    >(
      Prisma.sql`
        WITH eligible AS (
          SELECT
            dn.id,
            dn.sold_to_code,
            dn.ship_to_code,
            dn.ship_to_location_id,
            TRIM(COALESCE(dn.shipping_type, '')) AS ship_type_norm
          FROM delivery_notes dn
          LEFT JOIN customers cust ON cust.id = dn.customer_id
            OR (dn.customer_id IS NULL AND cust.sold_to_code = dn.sold_to_code)
          WHERE dn.current_status::text NOT IN ('SHIPPED', 'ON_HOLD', 'CANCELLED')
            AND (cust.id IS NULL OR cust.dn_combine_hints_disallowed = false)
        ),
        cluster_sizes AS (
          SELECT
            sold_to_code,
            ship_to_code,
            ship_to_location_id,
            ship_type_norm,
            COUNT(*)::int AS cluster_size
          FROM eligible
          GROUP BY sold_to_code, ship_to_code, ship_to_location_id, ship_type_norm
        )
        SELECT
          e.id,
          (cs.cluster_size - 1)::int AS peer_count
        FROM eligible e
        INNER JOIN cluster_sizes cs ON
          cs.sold_to_code = e.sold_to_code
          AND cs.ship_to_code = e.ship_to_code
          AND cs.ship_to_location_id IS NOT DISTINCT FROM e.ship_to_location_id
          AND cs.ship_type_norm = e.ship_type_norm
        WHERE e.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      `,
    );

    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.id, Number(r.peer_count));
    }
    return map;
  }

  /**
   * Other eligible delivery notes that share the same ship-together grouping keys
   * as this note (same rules as `ship_together_other_count` on the list).
   */
  async listShipTogetherPeers(id: string) {
    const exists = await this.prisma.deliveryNote.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException();
    }

    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        dn_number: string;
        current_status: string;
        /** Sum of line `open_qty` (remaining units); string from numeric. */
        total_products: string;
      }[]
    >(
      Prisma.sql`
        WITH anchor AS (
          SELECT
            dn.sold_to_code,
            dn.ship_to_code,
            dn.ship_to_location_id,
            TRIM(COALESCE(dn.shipping_type, '')) AS ship_type_norm,
            COALESCE(cust.dn_combine_hints_disallowed, false) AS customer_disallows_combine
          FROM delivery_notes dn
          LEFT JOIN customers cust ON cust.id = dn.customer_id
            OR (dn.customer_id IS NULL AND cust.sold_to_code = dn.sold_to_code)
          WHERE dn.id = ${id}::uuid
        ),
        eligible AS (
          SELECT
            dn.id,
            dn.dn_number,
            dn.current_status,
            dn.current_priority_no,
            dn.sold_to_code,
            dn.ship_to_code,
            dn.ship_to_location_id,
            TRIM(COALESCE(dn.shipping_type, '')) AS ship_type_norm
          FROM delivery_notes dn
          LEFT JOIN customers cust ON cust.id = dn.customer_id
            OR (dn.customer_id IS NULL AND cust.sold_to_code = dn.sold_to_code)
          WHERE dn.current_status::text NOT IN ('SHIPPED', 'ON_HOLD', 'CANCELLED')
            AND (cust.id IS NULL OR cust.dn_combine_hints_disallowed = false)
        )
        SELECT
          e.id,
          e.dn_number,
          e.current_status::text AS current_status,
          (
            COALESCE(
              (
                SELECT SUM(COALESCE(l.open_qty, 0))
                FROM delivery_note_lines l
                WHERE l.delivery_note_id = e.id
              ),
              0
            )
          )::text AS total_products
        FROM eligible e
        INNER JOIN anchor a ON
          e.sold_to_code = a.sold_to_code
          AND e.ship_to_code = a.ship_to_code
          AND e.ship_to_location_id IS NOT DISTINCT FROM a.ship_to_location_id
          AND e.ship_type_norm = a.ship_type_norm
        WHERE e.id <> ${id}::uuid
          AND NOT a.customer_disallows_combine
        ORDER BY e.current_priority_no ASC NULLS LAST, e.dn_number ASC
      `,
    );

    return { items: rows };
  }

  /**
   * Other delivery notes in the same pack-combine cluster as the anchor (same
   * keys as ship-together hints). Includes non-PICKED rows so the UI can explain
   * why they cannot be added; only rows with `eligible_for_pack_session` may be
   * sent to POST /pack/start as peers. Sold-to / ship-to codes are trimmed when
   * matching so minor spacing differences do not hide valid peers.
   */
  async listPackingCombinePeers(anchorId: string) {
    const exists = await this.prisma.deliveryNote.findUnique({
      where: { id: anchorId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException();
    }

    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        dn_number: string;
        current_status: string;
        eligible_for_pack_session: boolean;
      }[]
    >(
      Prisma.sql`
        WITH anchor AS (
          SELECT
            TRIM(COALESCE(dn.sold_to_code, '')) AS sold_to_code,
            TRIM(COALESCE(dn.ship_to_code, '')) AS ship_to_code,
            dn.ship_to_location_id,
            TRIM(COALESCE(dn.shipping_type, '')) AS ship_type_norm,
            COALESCE(cust.dn_combine_hints_disallowed, false) AS customer_disallows_combine
          FROM delivery_notes dn
          LEFT JOIN customers cust ON cust.id = dn.customer_id
            OR (dn.customer_id IS NULL AND cust.sold_to_code = dn.sold_to_code)
          WHERE dn.id = ${anchorId}::uuid
        ),
        cluster AS (
          SELECT
            dn.id,
            dn.dn_number,
            dn.current_status::text AS current_status,
            TRIM(COALESCE(dn.sold_to_code, '')) AS sold_to_code,
            TRIM(COALESCE(dn.ship_to_code, '')) AS ship_to_code,
            dn.ship_to_location_id,
            TRIM(COALESCE(dn.shipping_type, '')) AS ship_type_norm
          FROM delivery_notes dn
          LEFT JOIN customers cust ON cust.id = dn.customer_id
            OR (dn.customer_id IS NULL AND cust.sold_to_code = dn.sold_to_code)
          WHERE dn.current_status::text NOT IN ('SHIPPED', 'ON_HOLD', 'CANCELLED')
            AND (cust.id IS NULL OR cust.dn_combine_hints_disallowed = false)
        )
        SELECT
          c.id,
          c.dn_number,
          c.current_status,
          (c.current_status = 'PICKED') AS eligible_for_pack_session
        FROM cluster c
        INNER JOIN anchor a ON
          c.sold_to_code = a.sold_to_code
          AND c.ship_to_code = a.ship_to_code
          AND c.ship_to_location_id IS NOT DISTINCT FROM a.ship_to_location_id
          AND c.ship_type_norm = a.ship_type_norm
        WHERE c.id <> ${anchorId}::uuid
          AND NOT a.customer_disallows_combine
        ORDER BY
          CASE WHEN c.current_status = 'PICKED' THEN 0 ELSE 1 END,
          c.dn_number ASC
        LIMIT 100
      `,
    );

    return { items: rows };
  }

  /** When pack migrations are not applied yet, avoid crashing detail load. */
  private isPackSchemaMissingError(e: unknown): boolean {
    if (e instanceof PrismaClientKnownRequestError) {
      if (e.code === 'P2021') return true;
      if (e.code === 'P2010' && /pack_/i.test(String(e.message))) return true;
    }
    const msg = e instanceof Error ? e.message : String(e);
    return (
      /pack_session|pack_boxes|pack_sessions/i.test(msg) &&
      /does not exist|relation .* does not exist/i.test(msg)
    );
  }

  private async loadPackExtrasForDetail(id: string) {
    try {
      return await Promise.all([
        this.listPackingCombinePeers(id),
        this.getActivePackSessionDetail(id),
        this.listCompletedPackSessionsForDetail(id, 5),
      ]);
    } catch (e) {
      if (this.isPackSchemaMissingError(e)) {
        this.logger.warn(
          'Pack tables missing; apply migration 20260512060000_pack_sessions_and_boxes. Packing fields omitted from this response.',
        );
        return [{ items: [] }, null, []] as const;
      }
      throw e;
    }
  }

  private async getActivePackSessionDetail(anchorId: string) {
    const link = await this.prisma.packSessionDeliveryNote.findFirst({
      where: {
        delivery_note_id: anchorId,
        pack_session: { completed_at: null },
      },
      include: {
        pack_session: {
          include: {
            delivery_notes: {
              include: {
                delivery_note: {
                  select: { id: true, dn_number: true, current_status: true },
                },
              },
            },
          },
        },
      },
    });
    if (!link) return null;
    const s = link.pack_session;
    return {
      id: s.id,
      created_at: s.created_at.toISOString(),
      delivery_notes: s.delivery_notes.map((m) => ({
        id: m.delivery_note.id,
        dn_number: m.delivery_note.dn_number,
        current_status: m.delivery_note.current_status,
      })),
    };
  }

  private async listCompletedPackSessionsForDetail(
    deliveryNoteId: string,
    take: number,
  ) {
    const sessions = await this.prisma.packSession.findMany({
      where: {
        completed_at: { not: null },
        delivery_notes: { some: { delivery_note_id: deliveryNoteId } },
      },
      orderBy: { completed_at: 'desc' },
      take,
      include: {
        creator: {
          select: { id: true, email: true, display_name: true },
        },
        boxes: { orderBy: { sort_order: 'asc' } },
        delivery_notes: {
          include: {
            delivery_note: {
              select: { id: true, dn_number: true, current_status: true },
            },
          },
        },
      },
    });
    return sessions.map((s) => ({
      id: s.id,
      completed_at: s.completed_at?.toISOString() ?? null,
      pack_completion_note: s.pack_completion_note?.trim() || null,
      packed_by: this.serializeWorkflowActor(s.creator),
      delivery_notes: s.delivery_notes.map((m) => ({
        id: m.delivery_note.id,
        dn_number: m.delivery_note.dn_number,
        current_status: m.delivery_note.current_status,
      })),
      boxes: s.boxes.map((b) => ({
        id: b.id,
        sort_order: b.sort_order,
        box_number: b.box_number,
        weight_lb: b.weight_lb.toString(),
        length_in: b.length_in.toString(),
        width_in: b.width_in.toString(),
        height_in: b.height_in.toString(),
      })),
    }));
  }

  private assertPackClusterDns(
    anchorId: string,
    dns: Array<{
      id: string;
      dn_number: string;
      sold_to_code: string;
      ship_to_code: string;
      ship_to_location_id: string | null;
      shipping_type: string | null;
      current_status: dn_status;
      customer: { dn_combine_hints_disallowed: boolean } | null;
    }>,
  ) {
    const normType = (s: string | null | undefined) => (s ?? '').trim();
    const normCode = (s: string | null | undefined) => (s ?? '').trim();
    const key = (d: (typeof dns)[number]) =>
      `${normCode(d.sold_to_code)}|${normCode(d.ship_to_code)}|${d.ship_to_location_id ?? 'NULL'}|${normType(d.shipping_type)}`;
    const anchor = dns.find((d) => d.id === anchorId);
    if (!anchor) {
      throw new BadRequestException('Anchor delivery note missing from set');
    }
    const k0 = key(anchor);
    for (const d of dns) {
      if (d.current_status !== dn_status.PICKED) {
        throw new BadRequestException(
          `All delivery notes must be PICKED before packing (${d.dn_number}).`,
        );
      }
      if (key(d) !== k0) {
        throw new BadRequestException(
          'All delivery notes must share the same customer, ship-to, location, and ship type.',
        );
      }
      if (d.customer?.dn_combine_hints_disallowed === true) {
        throw new BadRequestException(
          `Customer rules disallow combining for sold-to ${d.sold_to_code}.`,
        );
      }
    }
  }

  private async assertNoOpenPackSessionForDns(
    tx: Prisma.TransactionClient,
    dnIds: string[],
  ) {
    const hit = await tx.packSession.findFirst({
      where: {
        completed_at: null,
        delivery_notes: { some: { delivery_note_id: { in: dnIds } } },
      },
      select: { id: true },
    });
    if (hit) {
      throw new BadRequestException(
        'One or more delivery notes are already in an open pack session. Complete packing first.',
      );
    }
  }

  async startPacking(anchorId: string, dto: StartPackDto, payload: JwtPayload) {
    const peerIds = [...new Set(dto.peerDeliveryNoteIds ?? [])].filter(
      (x) => x && x !== anchorId,
    );
    const allIds = [anchorId, ...peerIds];

    // Warn if the packer already has another note in PACKING (they usually
    // work on one at a time). Not a blocker — just a warning.
    if (!dto.confirmDoubleClaim) {
      const inProgress = await this.prisma.deliveryNote.findFirst({
        where: {
          packing_started_by_user_id: payload.sub,
          current_status: dn_status.PACKING,
          id: { notIn: allIds },
        },
        select: { id: true, dn_number: true },
      });
      if (inProgress) {
        return {
          requiresConfirmation: true,
          warning: `You are already packing ${inProgress.dn_number}. Start packing this note too?`,
          inProgressNote: inProgress,
        };
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await this.assertNoOpenPackSessionForDns(tx, allIds);

      const dns = await tx.deliveryNote.findMany({
        where: { id: { in: allIds } },
        include: {
          customer: { select: { dn_combine_hints_disallowed: true } },
        },
      });
      if (dns.length !== allIds.length) {
        throw new BadRequestException(
          'One or more delivery notes were not found',
        );
      }
      this.assertPackClusterDns(anchorId, dns);

      const sessionId = randomUUID();
      await tx.packSession.create({
        data: {
          id: sessionId,
          created_by_user_id: payload.sub,
        },
      });
      await tx.packSessionDeliveryNote.createMany({
        data: allIds.map((delivery_note_id) => ({
          pack_session_id: sessionId,
          delivery_note_id,
        })),
      });

      const msg = `packSession:${sessionId}`;
      for (const dnId of allIds) {
        await this.applyTransition(tx, dnId, dn_status.PACKING, payload, msg, {
          allowPackTransitions: true,
        });
      }
    });

    return this.findOne(anchorId, payload);
  }

  async completePacking(
    anchorId: string,
    dto: CompletePackDto,
    payload: JwtPayload,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.packSessionDeliveryNote.findFirst({
        where: {
          delivery_note_id: anchorId,
          pack_session: { completed_at: null },
        },
        include: {
          pack_session: {
            include: {
              delivery_notes: {
                select: { delivery_note_id: true },
              },
            },
          },
        },
      });
      if (!membership) {
        throw new BadRequestException(
          'No open pack session for this delivery note. Start packing first.',
        );
      }
      const session = membership.pack_session;
      const memberIds = session.delivery_notes.map((d) => d.delivery_note_id);

      const members = await tx.deliveryNote.findMany({
        where: { id: { in: memberIds } },
      });
      for (const m of members) {
        if (m.current_status !== dn_status.PACKING) {
          throw new BadRequestException(
            `All delivery notes in the pack session must be in PACKING (check ${m.dn_number}).`,
          );
        }
      }

      const boxRows = dto.boxes.map((b, idx) => ({
        id: randomUUID(),
        pack_session_id: session.id,
        sort_order: idx,
        box_number: b.boxNumber?.trim() || null,
        weight_lb: new Prisma.Decimal(b.weightLb),
        length_in: new Prisma.Decimal(b.lengthIn),
        width_in: new Prisma.Decimal(b.widthIn),
        height_in: new Prisma.Decimal(b.heightIn),
      }));
      await tx.packBox.createMany({ data: boxRows });

      const trimmedNote = dto.packCompletionNote?.trim();
      await tx.packSession.update({
        where: { id: session.id },
        data: {
          completed_at: new Date(),
          pack_completion_note: trimmedNote || null,
        },
      });

      const msg = `packSession:${session.id};boxes:${dto.boxes.length}${
        trimmedNote ? `;note:${trimmedNote.slice(0, 200)}` : ''
      }`;
      for (const dnId of memberIds) {
        await this.applyTransition(tx, dnId, dn_status.PACKED, payload, msg, {
          allowPackTransitions: true,
        });
      }
    });

    return this.findOne(anchorId, payload);
  }

  /** Replace boxes and pack note on the latest completed session while all members stay PACKED. */
  async updateCompletedPacking(
    anchorId: string,
    dto: CompletePackDto,
    payload: JwtPayload,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const session = await this.findLatestCompletedPackSessionForNote(
        tx,
        anchorId,
      );
      if (!session) {
        throw new BadRequestException(
          'No completed pack session found for this delivery note',
        );
      }
      await this.assertDnsStatuses(tx, session.memberIds, dn_status.PACKED);

      await tx.packBox.deleteMany({ where: { pack_session_id: session.id } });

      const boxRows = dto.boxes.map((b, idx) => ({
        id: randomUUID(),
        pack_session_id: session.id,
        sort_order: idx,
        box_number: b.boxNumber?.trim() || null,
        weight_lb: new Prisma.Decimal(b.weightLb),
        length_in: new Prisma.Decimal(b.lengthIn),
        width_in: new Prisma.Decimal(b.widthIn),
        height_in: new Prisma.Decimal(b.heightIn),
      }));
      await tx.packBox.createMany({ data: boxRows });

      const trimmedNote = dto.packCompletionNote?.trim();
      await tx.packSession.update({
        where: { id: session.id },
        data: { pack_completion_note: trimmedNote || null },
      });
    });

    return this.findOne(anchorId, payload);
  }

  private async assertPrintRole(payload: JwtPayload) {
    const role = await this.getActiveRole(payload);
    if (!['PACKER', 'SHIPPER', 'SUPERVISOR', 'SYSTEM'].includes(role.code)) {
      throw new ForbiddenException(
        'Print actions require active role PACKER, SHIPPER, SUPERVISOR, or SYSTEM.',
      );
    }
    const ok = await this.permissions.roleHasPermission(
      payload.activeRoleId,
      'dn.read',
    );
    if (!ok) {
      throw new ForbiddenException('Missing permission dn.read');
    }
  }

  async buildShippingLabelPdf(
    id: string,
    payload: JwtPayload,
  ): Promise<Buffer> {
    await this.assertPrintRole(payload);
    const dn = await this.prisma.deliveryNote.findUnique({
      where: { id },
      include: {
        customer: { select: { sold_to_name: true } },
        ship_to_location: {
          select: {
            ship_to_name: true,
            street1: true,
            street2: true,
            city: true,
            state_region: true,
            postal_code: true,
            country_name: true,
          },
        },
      },
    });
    if (!dn) throw new NotFoundException('Delivery note not found');

    const company =
      dn.customer?.sold_to_name?.trim() || dn.sold_to_code || 'Customer';
    const st = dn.ship_to_location;
    const shipToName = st?.ship_to_name?.trim() || dn.ship_to_code;
    const addrLines: string[] = [];
    if (st?.street1?.trim()) addrLines.push(st.street1.trim());
    if (st?.street2?.trim()) addrLines.push(st.street2.trim());
    const cityLine = [st?.city, st?.state_region, st?.postal_code]
      .filter((x) => x?.trim())
      .join(', ');
    if (cityLine) addrLines.push(cityLine);
    if (st?.country_name?.trim()) addrLines.push(st.country_name.trim());

    return this.renderPdfDocument(288, 432, 28, (doc) => {
      doc.fontSize(9).fillColor('#111827');
      doc.text(`DN ${dn.dn_number}`);
      doc.moveDown(0.35);
      doc.fontSize(11).font('Helvetica-Bold').text(company);
      doc.font('Helvetica').fontSize(10);
      doc.moveDown(0.25);
      doc.text(`Ship-to: ${shipToName}`);
      doc.moveDown(0.35);
      for (const line of addrLines) {
        doc.text(line);
      }
    });
  }

  async buildPoLabelPdf(id: string, payload: JwtPayload): Promise<Buffer> {
    await this.assertPrintRole(payload);
    const dn = await this.prisma.deliveryNote.findUnique({
      where: { id },
      select: { customer_po: true, dn_number: true },
    });
    if (!dn) throw new NotFoundException('Delivery note not found');
    const po = dn.customer_po?.trim();
    if (!po) {
      throw new BadRequestException(
        'This delivery note has no customer PO to print.',
      );
    }

    return this.renderPdfDocument(288, 144, 20, (doc) => {
      doc.fontSize(8).fillColor('#6b7280').text(`DN ${dn.dn_number}`, {
        align: 'center',
      });
      doc.moveDown(0.5);
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#111827').text(po, {
        align: 'center',
      });
    });
  }

  private renderPdfDocument(
    widthPt: number,
    heightPt: number,
    marginPt: number,
    draw: (doc: InstanceType<typeof PDFKit>) => void,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFKit({
        size: [widthPt, heightPt],
        margin: marginPt,
        autoFirstPage: true,
      });
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      try {
        draw(doc);
      } catch (e) {
        reject(e);
        return;
      }
      doc.end();
    });
  }

  /** Daily counts for the current Vancouver calendar day. */
  async getDailyStats(_payload: JwtPayload) {
    const { localDate, startUtc, endUtc } = getVancouverDayBoundsUtc();
    const changedToday = { gte: startUtc, lt: endUtc };

    const openWhere = { is_open: true };

    const [
      dueToday,
      pickedTotal,
      packedTotal,
      shippedGroups,
      byStatusGroups,
      rushedOpen,
    ] = await Promise.all([
      this.prisma.deliveryNote.count({
        where: {
          ...openWhere,
          current_status: {
            notIn: [dn_status.SHIPPED, dn_status.CANCELLED, dn_status.ON_HOLD],
          },
        },
      }),
      this.prisma.deliveryNote.count({
        where: { ...openWhere, current_status: dn_status.PICKED },
      }),
      this.prisma.deliveryNote.count({
        where: { ...openWhere, current_status: dn_status.PACKED },
      }),
      this.prisma.dnStatusHistory.groupBy({
        by: ['delivery_note_id'],
        where: { to_status: dn_status.SHIPPED, changed_at: changedToday },
      }),
      this.prisma.deliveryNote.groupBy({
        by: ['current_status'],
        where: openWhere,
        _count: { _all: true },
      }),
      this.prisma.deliveryNote.count({
        where: { ...openWhere, is_rushed: true },
      }),
    ]);

    const by_status: Record<string, number> = {};
    for (const g of byStatusGroups) {
      by_status[g.current_status] = g._count._all;
    }

    return {
      date: localDate,
      timezone: DELIVERY_NOTE_STATS_TIMEZONE,
      due_today: dueToday,
      picked_total: pickedTotal,
      packed_total: packedTotal,
      shipped_today: shippedGroups.length,
      by_status,
      rushed_open: rushedOpen,
    };
  }

  /**
   * Picker quick search: match `dn_number` ending with the given digits.
   * Excludes terminal/hold statuses so suggestions stay actionable.
   */
  async suggestByDnSuffix(digits: string) {
    const suffix = digits.replace(/\D/g, '');
    const excluded: dn_status[] = [
      dn_status.SHIPPED,
      dn_status.CANCELLED,
      dn_status.ON_HOLD,
    ];

    const rows = await this.prisma.deliveryNote.findMany({
      where: {
        current_status: { notIn: excluded },
        dn_number: { endsWith: suffix, mode: 'insensitive' },
      },
      orderBy: [{ current_priority_no: 'asc' }, { dn_number: 'asc' }],
      take: 25,
      select: {
        id: true,
        dn_number: true,
        current_status: true,
        current_priority_no: true,
        is_rushed: true,
        sold_to_code: true,
        customer: { select: { sold_to_name: true } },
      },
    });

    const items = rows.map((r) => ({
      id: r.id,
      dn_number: r.dn_number,
      current_status: r.current_status,
      current_priority_no: r.current_priority_no,
      is_rushed: r.is_rushed,
      sold_to_name: r.customer?.sold_to_name?.trim() || r.sold_to_code,
    }));

    return { items };
  }

  async findOne(id: string, payload: JwtPayload) {
    const dn = await this.prisma.deliveryNote.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            sold_to_name: true,
            default_email: true,
            fed_id_number: true,
            customer_carrier_accounts: {
              where: { is_active: true },
              select: { carrier_code: true, account_number: true },
              orderBy: [{ carrier_code: 'asc' }, { account_number: 'asc' }],
            },
          },
        },
        ship_to_location: {
          select: {
            ship_to_name: true,
            street1: true,
            street2: true,
            city: true,
            state_region: true,
            postal_code: true,
            country_code: true,
            country_name: true,
          },
        },
        picking_started_by: {
          select: { id: true, email: true, display_name: true },
        },
        packing_started_by: {
          select: { id: true, email: true, display_name: true },
        },
        shipping_started_by: {
          select: { id: true, email: true, display_name: true },
        },
        lines: {
          orderBy: { doc_item: 'asc' },
        },
        status_history: {
          orderBy: { changed_at: 'desc' },
          take: 40,
          include: {
            actor_user: {
              select: { id: true, email: true, display_name: true },
            },
            actor_role: { select: { code: true, name: true } },
          },
        },
        priority_history: {
          orderBy: { changed_at: 'desc' },
          take: 20,
          include: {
            actor_user: {
              select: { id: true, email: true, display_name: true },
            },
            actor_role: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!dn) {
      throw new NotFoundException('Delivery note not found');
    }

    const role = await this.getActiveRole(payload);
    const allowedNextStatuses = (
      await this.computeAllowedNextStatuses(
        payload,
        role.code,
        dn.current_status,
        dn.picking_started_by_user_id,
      )
    ).filter(
      (ns) =>
        !(
          (dn.current_status === dn_status.PICKED &&
            ns === dn_status.PACKING) ||
          (dn.current_status === dn_status.PACKING && ns === dn_status.PACKED)
        ),
    );
    const canSetPriority =
      (role.code === 'SUPERVISOR' || role.code === 'TEAM_LEAD') &&
      (await this.permissions.roleHasPermission(
        payload.activeRoleId,
        'dn.priority.set',
      ));
    const hasRushPermission =
      (role.code === 'SYSTEM' ||
        (SUPERVISING_ROLES as readonly string[]).includes(role.code)) &&
      (await this.permissions.roleHasPermission(
        payload.activeRoleId,
        'dn.rush.set',
      ));
    const canMarkRush =
      hasRushPermission &&
      deliveryNoteEligibleForRush(dn.current_status, dn.is_open);
    const canClearRush = hasRushPermission && dn.is_rushed;

    const [packingCombinePeers, activePackSession, completedPackSessions] =
      await this.loadPackExtrasForDetail(id);

    const serialized = this.serializeDeliveryNote(dn);
    const carrierAccounts =
      dn.customer?.customer_carrier_accounts?.map((a) => ({
        carrier_code: a.carrier_code,
        account_number: a.account_number,
      })) ?? [];
    const matched_carrier_accounts = filterCarrierAccountsForShippingType(
      carrierAccounts,
      dn.shipping_type,
    );

    const latestShipmentRow = await this.prisma.shipment.findFirst({
      where: { delivery_note_id: id },
      orderBy: { created_at: 'desc' },
      select: {
        tracking_number: true,
        invoice_number: true,
        ship_date: true,
        carrier_code: true,
        shipper: {
          select: { id: true, email: true, display_name: true },
        },
      },
    });

    const latestPackSession = completedPackSessions[0] ?? null;
    const workflowHandoff = this.buildWorkflowHandoff({
      statusHistory: dn.status_history as WorkflowStatusHistoryRow[],
      pickingStartedBy: dn.picking_started_by,
      packCreator: latestPackSession?.packed_by ?? null,
      shipper: latestShipmentRow?.shipper ?? null,
    });

    const shippingGroupNotes = dn.shipping_group_id
      ? await this.prisma.deliveryNote.findMany({
          where: { shipping_group_id: dn.shipping_group_id },
          select: { id: true, dn_number: true },
          orderBy: { dn_number: 'asc' },
        })
      : [];

    return {
      ...serialized,
      customer_email: dn.customer?.default_email?.trim() || null,
      fed_id_number: dn.customer?.fed_id_number?.trim() || null,
      matched_carrier_accounts,
      allowedNextStatuses,
      canSetPriority,
      canMarkRush,
      canClearRush,
      packing_combine_peers: packingCombinePeers,
      active_pack_session: activePackSession,
      completed_pack_sessions: completedPackSessions,
      shipping_group_notes: shippingGroupNotes,
      latest_shipment: latestShipmentRow
        ? {
            tracking_number: latestShipmentRow.tracking_number?.trim() || null,
            invoice_number: latestShipmentRow.invoice_number?.trim() || null,
            ship_date: latestShipmentRow.ship_date.toISOString().slice(0, 10),
            carrier_code: latestShipmentRow.carrier_code,
            shipped_by: latestShipmentRow.shipper
              ? this.serializeWorkflowActor(latestShipmentRow.shipper)
              : null,
          }
        : null,
      workflow_handoff: workflowHandoff,
    };
  }

  async transition(
    id: string,
    toStatus: dn_status,
    payload: JwtPayload,
    message?: string,
    trackingNumber?: string,
    confirmDoubleClaim?: boolean,
    shipTogetherIds?: string[],
    invoiceNumbers?: { deliveryNoteId: string; invoiceNumber: string }[],
  ) {
    // Warn if the shipper already has another note in SHIPPING_IN_PROGRESS.
    if (toStatus === dn_status.SHIPPING_IN_PROGRESS && !confirmDoubleClaim) {
      const inProgress = await this.prisma.deliveryNote.findFirst({
        where: {
          shipping_started_by_user_id: payload.sub,
          current_status: dn_status.SHIPPING_IN_PROGRESS,
          id: { not: id },
        },
        select: { id: true, dn_number: true },
      });
      if (inProgress) {
        return {
          requiresConfirmation: true,
          warning: `You are already shipping ${inProgress.dn_number}. Start shipping this note too?`,
          inProgressNote: inProgress,
        };
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await this.applyShipGroupTransition(
        tx,
        id,
        toStatus,
        payload,
        message,
        trackingNumber,
        {
          shipTogetherIds,
          invoiceNumbers,
        },
      );
    });

    return this.findOne(id, payload);
  }

  /**
   * Shipper transitions that move every DN in the shipment group together (same
   * physical shipment). The group is the anchor's pack-session mates plus any
   * PACKED peers the shipper picked (same customer / ship-to / ship method),
   * recorded on delivery_notes.shipping_group_id when shipping starts.
   * Marking shipped records one tracking number on each member's shipment row
   * plus one required invoice number per delivery note.
   */
  private async applyShipGroupTransition(
    tx: Prisma.TransactionClient,
    anchorId: string,
    toStatus: dn_status,
    payload: JwtPayload,
    message?: string,
    trackingNumber?: string,
    options?: {
      shipTogetherIds?: string[];
      invoiceNumbers?: { deliveryNoteId: string; invoiceNumber: string }[];
    },
  ): Promise<void> {
    const anchor = await tx.deliveryNote.findUnique({
      where: { id: anchorId },
    });
    if (!anchor) {
      throw new NotFoundException('Delivery note not found');
    }

    const from = anchor.current_status;
    const isStartShipping =
      from === dn_status.PACKED && toStatus === dn_status.SHIPPING_IN_PROGRESS;
    const isMarkShipped =
      from === dn_status.SHIPPING_IN_PROGRESS && toStatus === dn_status.SHIPPED;
    const isReturnToPacked =
      from === dn_status.SHIPPING_IN_PROGRESS && toStatus === dn_status.PACKED;

    if (!isStartShipping && !isMarkShipped && !isReturnToPacked) {
      await this.applyTransition(tx, anchorId, toStatus, payload, message);
      return;
    }

    const packSession = await this.findLatestCompletedPackSessionForNote(
      tx,
      anchorId,
    );
    const sessionMemberIds =
      packSession && packSession.memberIds.length > 0
        ? packSession.memberIds
        : [anchorId];

    let memberIds: string[];
    if (isStartShipping) {
      const picked = await this.validateShipTogetherPeers(
        tx,
        anchor,
        sessionMemberIds,
        options?.shipTogetherIds ?? [],
      );
      memberIds = [...new Set([...sessionMemberIds, ...picked])];
      if (memberIds.length > 100) {
        throw new BadRequestException(
          'Too many delivery notes per shipment (max 100).',
        );
      }
    } else if (anchor.shipping_group_id) {
      const grouped = await tx.deliveryNote.findMany({
        where: { shipping_group_id: anchor.shipping_group_id },
        select: { id: true },
      });
      memberIds =
        grouped.length > 0 ? grouped.map((g) => g.id) : sessionMemberIds;
      if (!memberIds.includes(anchorId)) {
        memberIds = [...memberIds, anchorId];
      }
    } else {
      memberIds = sessionMemberIds;
    }

    const invoiceByNoteId = new Map<string, string>();
    if (isMarkShipped) {
      const tracking = trackingNumber?.trim();
      if (!tracking) {
        throw new BadRequestException(
          'Tracking number is required to mark shipped.',
        );
      }
      if (tracking.length > 80) {
        throw new BadRequestException(
          'Tracking number is too long (max 80 characters).',
        );
      }
      for (const entry of options?.invoiceNumbers ?? []) {
        const num = entry.invoiceNumber?.trim();
        if (!num) {
          throw new BadRequestException(
            'Each delivery note needs an invoice number.',
          );
        }
        if (num.length > 80) {
          throw new BadRequestException(
            'Invoice number is too long (max 80 characters).',
          );
        }
        invoiceByNoteId.set(entry.deliveryNoteId, num);
      }
      const missing = memberIds.filter((id) => !invoiceByNoteId.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          'An invoice number is required for each delivery note in the shipment.',
        );
      }
    }

    const members = await tx.deliveryNote.findMany({
      where: { id: { in: memberIds } },
      include: {
        customer: {
          select: {
            customer_carrier_accounts: {
              where: { is_active: true },
              select: { carrier_code: true, account_number: true },
            },
          },
        },
      },
    });
    if (members.length !== memberIds.length) {
      throw new BadRequestException(
        'One or more delivery notes in this shipment were not found',
      );
    }

    const requiredStatus = isStartShipping
      ? dn_status.PACKED
      : dn_status.SHIPPING_IN_PROGRESS;

    for (const m of members) {
      if (m.current_status !== requiredStatus) {
        throw new BadRequestException(
          `All delivery notes in this shipment must be ${requiredStatus} (${m.dn_number} is ${m.current_status}).`,
        );
      }
    }

    if (isStartShipping) {
      // Record the chosen group so "mark shipped" moves exactly these notes.
      await tx.deliveryNote.updateMany({
        where: { id: { in: memberIds } },
        data: { shipping_group_id: randomUUID() },
      });
    }

    const shipMsg =
      message?.trim() ||
      (packSession
        ? `packSession:${packSession.id};ship:${toStatus}`
        : undefined);

    for (const m of members) {
      await this.applyTransition(tx, m.id, toStatus, payload, shipMsg);
    }

    if (isReturnToPacked) {
      // Shipping was abandoned: dissolve the group.
      await tx.deliveryNote.updateMany({
        where: { id: { in: memberIds } },
        data: { shipping_group_id: null },
      });
      return;
    }

    if (!isMarkShipped) return;

    const tracking = trackingNumber!.trim();
    for (const m of members) {
      const existing = await tx.shipment.findFirst({
        where: { delivery_note_id: m.id },
      });
      if (existing) {
        throw new BadRequestException(
          `Shipment already recorded for ${m.dn_number}.`,
        );
      }

      const accounts = filterCarrierAccountsForShippingType(
        m.customer?.customer_carrier_accounts ?? [],
        m.shipping_type,
      );
      const collectAccount = accounts[0]?.account_number?.trim() || null;

      await tx.shipment.create({
        data: {
          id: randomUUID(),
          delivery_note_id: m.id,
          carrier_code: inferCarrierCodeFromShippingType(m.shipping_type),
          payment_method: collectAccount ? 'COLLECT' : 'SENDER',
          collect_account_number: collectAccount,
          tracking_number: tracking,
          invoice_number: invoiceByNoteId.get(m.id) ?? null,
          ship_date: new Date(),
          shipper_user_id: payload.sub,
          service_level: m.shipping_type?.trim() || null,
        },
      });
    }
  }

  /**
   * Validates shipper-picked peers for group shipping: each must be PACKED and
   * share the anchor's customer, ship-to, and ship method. Returns the picked
   * ids (deduped, excluding the anchor and pack-session mates).
   */
  private async validateShipTogetherPeers(
    tx: Prisma.TransactionClient,
    anchor: {
      id: string;
      sold_to_code: string | null;
      ship_to_code: string | null;
      ship_to_location_id: string | null;
      shipping_type: string | null;
    },
    sessionMemberIds: string[],
    peerIds: string[],
  ): Promise<string[]> {
    const unique = [...new Set(peerIds)].filter(
      (id) => id !== anchor.id && !sessionMemberIds.includes(id),
    );
    if (unique.length === 0) {
      return [];
    }
    const peers = await tx.deliveryNote.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        dn_number: true,
        current_status: true,
        sold_to_code: true,
        ship_to_code: true,
        ship_to_location_id: true,
        shipping_type: true,
      },
    });
    if (peers.length !== unique.length) {
      throw new BadRequestException(
        'One or more selected delivery notes were not found.',
      );
    }
    const sameGroup = (p: (typeof peers)[number]) => sameShipGroup(p, anchor);
    for (const p of peers) {
      if (p.current_status !== dn_status.PACKED) {
        throw new BadRequestException(
          `${p.dn_number} is ${p.current_status} — only PACKED delivery notes can be shipped together.`,
        );
      }
      if (!sameGroup(p)) {
        throw new BadRequestException(
          `${p.dn_number} has a different customer, ship-to, or ship method and cannot ship with this note.`,
        );
      }
    }
    return unique;
  }

  /**
   * Options for the start-shipping picker: notes packed together with the
   * anchor (auto-included), other PACKED notes shippable together (pickable),
   * and notes for the same customer / ship-to / ship method that are not
   * packed yet (the "wait or ship now" notice).
   */
  async getShipGroupOptions(anchorId: string) {
    const anchor = await this.prisma.deliveryNote.findUnique({
      where: { id: anchorId },
      select: { id: true, current_status: true },
    });
    if (!anchor) {
      throw new NotFoundException('Delivery note not found');
    }
    if (anchor.current_status !== dn_status.PACKED) {
      throw new BadRequestException(
        'Group shipping options are only available for PACKED delivery notes.',
      );
    }

    const packSession = await this.findLatestCompletedPackSessionForNote(
      this.prisma,
      anchorId,
    );
    const sessionIds = new Set(
      packSession && packSession.memberIds.length > 0
        ? packSession.memberIds
        : [anchorId],
    );
    const sessionNotes =
      sessionIds.size > 0
        ? await this.prisma.deliveryNote.findMany({
            where: { id: { in: [...sessionIds] } },
            select: { id: true, dn_number: true, current_status: true },
            orderBy: { dn_number: 'asc' },
          })
        : [];

    const peers = (await this.listShipTogetherPeers(anchorId)).items;
    const { pickable, notPacked } = splitShipGroupOptions(peers, sessionIds);

    return {
      auto: sessionNotes.map((n) => ({
        id: n.id,
        dn_number: n.dn_number,
        current_status: n.current_status as string,
      })),
      pickable: pickable.map((p) => ({
        id: p.id,
        dn_number: p.dn_number,
        current_status: p.current_status,
      })),
      notPacked: notPacked.map((p) => ({
        id: p.id,
        dn_number: p.dn_number,
        current_status: p.current_status,
      })),
    };
  }

  /**
   * Members of the anchor's shipping group for the mark-shipped dialog:
   * notes sharing its shipping_group_id and still SHIPPING_IN_PROGRESS
   * (falls back to the pack session for shipments started before grouping).
   */
  async getShippingGroupMembers(anchorId: string) {
    const anchor = await this.prisma.deliveryNote.findUnique({
      where: { id: anchorId },
      select: {
        id: true,
        dn_number: true,
        current_status: true,
        shipping_group_id: true,
      },
    });
    if (!anchor) {
      throw new NotFoundException('Delivery note not found');
    }

    let members: { id: string; dn_number: string }[];
    if (anchor.shipping_group_id) {
      members = await this.prisma.deliveryNote.findMany({
        where: {
          shipping_group_id: anchor.shipping_group_id,
          current_status: dn_status.SHIPPING_IN_PROGRESS,
        },
        select: { id: true, dn_number: true },
        orderBy: { dn_number: 'asc' },
      });
    } else {
      const packSession = await this.findLatestCompletedPackSessionForNote(
        this.prisma,
        anchorId,
      );
      const ids =
        packSession && packSession.memberIds.length > 0
          ? packSession.memberIds
          : [anchorId];
      members = await this.prisma.deliveryNote.findMany({
        where: {
          id: { in: ids },
          current_status: dn_status.SHIPPING_IN_PROGRESS,
        },
        select: { id: true, dn_number: true },
        orderBy: { dn_number: 'asc' },
      });
    }
    if (!members.some((m) => m.id === anchorId)) {
      members = [
        ...members,
        { id: anchor.id, dn_number: anchor.dn_number },
      ].sort((a, b) => a.dn_number.localeCompare(b.dn_number));
    }
    return { members };
  }

  async bulkTransition(
    ids: string[],
    toStatus: dn_status,
    payload: JwtPayload,
    message?: string,
  ) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      throw new BadRequestException(
        'At least one delivery note id is required',
      );
    }
    if (unique.length > 100) {
      throw new BadRequestException(
        'Too many delivery notes per request (max 100)',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const id of unique) {
        await this.applyTransition(tx, id, toStatus, payload, message);
      }
    });

    return { processed: unique.length };
  }

  private async findLatestCompletedPackSessionForNote(
    tx: Prisma.TransactionClient,
    deliveryNoteId: string,
  ): Promise<{
    id: string;
    memberIds: string[];
    completed_at: Date;
  } | null> {
    const rows = await tx.packSession.findMany({
      where: {
        completed_at: { not: null },
        delivery_notes: { some: { delivery_note_id: deliveryNoteId } },
      },
      orderBy: { completed_at: 'desc' },
      take: 1,
      select: {
        id: true,
        completed_at: true,
        delivery_notes: { select: { delivery_note_id: true } },
      },
    });
    const s = rows[0];
    if (!s?.completed_at) return null;
    return {
      id: s.id,
      memberIds: s.delivery_notes.map((m) => m.delivery_note_id),
      completed_at: s.completed_at,
    };
  }

  private async findOpenPackSessionForNote(
    tx: Prisma.TransactionClient,
    deliveryNoteId: string,
  ): Promise<{ id: string; memberIds: string[] } | null> {
    const link = await tx.packSessionDeliveryNote.findFirst({
      where: {
        delivery_note_id: deliveryNoteId,
        pack_session: { completed_at: null },
      },
      select: {
        pack_session: {
          select: {
            id: true,
            delivery_notes: { select: { delivery_note_id: true } },
          },
        },
      },
    });
    if (!link) return null;
    return {
      id: link.pack_session.id,
      memberIds: link.pack_session.delivery_notes.map(
        (m) => m.delivery_note_id,
      ),
    };
  }

  private async assertDnsStatuses(
    tx: Prisma.TransactionClient,
    ids: string[],
    expected: dn_status,
  ): Promise<void> {
    const dns = await tx.deliveryNote.findMany({
      where: { id: { in: ids } },
      select: { id: true, dn_number: true, current_status: true },
    });
    const byId = new Map(dns.map((d) => [d.id, d]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        throw new NotFoundException('Delivery note not found');
      }
      if (row.current_status !== expected) {
        throw new BadRequestException(
          `Pack session member ${row.dn_number} is ${row.current_status}; expected ${expected} for this operation`,
        );
      }
    }
  }

  private async revertCompletedPackSessionToPacking(
    tx: Prisma.TransactionClient,
    anchorDeliveryNoteId: string,
    payload: JwtPayload,
    message?: string,
  ): Promise<void> {
    const session = await this.findLatestCompletedPackSessionForNote(
      tx,
      anchorDeliveryNoteId,
    );
    if (!session) {
      throw new BadRequestException(
        'No completed pack session found for this delivery note',
      );
    }
    await this.assertDnsStatuses(tx, session.memberIds, dn_status.PACKED);
    await tx.packBox.deleteMany({ where: { pack_session_id: session.id } });
    await tx.packSession.update({
      where: { id: session.id },
      data: { completed_at: null },
    });
    for (const memberId of session.memberIds) {
      await this.persistDnStatusChange(
        tx,
        memberId,
        dn_status.PACKED,
        dn_status.PACKING,
        payload,
        message,
      );
    }
  }

  private async revertCompletedPackSessionToPicked(
    tx: Prisma.TransactionClient,
    anchorDeliveryNoteId: string,
    payload: JwtPayload,
    message?: string,
  ): Promise<void> {
    const session = await this.findLatestCompletedPackSessionForNote(
      tx,
      anchorDeliveryNoteId,
    );
    if (!session) {
      throw new BadRequestException(
        'No completed pack session found for this delivery note',
      );
    }
    await this.assertDnsStatuses(tx, session.memberIds, dn_status.PACKED);
    await tx.packSession.delete({ where: { id: session.id } });
    for (const memberId of session.memberIds) {
      await this.persistDnStatusChange(
        tx,
        memberId,
        dn_status.PACKED,
        dn_status.PICKED,
        payload,
        message,
      );
    }
  }

  private async revertOpenPackSessionToPicked(
    tx: Prisma.TransactionClient,
    anchorDeliveryNoteId: string,
    payload: JwtPayload,
    message?: string,
  ): Promise<void> {
    const session = await this.findOpenPackSessionForNote(
      tx,
      anchorDeliveryNoteId,
    );
    if (!session) {
      throw new BadRequestException(
        'No open pack session found for this delivery note',
      );
    }
    await this.assertDnsStatuses(tx, session.memberIds, dn_status.PACKING);
    await tx.packSession.delete({ where: { id: session.id } });
    for (const memberId of session.memberIds) {
      await this.persistDnStatusChange(
        tx,
        memberId,
        dn_status.PACKING,
        dn_status.PICKED,
        payload,
        message,
      );
    }
  }

  private async persistDnStatusChange(
    tx: Prisma.TransactionClient,
    dnId: string,
    fromStatus: dn_status,
    toStatus: dn_status,
    payload: JwtPayload,
    message?: string,
  ): Promise<void> {
    const dn = await tx.deliveryNote.findUnique({ where: { id: dnId } });
    if (!dn) {
      throw new NotFoundException('Delivery note not found');
    }
    if (dn.current_status !== fromStatus) {
      throw new BadRequestException(
        `Cannot transition delivery note: expected status ${fromStatus}, found ${dn.current_status}`,
      );
    }
    const isOpen =
      toStatus === dn_status.SHIPPED || toStatus === dn_status.CANCELLED
        ? false
        : dn.is_open;
    const pickingUpdate = this.pickingClaimUpdate(
      fromStatus,
      toStatus,
      payload.sub,
    );
    const packingUpdate = this.packingClaimUpdate(
      fromStatus,
      toStatus,
      payload.sub,
    );
    const shippingUpdate = this.shippingClaimUpdate(
      fromStatus,
      toStatus,
      payload.sub,
    );
    // On-hold: remember where the note was so it can resume there.
    const onHoldUpdate =
      toStatus === dn_status.ON_HOLD
        ? { on_hold_from_status: fromStatus }
        : fromStatus === dn_status.ON_HOLD
          ? { on_hold_from_status: null }
          : {};
    await tx.deliveryNote.update({
      where: { id: dnId },
      data: {
        current_status: toStatus,
        is_open: isOpen,
        ...pickingUpdate,
        ...packingUpdate,
        ...shippingUpdate,
        ...onHoldUpdate,
      },
    });
    await tx.dnStatusHistory.create({
      data: {
        delivery_note_id: dnId,
        from_status: fromStatus,
        to_status: toStatus,
        message: message?.trim() || null,
        actor_user_id: payload.sub,
        actor_role_id: payload.activeRoleId,
        source: 'MANUAL',
      },
    });
  }

  private async applyTransition(
    tx: Prisma.TransactionClient,
    id: string,
    toStatus: dn_status,
    payload: JwtPayload,
    message?: string,
    opts?: { allowPackTransitions?: boolean },
  ): Promise<void> {
    const dn = await tx.deliveryNote.findUnique({
      where: { id },
    });
    if (!dn) {
      throw new NotFoundException('Delivery note not found');
    }

    const from = dn.current_status;
    if (from === toStatus) {
      return;
    }

    const meta = getTransitionMeta(from, toStatus);
    if (!meta) {
      throw new BadRequestException(
        `Invalid status transition: ${from} → ${toStatus}`,
      );
    }

    if (
      !opts?.allowPackTransitions &&
      ((from === dn_status.PICKED && toStatus === dn_status.PACKING) ||
        (from === dn_status.PACKING && toStatus === dn_status.PACKED))
    ) {
      throw new BadRequestException(
        'Use POST /delivery-notes/:id/pack/start to begin packing, or POST /delivery-notes/:id/pack/complete with box dimensions to mark packed.',
      );
    }

    const role = await this.getActiveRole(payload);
    // Flexible permissions: check ALL roles assigned to the user, not just
    // the active one. The active role only controls which view is shown.
    const hasAccess = await this.userHasTransitionAccess(
      payload.sub,
      meta.allowedRoles,
      meta.permission,
    );
    if (!hasAccess) {
      throw new ForbiddenException(
        `Role ${role.code} cannot perform this transition`,
      );
    }

    if (from === dn_status.PICKING && toStatus === dn_status.PICKED) {
      const claim = dn.picking_started_by_user_id;
      if (claim !== null && claim !== payload.sub) {
        throw new ForbiddenException(
          'Only the picker who started this pick can mark it picked',
        );
      }
    }

    if (from === dn_status.PACKED && toStatus === dn_status.PACKING) {
      const blocked = this.packerRevertBlockedByShipping(from, toStatus);
      if (blocked) throw new BadRequestException(blocked);
      await this.revertCompletedPackSessionToPacking(tx, id, payload, message);
      return;
    }

    if (from === dn_status.PACKED && toStatus === dn_status.PICKED) {
      const blocked = this.packerRevertBlockedByShipping(from, toStatus);
      if (blocked) throw new BadRequestException(blocked);
      await this.revertCompletedPackSessionToPicked(tx, id, payload, message);
      return;
    }

    if (from === dn_status.PACKING && toStatus === dn_status.PICKED) {
      const blocked = this.packerRevertBlockedByShipping(from, toStatus);
      if (blocked) throw new BadRequestException(blocked);
      await this.revertOpenPackSessionToPicked(tx, id, payload, message);
      return;
    }

    await this.persistDnStatusChange(tx, id, from, toStatus, payload, message);
  }

  private packerRevertBlockedByShipping(
    from: dn_status,
    toStatus: dn_status,
  ): string | null {
    const toPickOrPack =
      toStatus === dn_status.PICKED || toStatus === dn_status.PACKING;
    if (!toPickOrPack) return null;

    if (from === dn_status.SHIPPING_IN_PROGRESS || from === dn_status.SHIPPED) {
      return 'Cannot return to picking or packing after shipping has started.';
    }

    return null;
  }

  private pickingClaimUpdate(
    from: dn_status,
    to: dn_status,
    userId: string,
  ): { picking_started_by_user_id: string | null } | Record<string, never> {
    if (to === dn_status.PICKING) {
      return { picking_started_by_user_id: userId };
    }
    if (from === dn_status.PICKING) {
      return { picking_started_by_user_id: null };
    }
    return {};
  }

  private packingClaimUpdate(
    from: dn_status,
    to: dn_status,
    userId: string,
  ): { packing_started_by_user_id: string | null } | Record<string, never> {
    if (to === dn_status.PACKING) {
      return { packing_started_by_user_id: userId };
    }
    if (from === dn_status.PACKING) {
      return { packing_started_by_user_id: null };
    }
    return {};
  }

  private shippingClaimUpdate(
    from: dn_status,
    to: dn_status,
    userId: string,
  ): { shipping_started_by_user_id: string | null } | Record<string, never> {
    if (to === dn_status.SHIPPING_IN_PROGRESS) {
      return { shipping_started_by_user_id: userId };
    }
    if (from === dn_status.SHIPPING_IN_PROGRESS) {
      return { shipping_started_by_user_id: null };
    }
    return {};
  }

  async setPriority(
    id: string,
    toPriorityNo: number,
    reason: string,
    payload: JwtPayload,
  ) {
    const dn = await this.prisma.deliveryNote.findUnique({ where: { id } });
    if (!dn) {
      throw new NotFoundException('Delivery note not found');
    }

    const role = await this.getActiveRole(payload);
    if (role.code !== 'SUPERVISOR' && role.code !== 'TEAM_LEAD') {
      throw new ForbiddenException(
        'Only supervisors and team leads can set priority',
      );
    }
    const ok = await this.permissions.roleHasPermission(
      payload.activeRoleId,
      'dn.priority.set',
    );
    if (!ok) {
      throw new ForbiddenException('Missing permission: dn.priority.set');
    }

    if (toPriorityNo === dn.current_priority_no) {
      throw new BadRequestException('Priority unchanged');
    }

    await this.prisma.$transaction([
      this.prisma.deliveryNote.update({
        where: { id },
        data: { current_priority_no: toPriorityNo },
      }),
      this.prisma.dnPriorityHistory.create({
        data: {
          delivery_note_id: id,
          from_priority_no: dn.current_priority_no,
          to_priority_no: toPriorityNo,
          reason: reason.trim(),
          actor_user_id: payload.sub,
          actor_role_id: payload.activeRoleId,
          source: 'MANUAL',
        },
      }),
    ]);

    return this.findOne(id, payload);
  }

  async setRush(
    id: string,
    rushed: boolean,
    reason: string,
    payload: JwtPayload,
  ) {
    const dn = await this.prisma.deliveryNote.findUnique({ where: { id } });
    if (!dn) {
      throw new NotFoundException('Delivery note not found');
    }

    const role = await this.getActiveRole(payload);
    const canSuperviseRush =
      role.code === 'SYSTEM' ||
      (SUPERVISING_ROLES as readonly string[]).includes(role.code);
    if (!canSuperviseRush) {
      throw new ForbiddenException(
        'Only supervisors, team leads, and CSAs can set rush',
      );
    }
    const ok = await this.permissions.roleHasPermission(
      payload.activeRoleId,
      'dn.rush.set',
    );
    if (!ok) {
      throw new ForbiddenException('Missing permission: dn.rush.set');
    }

    if (rushed === dn.is_rushed) {
      throw new BadRequestException(
        rushed
          ? 'Delivery note is already rushed'
          : 'Delivery note is not rushed',
      );
    }

    if (rushed && !deliveryNoteEligibleForRush(dn.current_status, dn.is_open)) {
      throw new BadRequestException(
        rushMarkBlockedMessage(dn.current_status, dn.is_open),
      );
    }

    await this.prisma.$transaction([
      this.prisma.deliveryNote.update({
        where: { id },
        data: {
          is_rushed: rushed,
          latest_rush_reason: rushed ? reason.trim() : null,
        },
      }),
      this.prisma.dnRushHistory.create({
        data: {
          delivery_note_id: id,
          from_rushed: dn.is_rushed,
          to_rushed: rushed,
          reason: reason.trim(),
          actor_user_id: payload.sub,
          actor_role_id: payload.activeRoleId,
          source: 'MANUAL',
        },
      }),
    ]);

    return this.findOne(id, payload);
  }

  // ---------------------------------------------------------------------------
  // Manual delivery note creation (supervisor / team lead / CSA screen).
  // ---------------------------------------------------------------------------

  /**
   * "Today's priority": the priority assigned to today's most recent daily-DN
   * import batch. Falls back to max+1 over open notes (what today's import
   * would assign) when no import has run today yet.
   */
  private async resolveTodayPriority(): Promise<number> {
    const { startUtc, endUtc } = getVancouverDayBoundsUtc();
    const batch = await this.prisma.importBatch.findFirst({
      where: {
        source_type: source_type.DAILY_DN,
        status: { in: [batch_status.SUCCESS, batch_status.PARTIAL] },
        started_at: { gte: startUtc, lt: endUtc },
      },
      orderBy: { started_at: 'desc' },
      select: { id: true },
    });
    if (batch) {
      const note = await this.prisma.deliveryNote.findFirst({
        where: {
          created_by_import_batch_id: batch.id,
          current_priority_no: { not: null },
        },
        select: { current_priority_no: true },
      });
      if (note?.current_priority_no != null) return note.current_priority_no;
    }
    const agg = await this.prisma.deliveryNote.aggregate({
      where: { is_open: true, current_priority_no: { not: null } },
      _max: { current_priority_no: true },
    });
    const maxP = agg._max.current_priority_no;
    return maxP == null || maxP < 1 ? 1 : maxP + 1;
  }

  private normalizePartyCode(code: string): string {
    return code.trim().toUpperCase().slice(0, 30);
  }

  /**
   * Resolve the customer + ship-to for a manual DN: use the existing records,
   * or create them inline from the form's new_customer / new_ship_to blocks.
   */
  private async resolveManualParties(
    tx: Prisma.TransactionClient,
    dto: CreateDeliveryNoteDto,
  ) {
    const hasCustomerId = !!dto.customer_id;
    const hasNewCustomer = !!dto.new_customer;
    if (hasCustomerId === hasNewCustomer) {
      throw new BadRequestException(
        'Choose an existing customer or enter a new one (not both).',
      );
    }
    const hasShipToId = !!dto.ship_to_location_id;
    const hasNewShipTo = !!dto.new_ship_to;
    if (hasShipToId === hasNewShipTo) {
      throw new BadRequestException(
        'Choose an existing ship-to or enter a new one (not both).',
      );
    }

    let customer;
    if (dto.customer_id) {
      customer = await tx.customer.findUnique({
        where: { id: dto.customer_id },
      });
      if (!customer) throw new NotFoundException('Customer not found');
    } else {
      const nc = dto.new_customer!;
      const soldToCode = this.normalizePartyCode(nc.sold_to_code);
      if (!soldToCode) {
        throw new BadRequestException('New customer code is required');
      }
      const dupe = await tx.customer.findUnique({
        where: { sold_to_code: soldToCode },
      });
      if (dupe) {
        throw new ConflictException(
          `Customer code ${soldToCode} already exists — pick it from the list instead.`,
        );
      }
      customer = await tx.customer.create({
        data: {
          sold_to_code: soldToCode,
          sold_to_name: nc.sold_to_name.trim(),
          default_contact_name: nc.default_contact_name?.trim() || null,
          default_phone: nc.default_phone?.trim() || null,
          default_email: nc.default_email?.trim() || null,
        },
      });
    }

    let shipTo;
    if (dto.ship_to_location_id) {
      shipTo = await tx.shipToLocation.findUnique({
        where: { id: dto.ship_to_location_id },
      });
      if (!shipTo || shipTo.customer_id !== customer.id) {
        throw new BadRequestException(
          'Ship-to location does not belong to the selected customer.',
        );
      }
    } else {
      const ns = dto.new_ship_to!;
      const shipToCode = this.normalizePartyCode(ns.ship_to_code);
      if (!shipToCode) {
        throw new BadRequestException('New ship-to code is required');
      }
      const dupe = await tx.shipToLocation.findUnique({
        where: {
          customer_id_ship_to_code: {
            customer_id: customer.id,
            ship_to_code: shipToCode,
          },
        },
      });
      if (dupe) {
        throw new ConflictException(
          `Ship-to code ${shipToCode} already exists for this customer — pick it from the list instead.`,
        );
      }
      shipTo = await tx.shipToLocation.create({
        data: {
          customer_id: customer.id,
          ship_to_code: shipToCode,
          ship_to_name: ns.ship_to_name.trim(),
          street1: ns.street1?.trim() || null,
          street2: ns.street2?.trim() || null,
          city: ns.city?.trim() || null,
          state_region: ns.state_region?.trim() || null,
          postal_code: ns.postal_code?.trim() || null,
          country_code: ns.country_code?.trim() || null,
          contact_name: ns.contact_name?.trim() || null,
          phone: ns.phone?.trim() || null,
        },
      });
    }
    return { customer, shipTo };
  }

  private async assertManualRushAllowed(
    payload: JwtPayload,
    rushed: boolean,
  ): Promise<void> {
    if (!rushed) return;
    const ok = await this.permissions.roleHasPermission(
      payload.activeRoleId,
      'dn.rush.set',
    );
    if (!ok) {
      throw new ForbiddenException('Missing permission: dn.rush.set');
    }
  }

  private async resolveManualPriority(
    payload: JwtPayload,
    priorityNo: number | undefined,
  ): Promise<number> {
    if (priorityNo == null) return this.resolveTodayPriority();
    const ok = await this.permissions.roleHasPermission(
      payload.activeRoleId,
      'dn.priority.set',
    );
    if (!ok) {
      throw new ForbiddenException('Missing permission: dn.priority.set');
    }
    return priorityNo;
  }

  private manualLineRows(deliveryNoteId: string, dto: CreateDeliveryNoteDto) {
    return dto.lines.map((l, i) => {
      const qty = l.order_qty;
      const price = l.unit_price ?? 0;
      return {
        delivery_note_id: deliveryNoteId,
        doc_item: i + 1,
        so_number: l.so_number?.trim() || null,
        material_code: l.material_code.trim(),
        material_description: l.material_description?.trim() || null,
        order_qty: qty,
        open_qty: qty,
        // Nothing has shipped on a manually created NEW note; the import
        // fills this from the Excel "Shipped QTY" column instead.
        shipped_qty: 0,
        unit_price: price,
        line_amount: qty * price,
      };
    });
  }

  private toDateOrNull(value: string | undefined): Date | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid date: ${value}`);
    }
    return d;
  }

  async createManual(dto: CreateDeliveryNoteDto, payload: JwtPayload) {
    const dnNumber = dto.dn_number.trim();
    if (!dnNumber) {
      throw new BadRequestException('Delivery note number is required');
    }
    const dupe = await this.prisma.deliveryNote.findUnique({
      where: { dn_number: dnNumber },
    });
    if (dupe) {
      throw new ConflictException(`Delivery note ${dnNumber} already exists.`);
    }
    if (!dto.lines?.length) {
      throw new BadRequestException('At least one line item is required');
    }
    await this.assertManualRushAllowed(payload, !!dto.is_rushed);
    const priorityNo = await this.resolveManualPriority(
      payload,
      dto.priority_no,
    );
    const rushReason = dto.rush_reason?.trim() || null;

    const created = await this.prisma.$transaction(async (tx) => {
      const { customer, shipTo } = await this.resolveManualParties(tx, dto);
      const dn = await tx.deliveryNote.create({
        data: {
          dn_number: dnNumber,
          sold_to_code: customer.sold_to_code,
          ship_to_code: shipTo.ship_to_code,
          customer_id: customer.id,
          ship_to_location_id: shipTo.id,
          // Manual notes belong to no import batch; revert only removes notes
          // whose created_by_import_batch_id matches the reverted batch.
          last_seen_import_batch_id: null,
          created_by_import_batch_id: null,
          current_status: dn_status.NEW,
          current_priority_no: priorityNo,
          is_rushed: !!dto.is_rushed,
          latest_rush_reason: dto.is_rushed ? rushReason : null,
          is_open: true,
          currency_code: dto.currency_code?.trim() || 'CAD',
          customer_po: dto.customer_po?.trim() || null,
          po_date: this.toDateOrNull(dto.po_date),
          requested_delivery_date: this.toDateOrNull(
            dto.requested_delivery_date,
          ),
          shipping_type: dto.shipping_type.trim() || null,
          charging_method: parseChargingMethod(dto.charging_method),
          dn_create_date: new Date(),
        },
        select: { id: true, is_rushed: true },
      });
      for (const row of this.manualLineRows(dn.id, dto)) {
        await tx.deliveryNoteLine.create({ data: row });
      }
      await this.ensureProductsForLines(tx, dto.lines);
      await tx.dnStatusHistory.create({
        data: {
          delivery_note_id: dn.id,
          from_status: null,
          to_status: dn_status.NEW,
          message: 'Created manually',
          actor_user_id: payload.sub,
          actor_role_id: payload.activeRoleId,
          source: 'MANUAL',
        },
      });
      if (dto.is_rushed) {
        await tx.dnRushHistory.create({
          data: {
            delivery_note_id: dn.id,
            from_rushed: false,
            to_rushed: true,
            reason: rushReason ?? 'Marked rush on creation',
            actor_user_id: payload.sub,
            actor_role_id: payload.activeRoleId,
            source: 'MANUAL',
          },
        });
      }
      return dn;
    });

    return this.findOne(created.id, payload);
  }

  /**
   * Edit a manually created note while it is still NEW. Imported notes are
   * refreshed by the daily import instead; anything past NEW is locked.
   */
  async updateManual(
    id: string,
    dto: CreateDeliveryNoteDto,
    payload: JwtPayload,
  ) {
    const dn = await this.prisma.deliveryNote.findUnique({ where: { id } });
    if (!dn) {
      throw new NotFoundException('Delivery note not found');
    }
    if (dn.current_status !== dn_status.NEW) {
      throw new BadRequestException(
        'Only delivery notes in New can be edited.',
      );
    }
    const dnNumber = dto.dn_number.trim();
    if (!dnNumber) {
      throw new BadRequestException('Delivery note number is required');
    }
    if (dnNumber !== dn.dn_number) {
      const dupe = await this.prisma.deliveryNote.findUnique({
        where: { dn_number: dnNumber },
      });
      if (dupe) {
        throw new ConflictException(
          `Delivery note ${dnNumber} already exists.`,
        );
      }
    }
    if (!dto.lines?.length) {
      throw new BadRequestException('At least one line item is required');
    }
    await this.assertManualRushAllowed(payload, !!dto.is_rushed);
    const priorityNo =
      dto.priority_no != null
        ? await this.resolveManualPriority(payload, dto.priority_no)
        : dn.current_priority_no;
    const rushReason = dto.rush_reason?.trim() || null;
    const rushChanged = !!dto.is_rushed !== dn.is_rushed;

    await this.prisma.$transaction(async (tx) => {
      const { customer, shipTo } = await this.resolveManualParties(tx, dto);
      await tx.deliveryNote.update({
        where: { id },
        data: {
          dn_number: dnNumber,
          sold_to_code: customer.sold_to_code,
          ship_to_code: shipTo.ship_to_code,
          customer_id: customer.id,
          ship_to_location_id: shipTo.id,
          current_priority_no: priorityNo,
          is_rushed: !!dto.is_rushed,
          latest_rush_reason: dto.is_rushed ? rushReason : null,
          currency_code: dto.currency_code?.trim() || 'CAD',
          customer_po: dto.customer_po?.trim() || null,
          po_date: this.toDateOrNull(dto.po_date),
          requested_delivery_date: this.toDateOrNull(
            dto.requested_delivery_date,
          ),
          shipping_type: dto.shipping_type.trim() || null,
          charging_method: parseChargingMethod(dto.charging_method),
        },
      });
      await tx.deliveryNoteLine.deleteMany({
        where: { delivery_note_id: id },
      });
      for (const row of this.manualLineRows(id, dto)) {
        await tx.deliveryNoteLine.create({ data: row });
      }
      await this.ensureProductsForLines(tx, dto.lines);
      if (rushChanged) {
        await tx.dnRushHistory.create({
          data: {
            delivery_note_id: id,
            from_rushed: dn.is_rushed,
            to_rushed: !!dto.is_rushed,
            reason: rushReason ?? 'Rush changed on edit',
            actor_user_id: payload.sub,
            actor_role_id: payload.activeRoleId,
            source: 'MANUAL',
          },
        });
      }
    });

    return this.findOne(id, payload);
  }

  /**
   * Part auto-fill for the manual DN form: the product master first
   * (canonical description + unit price), falling back to the most recent
   * description/price used for the part number on any previous delivery note.
   */
  async suggestPart(code: string) {
    const c = code.trim();
    if (!c) return null;
    const normalized = c.toUpperCase().slice(0, 80);
    const product = await this.prisma.product.findUnique({
      where: { code: normalized },
      select: { code: true, description: true, unit_price: true },
    });
    if (product) {
      return {
        material_code: product.code,
        material_description: product.description,
        unit_price:
          product.unit_price != null ? String(product.unit_price) : null,
      };
    }
    const line = await this.prisma.deliveryNoteLine.findFirst({
      where: { material_code: { equals: c, mode: 'insensitive' } },
      orderBy: { created_at: 'desc' },
      select: {
        material_code: true,
        material_description: true,
        unit_price: true,
      },
    });
    if (!line) return null;
    return {
      material_code: line.material_code,
      material_description: line.material_description,
      unit_price: line.unit_price != null ? String(line.unit_price) : null,
    };
  }

  /**
   * Ensure every part code on a manual note exists in the product master.
   * Create-only: existing rows are never overwritten, so the canonical data
   * stays stable once seeded or curated.
   */
  private async ensureProductsForLines(
    tx: Prisma.TransactionClient,
    lines: Array<{
      material_code: string;
      material_description?: string | null;
      unit_price?: number | null;
    }>,
  ) {
    const seen = new Set<string>();
    for (const l of lines) {
      const code = l.material_code.trim().toUpperCase().slice(0, 80);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      await tx.product.upsert({
        where: { code },
        update: {},
        create: {
          code,
          description: l.material_description?.trim() || null,
          unit_price: l.unit_price ?? null,
        },
      });
    }
  }

  private async getActiveRole(payload: JwtPayload) {
    const role = await this.prisma.role.findUnique({
      where: { id: payload.activeRoleId },
    });
    if (!role) {
      throw new ForbiddenException('Active role not found');
    }
    return role;
  }

  /**
   * Flexible permission check: the user may perform the transition if ANY of
   * their assigned roles is in allowedRoles AND has the required permission.
   */
  private async userHasTransitionAccess(
    userId: string,
    allowedRoles: string[],
    permission: string,
  ): Promise<boolean> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { user_id: userId },
      include: { role: true },
    });
    for (const ur of userRoles) {
      if (!allowedRoles.includes(ur.role.code)) continue;
      const hasPerm = await this.permissions.roleHasPermission(
        ur.role_id,
        permission,
      );
      if (hasPerm) return true;
    }
    return false;
  }

  private async computeAllowedNextStatuses(
    payload: JwtPayload,
    roleCode: string,
    from: dn_status,
    pickingClaimUserId: string | null,
  ): Promise<dn_status[]> {
    const out: dn_status[] = [];
    for (const to of ALL_DN_STATUSES) {
      const meta = getTransitionMeta(from, to);
      if (!meta) continue;
      if (!meta.allowedRoles.includes(roleCode)) continue;
      if (
        from === dn_status.PICKING &&
        to === dn_status.PICKED &&
        pickingClaimUserId !== null &&
        pickingClaimUserId !== payload.sub
      ) {
        continue;
      }
      const has = await this.permissions.roleHasPermission(
        payload.activeRoleId,
        meta.permission,
      );
      if (has) out.push(to);
    }
    return out;
  }

  private serializeWorkflowActor(user: {
    id: string;
    email: string;
    display_name: string | null;
  }) {
    const display_name = user.display_name?.trim() || null;
    return {
      id: user.id,
      email: user.email,
      display_name,
    };
  }

  private buildWorkflowHandoff(input: {
    statusHistory: WorkflowStatusHistoryRow[];
    pickingStartedBy: WorkflowActorRow | null;
    packCreator: WorkflowActorRow | null;
    shipper: WorkflowActorRow | null;
  }) {
    const actorFromHistory = (toStatus: string) => {
      const row = input.statusHistory.find((h) => h.to_status === toStatus);
      return row?.actor_user
        ? this.serializeWorkflowActor(row.actor_user)
        : null;
    };

    return {
      picked_by:
        (input.pickingStartedBy
          ? this.serializeWorkflowActor(input.pickingStartedBy)
          : null) ?? actorFromHistory('PICKED'),
      packed_by:
        (input.packCreator
          ? this.serializeWorkflowActor(input.packCreator)
          : null) ?? actorFromHistory('PACKED'),
      shipped_by:
        (input.shipper ? this.serializeWorkflowActor(input.shipper) : null) ??
        actorFromHistory('SHIPPED'),
    };
  }

  private serializeDeliveryNote(dn: {
    lines: Array<Record<string, unknown>>;
    status_history: unknown[];
    priority_history: unknown[];
    customer?: { sold_to_name: string } | null;
    ship_to_location?: {
      ship_to_name: string;
      street1: string | null;
      street2: string | null;
      city: string | null;
      state_region: string | null;
      postal_code: string | null;
      country_code: string | null;
      country_name: string | null;
    } | null;
    sold_to_code?: string;
    ship_to_code?: string;
    [key: string]: unknown;
  }) {
    const {
      lines,
      status_history,
      priority_history,
      customer,
      ship_to_location,
      ...rest
    } = dn;
    const soldToCode = String(rest.sold_to_code ?? '');
    const shipToCode = String(rest.ship_to_code ?? '');
    const sold_to_name = customer?.sold_to_name?.trim() || soldToCode;
    const ship_to_name = ship_to_location?.ship_to_name?.trim() || shipToCode;
    const ship_to_location_out = ship_to_location
      ? {
          ship_to_name: ship_to_location.ship_to_name,
          street1: ship_to_location.street1,
          street2: ship_to_location.street2,
          city: ship_to_location.city,
          state_region: ship_to_location.state_region,
          postal_code: ship_to_location.postal_code,
          country_code: ship_to_location.country_code,
          country_name: ship_to_location.country_name,
        }
      : null;
    return {
      ...rest,
      sold_to_name,
      ship_to_name,
      ship_to_location: ship_to_location_out,
      lines: lines.map((line) => {
        const l = line as Record<string, unknown>;
        return {
          ...l,
          order_qty: l.order_qty != null ? String(l.order_qty) : null,
          open_qty: l.open_qty != null ? String(l.open_qty) : null,
          shipped_qty: l.shipped_qty != null ? String(l.shipped_qty) : null,
          unit_price: l.unit_price != null ? String(l.unit_price) : null,
          line_amount: l.line_amount != null ? String(l.line_amount) : null,
        };
      }),
      status_history,
      priority_history,
    };
  }
}
