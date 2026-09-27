import { InjectQueue } from '@nestjs/bull';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { batch_status, source_type } from '@prisma/client';
import type { Queue } from 'bull';
import { unlink, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { JwtPayload } from '../auth/jwt-payload';
import { PermissionsService } from '../auth/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { validateDailyDnExcelHeaders } from './excel-daily-dn-header.validation';
import { validateShippingIdsExcelHeaders } from './excel-shipping-ids-header.validation';
import { buildStoredPath, ensureUploadDir } from './excel-ingest.service';

@Injectable()
export class ImportService {
  private readonly log = new Logger(ImportService.name);
  private static readonly IMPORT_DN_CREATED_CODE = 'IMPORTED_DN_CREATED';
  private static readonly IMPORT_DN_EXISTING_CODE = 'IMPORTED_DN_EXISTING';

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    @InjectQueue('excel-import') private readonly excelQueue: Queue,
  ) {}

  /** Daily DN import APIs require active role SUPERVISOR or SYSTEM. */
  private async assertSupervisorOrSystemActiveRole(activeRoleId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: activeRoleId },
    });
    if (!role || !['SUPERVISOR', 'SYSTEM'].includes(role.code)) {
      throw new ForbiddenException(
        'Import is only available when your active role is SUPERVISOR or SYSTEM (use login “Active role code” or POST /auth/active-role).',
      );
    }
  }

  /** Shipping IDs import: CSA, SUPERVISOR, or SYSTEM. */
  private async assertShippingIdsImportRole(activeRoleId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: activeRoleId },
    });
    if (!role || !['CSA', 'SUPERVISOR', 'SYSTEM'].includes(role.code)) {
      throw new ForbiddenException(
        'Shipping IDs import requires active role CSA, SUPERVISOR, or SYSTEM.',
      );
    }
  }

  private async roleHasAnyImportPerm(activeRoleId: string) {
    const [daily, shipping] = await Promise.all([
      this.permissions.roleHasPermission(activeRoleId, 'import.daily_dn'),
      this.permissions.roleHasPermission(activeRoleId, 'import.shipping_ids'),
    ]);
    return { daily, shipping, any: daily || shipping };
  }

  async queueExcelFile(
    file: Express.Multer.File,
    payload: JwtPayload,
  ): Promise<{ batchId: string; status: 'queued' }> {
    const canImport = await this.permissions.roleHasPermission(
      payload.activeRoleId,
      'import.daily_dn',
    );
    if (!canImport) {
      throw new ForbiddenException(
        'Missing permission import.daily_dn for your active role. Sign in with Active role code SUPERVISOR (or switch role via POST /auth/active-role).',
      );
    }
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);

    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.xlsx', '.xlsm', '.xls'].includes(ext)) {
      throw new BadRequestException(
        'Upload an Excel file (.xlsx, .xlsm, .xls)',
      );
    }

    const headerCheck = validateDailyDnExcelHeaders(file.buffer);
    if (!headerCheck.ok) {
      throw new BadRequestException(headerCheck.message);
    }

    const batch = await this.prisma.importBatch.create({
      data: {
        source_type: source_type.DAILY_DN,
        file_name: file.originalname.slice(0, 255),
        status: batch_status.RUNNING,
        created_by: payload.sub,
        total_rows: 0,
      },
    });

    const uploadDir =
      process.env.UPLOAD_DIR ||
      path.join(os.tmpdir(), 'delta-shipping-uploads');
    await ensureUploadDir(uploadDir);
    const filePath = buildStoredPath(uploadDir, batch.id);
    await writeFile(filePath, file.buffer);

    try {
      await this.excelQueue.add('run', {
        batchId: batch.id,
        filePath,
        actorUserId: payload.sub,
        actorRoleId: payload.activeRoleId,
        sourceType: 'DAILY_DN',
      });
    } catch (err) {
      this.log.error(err);
      await unlink(filePath).catch(() => undefined);
      await this.prisma.importBatch
        .delete({ where: { id: batch.id } })
        .catch(() => undefined);
      throw new ServiceUnavailableException(
        'Could not queue import (Redis unreachable). Start Redis: from repo root run `pnpm db:up` or ensure REDIS_HOST / REDIS_PORT in apps/api/.env match your Redis.',
      );
    }

    this.log.log(`Excel import queued batch ${batch.id}`);
    return { batchId: batch.id, status: 'queued' };
  }

  async queueShippingIdsFile(
    file: Express.Multer.File,
    payload: JwtPayload,
  ): Promise<{ batchId: string; status: 'queued' }> {
    const canImport = await this.permissions.roleHasPermission(
      payload.activeRoleId,
      'import.shipping_ids',
    );
    if (!canImport) {
      throw new ForbiddenException(
        'Missing permission import.shipping_ids for your active role.',
      );
    }
    await this.assertShippingIdsImportRole(payload.activeRoleId);

    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.xlsx', '.xlsm', '.xls'].includes(ext)) {
      throw new BadRequestException(
        'Upload an Excel file (.xlsx, .xlsm, .xls)',
      );
    }

    const headerCheck = validateShippingIdsExcelHeaders(file.buffer);
    if (!headerCheck.ok) {
      throw new BadRequestException(headerCheck.message);
    }

    const batch = await this.prisma.importBatch.create({
      data: {
        source_type: source_type.SHIPPING_IDS,
        file_name: file.originalname.slice(0, 255),
        status: batch_status.RUNNING,
        created_by: payload.sub,
        total_rows: 0,
      },
    });

    const uploadDir =
      process.env.UPLOAD_DIR ||
      path.join(os.tmpdir(), 'delta-shipping-uploads');
    await ensureUploadDir(uploadDir);
    const filePath = buildStoredPath(uploadDir, batch.id);
    await writeFile(filePath, file.buffer);

    try {
      await this.excelQueue.add('run', {
        batchId: batch.id,
        filePath,
        actorUserId: payload.sub,
        actorRoleId: payload.activeRoleId,
        sourceType: 'SHIPPING_IDS',
        sheetName: headerCheck.sheetName,
      });
    } catch (err) {
      this.log.error(err);
      await unlink(filePath).catch(() => undefined);
      await this.prisma.importBatch
        .delete({ where: { id: batch.id } })
        .catch(() => undefined);
      throw new ServiceUnavailableException(
        'Could not queue import (Redis unreachable). Start Redis: from repo root run `pnpm db:up` or ensure REDIS_HOST / REDIS_PORT in apps/api/.env match your Redis.',
      );
    }

    this.log.log(`Shipping IDs import queued batch ${batch.id}`);
    return { batchId: batch.id, status: 'queued' };
  }

  async listImportBatches(query: { limit?: number }, payload: JwtPayload) {
    const perms = await this.roleHasAnyImportPerm(payload.activeRoleId);
    if (!perms.any) {
      throw new ForbiddenException(
        'Missing permission: import.daily_dn or import.shipping_ids',
      );
    }
    if (perms.daily) {
      await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);
    } else {
      await this.assertShippingIdsImportRole(payload.activeRoleId);
    }

    const limit = Math.min(query.limit ?? 50, 100);
    const where =
      perms.daily && perms.shipping
        ? undefined
        : perms.daily
          ? { source_type: source_type.DAILY_DN }
          : { source_type: source_type.SHIPPING_IDS };

    return this.prisma.importBatch.findMany({
      where,
      orderBy: { started_at: 'desc' },
      take: limit,
      select: {
        id: true,
        file_name: true,
        status: true,
        started_at: true,
        completed_at: true,
        total_rows: true,
        success_rows: true,
        error_rows: true,
        summary_message: true,
        source_type: true,
        _count: {
          select: { delivery_notes: true },
        },
      },
    });
  }

  private async assertCanAccessBatch(
    batchSource: source_type,
    activeRoleId: string,
  ) {
    const perms = await this.roleHasAnyImportPerm(activeRoleId);
    if (batchSource === source_type.DAILY_DN) {
      if (!perms.daily) {
        throw new ForbiddenException('Missing permission: import.daily_dn');
      }
      await this.assertSupervisorOrSystemActiveRole(activeRoleId);
      return;
    }
    if (batchSource === source_type.SHIPPING_IDS) {
      if (!perms.shipping) {
        throw new ForbiddenException('Missing permission: import.shipping_ids');
      }
      await this.assertShippingIdsImportRole(activeRoleId);
      return;
    }
    throw new ForbiddenException('Unknown import source type');
  }

  async getImportBatch(id: string, payload: JwtPayload) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id },
      include: {
        row_errors: {
          orderBy: { created_at: 'asc' },
          take: 200,
        },
      },
    });
    if (!batch) {
      throw new NotFoundException('Import batch not found');
    }
    await this.assertCanAccessBatch(batch.source_type, payload.activeRoleId);
    return batch;
  }

  async getImportBatchReport(id: string, payload: JwtPayload) {
    const batchMeta = await this.prisma.importBatch.findUnique({
      where: { id },
      select: { id: true, source_type: true },
    });
    if (!batchMeta) {
      throw new NotFoundException('Import batch not found');
    }
    await this.assertCanAccessBatch(
      batchMeta.source_type,
      payload.activeRoleId,
    );

    const informationalCodes = [
      ImportService.IMPORT_DN_CREATED_CODE,
      ImportService.IMPORT_DN_EXISTING_CODE,
    ];

    const batch = await this.prisma.importBatch.findUnique({
      where: { id },
      select: {
        id: true,
        file_name: true,
        status: true,
        started_at: true,
        completed_at: true,
        summary_message: true,
        total_rows: true,
        success_rows: true,
        error_rows: true,
      },
    });
    if (!batch) {
      throw new NotFoundException('Import batch not found');
    }

    const existingListCap = 20_000;
    const rowFailureListCap = 1_000;

    const [
      newDeliveryNotesCount,
      existingDeliveryNotesCount,
      existingRows,
      rowFailureCount,
      rowFailures,
      linkedDeliveryNotesCount,
    ] = await this.prisma.$transaction([
      this.prisma.importRowError.count({
        where: {
          batch_id: id,
          error_code: ImportService.IMPORT_DN_CREATED_CODE,
        },
      }),
      this.prisma.importRowError.count({
        where: {
          batch_id: id,
          error_code: ImportService.IMPORT_DN_EXISTING_CODE,
        },
      }),
      this.prisma.importRowError.findMany({
        where: {
          batch_id: id,
          error_code: ImportService.IMPORT_DN_EXISTING_CODE,
        },
        orderBy: { created_at: 'asc' },
        select: { raw_row_json: true, error_message: true },
        take: existingListCap,
      }),
      this.prisma.importRowError.count({
        where: {
          batch_id: id,
          error_code: { notIn: informationalCodes },
        },
      }),
      this.prisma.importRowError.findMany({
        where: {
          batch_id: id,
          error_code: { notIn: informationalCodes },
        },
        orderBy: [{ row_number: 'asc' }, { created_at: 'asc' }],
        select: {
          id: true,
          sheet_name: true,
          row_number: true,
          error_code: true,
          severity: true,
          error_message: true,
        },
        take: rowFailureListCap,
      }),
      this.prisma.deliveryNote.count({
        where: { last_seen_import_batch_id: id },
      }),
    ]);

    const existingDeliveryNotes = Array.from(
      new Set(
        existingRows
          .map((r) => {
            const raw = r.raw_row_json as { dn_number?: unknown } | null;
            if (raw && typeof raw.dn_number === 'string') {
              const dn = raw.dn_number.trim();
              return dn.length > 0 ? dn : null;
            }
            const m = /Delivery note\s+(\S+)/i.exec(r.error_message);
            return m?.[1] ?? null;
          })
          .filter((x): x is string => Boolean(x)),
      ),
    );

    return {
      batch,
      newDeliveryNotesCount,
      existingDeliveryNotesCount,
      existingDeliveryNotes,
      existingDeliveryNotesTruncated:
        existingDeliveryNotesCount > existingRows.length,
      rowFailureCount,
      rowFailures,
      rowFailuresTruncated: rowFailureCount > rowFailures.length,
      linkedDeliveryNotesCount,
    };
  }

  /**
   * Undo one Excel import: removes delivery notes whose **last** touch was this batch,
   * then deletes the import batch record (and row errors). Same auth rules as import.
   */
  async revertImportBatch(batchId: string, payload: JwtPayload, force = false) {
    const canImport = await this.permissions.roleHasPermission(
      payload.activeRoleId,
      'import.daily_dn',
    );
    if (!canImport) {
      throw new ForbiddenException('Missing permission: import.daily_dn');
    }
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);

    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) {
      throw new NotFoundException('Import batch not found');
    }
    if (batch.source_type !== source_type.DAILY_DN) {
      throw new BadRequestException(
        'Only daily DN imports can be undone. Shipping IDs imports do not remove customers or carrier accounts.',
      );
    }
    if (batch.status === batch_status.RUNNING) {
      throw new BadRequestException(
        'Cannot revert while this import is still running. Wait for it to finish or fail.',
      );
    }

    // Find all notes touched by this batch.
    const touched = await this.prisma.deliveryNote.findMany({
      where: { last_seen_import_batch_id: batchId },
      select: {
        id: true,
        dn_number: true,
        current_status: true,
        created_by_import_batch_id: true,
        updated_at: true,
      },
    });

    const createdByBatch = touched.filter(
      (n) => n.created_by_import_batch_id === batchId,
    );
    const updatedByBatch = touched.filter(
      (n) => n.created_by_import_batch_id !== batchId,
    );

    // A note "changed" if it left NEW status or was modified after the import.
    const batchTime = batch.completed_at ?? batch.started_at;
    const changed = createdByBatch.filter(
      (n) => n.current_status !== 'NEW' || n.updated_at > batchTime,
    );

    if (changed.length > 0 && !force) {
      // Warn: let the supervisor choose whether to proceed.
      return {
        importBatchId: batchId,
        fileName: batch.file_name,
        requiresConfirmation: true,
        changedNotes: changed.map((n) => ({
          id: n.id,
          dn_number: n.dn_number,
          current_status: n.current_status,
        })),
        createdCount: createdByBatch.length,
        updatedCount: updatedByBatch.length,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Delete notes created by this batch.
      const dnResult = await tx.deliveryNote.deleteMany({
        where: { created_by_import_batch_id: batchId },
      });
      await tx.importBatch.delete({
        where: { id: batchId },
      });
      return dnResult.count;
    });

    this.log.log(
      `Reverted import batch ${batchId}: removed ${result} delivery notes`,
    );

    return {
      importBatchId: batchId,
      deletedDeliveryNotes: result,
      fileName: batch.file_name,
      requiresConfirmation: false,
      // Pre-existing notes that were refreshed by this import; re-import the
      // correct file to restore their data.
      refreshedExistingNotes: updatedByBatch.map((n) => ({
        id: n.id,
        dn_number: n.dn_number,
        current_status: n.current_status,
      })),
    };
  }
}
