import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentPayload } from '../auth/decorators/current-payload.decorator';
import type { JwtPayload } from '../auth/jwt-payload';
import { ListImportBatchesQueryDto } from './dto/list-import-batches.query.dto';
import { ImportService } from './import.service';

@Controller('import')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  /**
   * Multipart upload: field name `file`.
   * First sheet only; one row = one line; DNs are grouped by `DN#` column.
   */
  @Post('excel')
  @RequirePermissions('import.daily_dn')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  uploadExcel(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentPayload() payload: JwtPayload,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Missing file (use field name "file")');
    }
    return this.importService.queueExcelFile(file, payload);
  }

  /** Recent import batches (newest first). Must be registered before `batches/:id`. */
  @Get('batches')
  @RequirePermissions('import.daily_dn')
  listBatches(
    @Query() query: ListImportBatchesQueryDto,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.importService.listImportBatches(query, payload);
  }

  @Get('batches/:id')
  @RequirePermissions('import.daily_dn')
  getBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.importService.getImportBatch(id, payload);
  }

  @Get('batches/:id/report')
  @RequirePermissions('import.daily_dn')
  getBatchReport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.importService.getImportBatchReport(id, payload);
  }

  /**
   * Undo import: deletes delivery notes last updated by this batch, then the batch record.
   */
  @Delete('batches/:id')
  @RequirePermissions('import.daily_dn')
  revertBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPayload() payload: JwtPayload,
  ) {
    return this.importService.revertImportBatch(id, payload);
  }
}
