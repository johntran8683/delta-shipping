import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import type { ExcelJobData } from './excel-ingest.service';
import { ExcelIngestService } from './excel-ingest.service';

@Processor('excel-import')
export class ExcelImportProcessor {
  constructor(private readonly ingest: ExcelIngestService) {}

  @Process('run')
  async handle(job: Job<ExcelJobData>) {
    await this.ingest.ingestFromPath(job.data);
  }
}
