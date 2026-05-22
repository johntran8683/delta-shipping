import { Injectable, Logger } from '@nestjs/common';
import {
  batch_status,
  dn_status,
  error_severity,
  source_type,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { mkdir, readFile, unlink } from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import {
  parsePriorityLabel,
  pickCell,
  pickCellExact,
  pickCurrency,
  sheetHasShipToCodeColumn,
  sheetHasSoldToCodeColumn,
  sheetHasStreetImportColumn,
  toDateOnly,
  toDecimal,
  toInt,
  toStr,
} from './excel-extract';

type RowCtx = { excelRow: number; data: Record<string, unknown> };

export type ExcelJobData = {
  batchId: string;
  filePath: string;
  actorUserId: string;
  actorRoleId: string;
};

const IMPORT_DN_CREATED_CODE = 'IMPORTED_DN_CREATED';
const IMPORT_DN_EXISTING_CODE = 'IMPORTED_DN_EXISTING';

@Injectable()
export class ExcelIngestService {
  private readonly log = new Logger(ExcelIngestService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestFromPath(job: ExcelJobData): Promise<void> {
    const { batchId, filePath, actorUserId, actorRoleId } = job;
    try {
      const buf = await readFile(filePath);
      const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
      if (!workbook.SheetNames.length) {
        throw new Error('Workbook has no sheets');
      }
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
        raw: false,
      });

      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { total_rows: json.length, summary_message: 'Processing…' },
      });

      const rowCtxs: RowCtx[] = json.map((data, i) => ({
        excelRow: i + 2,
        data,
      }));

      const sheetKeys =
        rowCtxs.length > 0 ? Object.keys(rowCtxs[0]!.data) : [];
      const sheetHasStreetColumn = sheetHasStreetImportColumn(sheetKeys);
      const hasSoldToCol = sheetHasSoldToCodeColumn(sheetKeys);
      const hasShipToCodeCol = sheetHasShipToCodeColumn(sheetKeys);

      if (!hasSoldToCol || !hasShipToCodeCol) {
        const missing: string[] = [];
        if (!hasSoldToCol) missing.push('Sold-to');
        if (!hasShipToCodeCol) missing.push('Ship-to');
        await this.prisma.importBatch.update({
          where: { id: batchId },
          data: {
            status: batch_status.FAILED,
            completed_at: new Date(),
            success_rows: 0,
            error_rows: json.length,
            summary_message: [
              `Missing required columns: ${missing.join(' and ')}.`,
              'Add SAP partner code columns named Sold-to and Ship-to (separate from Ship-to Name / Ship-to Street).',
              `Sheet "${sheetName}" has ${json.length} row(s).`,
            ]
              .join(' ')
              .slice(0, 5000),
          },
        });
        this.log.warn(
          `Batch ${batchId}: required Sold-to / Ship-to code columns not found`,
        );
        return;
      }

      let errorRows = 0;
      const valid: RowCtx[] = [];
      for (const ctx of rowCtxs) {
        const dn = toStr(pickCell(ctx.data, 'DN#', 'DN'), 30);
        if (!dn) {
          errorRows += 1;
          await this.prisma.importRowError.create({
            data: {
              batch_id: batchId,
              sheet_name: sheetName.slice(0, 120),
              row_number: ctx.excelRow,
              error_code: 'MISSING_DN',
              severity: error_severity.BLOCKER,
              error_message: 'DN# is required',
              raw_row_json: ctx.data as object,
            },
          });
        } else {
          valid.push(ctx);
        }
      }

      const byDn = new Map<string, RowCtx[]>();
      for (const ctx of valid) {
        const dn = toStr(pickCell(ctx.data, 'DN#', 'DN'), 30)!;
        if (!byDn.has(dn)) byDn.set(dn, []);
        byDn.get(dn)!.push(ctx);
      }

      let dnsCreated = 0;
      let dnsExisting = 0;
      const lineTouched: { create: number; update: number } = {
        create: 0,
        update: 0,
      };

      const nextStart = await this.computeNextNewPriority();
      let nextNewPriority = nextStart;

      for (const [dnNumber, group] of byDn) {
        const sorted = [...group].sort((a, b) => a.excelRow - b.excelRow);
        const headerCtx = sorted[0]!;
        const header = headerCtx.data;
        const sold = toStr(pickCellExact(header, 'Sold-to', 'Sold to'), 30);
        const ship = toStr(pickCellExact(header, 'Ship-to', 'Ship to'), 30);
        if (!sold || !ship) {
          const existingDn = await this.prisma.deliveryNote.findUnique({
            where: { dn_number: dnNumber },
            select: { id: true },
          });
          if (existingDn) {
            // Existing DNs are intentionally left unchanged, so partner-code
            // columns are not required for these rows.
          } else {
          for (const ctx of sorted) {
            errorRows += 1;
            await this.prisma.importRowError.create({
              data: {
                batch_id: batchId,
                sheet_name: sheetName.slice(0, 120),
                row_number: ctx.excelRow,
                error_code: 'MISSING_CUSTOMER',
                severity: error_severity.BLOCKER,
                error_message: `Missing Sold-to or Ship-to for DN ${dnNumber}`,
                raw_row_json: ctx.data as object,
              },
            });
          }
          continue;
          }
        }

        try {
          const r = await this.prisma.$transaction(async (tx) => {
            return this.processGroup(tx, {
              batchId,
              sheetName,
              dnNumber,
              group: sorted,
              header,
              sold: sold ?? '',
              ship: ship ?? '',
              getNextNewPriority: () => {
                const p = nextNewPriority;
                nextNewPriority += 1;
                return p;
              },
              actorUserId,
              actorRoleId,
              lineTouched,
            });
          });
          if (r === 'created') dnsCreated += 1;
          else dnsExisting += 1;
          await this.prisma.importRowError.create({
            data: {
              batch_id: batchId,
              sheet_name: sheetName.slice(0, 120),
              row_number: headerCtx.excelRow,
              error_code:
                r === 'created' ? IMPORT_DN_CREATED_CODE : IMPORT_DN_EXISTING_CODE,
              severity: error_severity.INFO,
              error_message:
                r === 'created'
                  ? `Delivery note ${dnNumber} created`
                  : `Delivery note ${dnNumber} already existed and was unchanged`,
              raw_row_json: { dn_number: dnNumber },
            },
          });
          if (!sheetHasStreetColumn) {
            await this.prisma.importRowError.create({
              data: {
                batch_id: batchId,
                sheet_name: sheetName.slice(0, 120),
                row_number: headerCtx.excelRow,
                error_code: 'MISSING_SHIP_TO_STREET_COLUMN',
                severity: error_severity.WARNING,
                error_message:
                  'No ship-to street column on this sheet (add one of: "Ship-to Street", ' +
                  '"Ship to Street", "Ship-to-Street", "Address 1", "Address1"). ' +
                  '`ship_to_locations.street1` is not updated from this file.',
                raw_row_json: header as object,
              },
            });
          }
        } catch (e) {
          this.log.warn(`DN ${dnNumber} failed: ${e}`);
          errorRows += group.length;
          await this.prisma.importRowError.create({
            data: {
              batch_id: batchId,
              sheet_name: sheetName.slice(0, 120),
              row_number: headerCtx.excelRow,
              error_code: 'GROUP_FAILED',
              severity: error_severity.BLOCKER,
              error_message:
                e instanceof Error ? e.message : String(e),
              raw_row_json: header as object,
            },
          });
        }
      }

      const summary = [
        `Sheet "${sheetName}"`,
        `DNs created: ${dnsCreated}, existing (unchanged): ${dnsExisting}`,
        `Lines created: ${lineTouched.create}, updated: ${lineTouched.update}`,
        `Row-level errors: ${errorRows}`,
      ].join('. ');

      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: {
          status:
            errorRows > 0 ? batch_status.PARTIAL : batch_status.SUCCESS,
          completed_at: new Date(),
          success_rows: dnsCreated + dnsExisting,
          error_rows: errorRows,
          summary_message: summary.slice(0, 5000),
        },
      });

      this.log.log(`Batch ${batchId} completed: ${summary}`);
    } catch (e) {
      this.log.error(e);
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: {
          status: batch_status.FAILED,
          completed_at: new Date(),
          summary_message:
            e instanceof Error ? e.message.slice(0, 2000) : 'Excel import failed',
        },
      });
      throw e;
    } finally {
      try {
        await unlink(filePath);
      } catch {
        /* ignore */
      }
    }
  }

  private async computeNextNewPriority(): Promise<number> {
    const agg = await this.prisma.deliveryNote.aggregate({
      where: {
        is_open: true,
        current_priority_no: { not: null },
      },
      _max: { current_priority_no: true },
    });
    const maxP = agg._max.current_priority_no;
    if (maxP == null || maxP < 1) return 1;
    return maxP + 1;
  }

  /**
   * Optional columns on the DN header row for master data (customer / ship-to).
   * Codes still come from Sold-to / Ship-to; names and address fill `customers` + `ship_to_locations`.
   */
  private extractPartyMasterFields(header: Record<string, unknown>) {
    const sold_to_name = toStr(
      pickCell(
        header,
        'Sold-to Name',
        'Sold to Name',
        'Customer Name',
        'Bill-to Name',
        'Bill to Name',
      ),
      255,
    );
    const ship_to_name = toStr(
      pickCell(header, 'Ship-to Name', 'Ship to Name', 'Ship To Name'),
      255,
    );
    const rawStreet1 = pickCellExact(
      header,
      'Ship-to Street',
      'Ship to Street',
      'Ship-to-Street',
      'Address 1',
      'Address1',
    );
    const street1 = toStr(rawStreet1, 255);
    const street2 = toStr(
      pickCell(
        header,
        'Ship-to Street 2',
        'Ship to Street 2',
        'Address 2',
        'Address2',
      ),
      255,
    );
    const city = toStr(pickCell(header, 'Ship-to City', 'Ship to City', 'City'), 120);
    const state_region = toStr(
      pickCell(
        header,
        'Ship-to State',
        'Ship-to Region/State',
        'Ship to State',
        'State',
        'Province',
      ),
      120,
    );
    const postal_code = toStr(
      pickCell(header, 'Postal Code', 'Zip', 'ZIP', 'Postal'),
      30,
    );
    const country_code = toStr(
      pickCell(header, 'Country Code', 'Cntry', 'Country Cd'),
      10,
    );
    const country_name = toStr(
      pickCell(header, 'Country', 'Country Name'),
      120,
    );

    return {
      sold_to_name,
      ship_to_name,
      street1,
      street1_provided: rawStreet1 !== undefined,
      street2,
      city,
      state_region,
      postal_code,
      country_code,
      country_name,
    };
  }

  /** Upsert customer + ship-to location and return rows to link on delivery_notes. */
  private async ensureCustomerAndShipTo(
    tx: Prisma.TransactionClient,
    header: Record<string, unknown>,
    sold: string,
    ship: string,
  ) {
    const normalizeCode = (value: string | null | undefined): string => {
      const raw = (value ?? '').trim().toUpperCase();
      if (!raw) return '';
      if (/^\d+$/.test(raw)) return raw.replace(/^0+/, '') || '0';
      return raw;
    };
    const soldCode = sold.trim().slice(0, 30);
    const shipCode = ship.trim().slice(0, 30);
    const m = this.extractPartyMasterFields(header);
    const cleanStreet1 =
      m.street1 &&
      normalizeCode(m.street1) !== normalizeCode(shipCode) &&
      normalizeCode(m.street1) !== normalizeCode(m.ship_to_name ?? null)
        ? m.street1
        : null;

    const customer = await tx.customer.upsert({
      where: { sold_to_code: soldCode },
      create: {
        sold_to_code: soldCode,
        sold_to_name: m.sold_to_name ?? soldCode,
      },
      update: {
        ...(m.sold_to_name ? { sold_to_name: m.sold_to_name } : {}),
      },
    });

    const shipToLocation = await tx.shipToLocation.upsert({
      where: {
        customer_id_ship_to_code: {
          customer_id: customer.id,
          ship_to_code: shipCode,
        },
      },
      create: {
        customer_id: customer.id,
        ship_to_code: shipCode,
        ship_to_name: m.ship_to_name ?? shipCode,
        street1: cleanStreet1,
        street2: m.street2,
        city: m.city,
        state_region: m.state_region,
        postal_code: m.postal_code,
        country_code: m.country_code,
        country_name: m.country_name,
      },
      update: {
        ...(m.ship_to_name ? { ship_to_name: m.ship_to_name } : {}),
        ...(m.street1_provided ? { street1: cleanStreet1 } : {}),
        ...(m.street2 != null ? { street2: m.street2 } : {}),
        ...(m.city != null ? { city: m.city } : {}),
        ...(m.state_region != null ? { state_region: m.state_region } : {}),
        ...(m.postal_code != null ? { postal_code: m.postal_code } : {}),
        ...(m.country_code != null ? { country_code: m.country_code } : {}),
        ...(m.country_name != null ? { country_name: m.country_name } : {}),
      },
    });

    return { customer, shipToLocation };
  }

  private extractHeaderFields(header: Record<string, unknown>) {
    const credit = toStr(pickCell(header, 'Credit Status'), 10);
    const shippingType = toStr(pickCell(header, 'Shipping Type'), 120);
    const currency = toStr(pickCurrency(header), 10);
    const dnCreate = toDateOnly(pickCell(header, 'DN Create date'));
    const reqDel = toDateOnly(
      pickCell(header, 'Customer Req. Delivery Date'),
    );
    const projShip = toDateOnly(pickCell(header, 'Projected Ship Date'));
    const poDate = toDateOnly(pickCell(header, 'P/O Date'));
    const customerPo = toStr(pickCell(header, 'Customer PO'), 80);
    const region = toStr(
      pickCell(header, 'Ship-to Region/State', 'Ship-to Region'),
      120,
    );
    const priorityLabel = parsePriorityLabel(
      pickCell(header, 'Priorities', 'Priority'),
    );

    return {
      credit_status: credit,
      shipping_type: shippingType,
      currency_code: currency,
      dn_create_date: dnCreate,
      requested_delivery_date: reqDel,
      projected_ship_date: projShip,
      po_date: poDate,
      customer_po: customerPo,
      ship_to_region_state: region,
      current_priority_no: priorityLabel,
    };
  }

  private async processGroup(
    tx: Prisma.TransactionClient,
    args: {
      batchId: string;
      sheetName: string;
      dnNumber: string;
      group: RowCtx[];
      header: Record<string, unknown>;
      sold: string;
      ship: string;
      getNextNewPriority: () => number;
      actorUserId: string;
      actorRoleId: string;
      lineTouched: { create: number; update: number };
    },
  ): Promise<'created' | 'existing'> {
    const {
      batchId,
      sheetName,
      dnNumber,
      group,
      header,
      sold,
      ship,
      getNextNewPriority,
      actorUserId,
      actorRoleId,
      lineTouched,
    } = args;

    const existing = await tx.deliveryNote.findUnique({
      where: { dn_number: dnNumber },
    });

    if (existing) {
      return 'existing';
    }

    const hf = this.extractHeaderFields(header);
    const { customer, shipToLocation } = await this.ensureCustomerAndShipTo(
      tx,
      header,
      sold,
      ship,
    );

    const prio =
      hf.current_priority_no != null && hf.current_priority_no >= 1
        ? hf.current_priority_no
        : getNextNewPriority();

    const dn = await tx.deliveryNote.create({
      data: {
        dn_number: dnNumber,
        sold_to_code: sold,
        ship_to_code: ship,
        customer_id: customer.id,
        ship_to_location_id: shipToLocation.id,
        last_seen_import_batch_id: batchId,
        current_status: dn_status.IMPORTED,
        current_priority_no: prio,
        is_open: true,
        credit_status: hf.credit_status,
        shipping_type: hf.shipping_type,
        currency_code: hf.currency_code,
        dn_create_date: hf.dn_create_date,
        requested_delivery_date: hf.requested_delivery_date,
        projected_ship_date: hf.projected_ship_date,
        po_date: hf.po_date,
        customer_po: hf.customer_po,
        ship_to_region_state: hf.ship_to_region_state,
      },
    });

    await tx.dnStatusHistory.create({
      data: {
        delivery_note_id: dn.id,
        from_status: null,
        to_status: dn_status.IMPORTED,
        message: `Imported from Excel (${sheetName})`,
        actor_user_id: actorUserId,
        actor_role_id: actorRoleId,
        source: 'IMPORT',
      },
    });

    const headerExcelRowNew = group[0]!.excelRow;
    for (const ctx of group) {
      await this.upsertLine(
        tx,
        dn.id,
        ctx,
        sheetName,
        batchId,
        lineTouched,
        headerExcelRowNew,
      );
    }

    return 'created';
  }

  private async upsertLine(
    tx: Prisma.TransactionClient,
    deliveryNoteId: string,
    ctx: RowCtx,
    sheetName: string,
    batchId: string,
    lineTouched: { create: number; update: number },
    headerExcelRow: number,
  ) {
    const { data, excelRow } = ctx;
    const docItem = toInt(
      pickCell(
        data,
        'Doc Item',
        'Doc item',
        'Doc.Item',
        'DocItem',
        'Line Item',
        'Line Item #',
        'Line',
        'Position',
        'Pos',
        'Item',
      ),
    );
    if (docItem == null || docItem < 1) {
      if (excelRow === headerExcelRow) {
        return;
      }
      await tx.importRowError.create({
        data: {
          batch_id: batchId,
          sheet_name: sheetName.slice(0, 120),
          row_number: excelRow,
          error_code: 'MISSING_DOC_ITEM',
          severity: error_severity.BLOCKER,
          error_message: 'Doc Item is required for each line',
          raw_row_json: data as object,
        },
      });
      return;
    }

    const matDesc = pickCell(
      data,
      'Material Desc.',
      'Material Desc',
      'Material Description',
    );
    const lineData = {
      so_number: toStr(pickCell(data, 'SO#', 'SO', 'Sales Order'), 30),
      material_code: toStr(
        pickCell(data, 'Material', 'Material Code', 'Mat.'), 80),
      material_description:
        matDesc == null || matDesc === ''
          ? null
          : String(matDesc).trim() || null,
      order_qty: toDecimal(pickCell(data, 'Order QTY', 'Order Qty')),
      open_qty: toDecimal(pickCell(data, 'Open QTY', 'Open Qty')),
      shipped_qty: toDecimal(pickCell(data, 'Shipped QTY', 'Shipped Qty')),
      unit_price: toDecimal(pickCell(data, 'Price')),
      line_amount: toDecimal(pickCell(data, 'Amount')),
      delivery_date: toDateOnly(pickCell(data, 'Delivery Date')),
      material_type: toStr(pickCell(data, 'Material type', 'Material Type'), 40),
    };

    const existingLine = await tx.deliveryNoteLine.findUnique({
      where: {
        delivery_note_id_doc_item: {
          delivery_note_id: deliveryNoteId,
          doc_item: docItem,
        },
      },
    });

    if (existingLine) {
      await tx.deliveryNoteLine.update({
        where: { id: existingLine.id },
        data: lineData,
      });
      lineTouched.update += 1;
    } else {
      await tx.deliveryNoteLine.create({
        data: {
          delivery_note_id: deliveryNoteId,
          doc_item: docItem,
          ...lineData,
        },
      });
      lineTouched.create += 1;
    }
  }
}

/** Ensure upload directory exists (sync with ImportService). */
export async function ensureUploadDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export function buildStoredPath(uploadDir: string, batchId: string) {
  return path.join(uploadDir, `${batchId}.xlsx`);
}
