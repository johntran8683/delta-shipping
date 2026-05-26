import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExcelImportProcessor } from './excel-import.processor';
import { ExcelIngestService } from './excel-ingest.service';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  imports: [AuthModule, BullModule.registerQueue({ name: 'excel-import' })],
  controllers: [ImportController],
  providers: [ImportService, ExcelIngestService, ExcelImportProcessor],
})
export class ImportModule {}
