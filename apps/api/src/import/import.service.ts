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

  /** Import APIs require active role SUPERVISOR or SYSTEM (not only the permission). */
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

  async listImportBatches(query: { limit?: number }, payload: JwtPayload) {
    const ok = await this.permissions.roleHasPermission(
      payload.activeRoleId,
      'import.daily_dn',
    );
    if (!ok) {
      throw new ForbiddenException('Missing permission: import.daily_dn');
    }
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);

    const limit = Math.min(query.limit ?? 50, 100);

    return this.prisma.importBatch.findMany({
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

  async getImportBatch(id: string, payload: JwtPayload) {
    const ok = await this.permissions.roleHasPermission(
      payload.activeRoleId,
      'import.daily_dn',
    );
    if (!ok) {
      throw new ForbiddenException('Missing permission: import.daily_dn');
    }
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);

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
    return batch;
  }

  async getImportBatchReport(id: string, payload: JwtPayload) {
    const ok = await this.permissions.roleHasPermission(
      payload.activeRoleId,
      'import.daily_dn',
    );
    if (!ok) {
      throw new ForbiddenException('Missing permission: import.daily_dn');
    }
    await this.assertSupervisorOrSystemActiveRole(payload.activeRoleId);

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
  async revertImportBatch(batchId: string, payload: JwtPayload) {
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
    if (batch.status === batch_status.RUNNING) {
      throw new BadRequestException(
        'Cannot revert while this import is still running. Wait for it to finish or fail.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const dnResult = await tx.deliveryNote.deleteMany({
        where: { last_seen_import_batch_id: batchId },
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
    };
  }
}
