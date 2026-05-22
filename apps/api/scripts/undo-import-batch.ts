/**
 * CLI undo for one import batch (same effect as DELETE /import/batches/:id).
 *
 * Usage (from apps/api, with DATABASE_URL set — e.g. `set -a && . ./.env && set +a`):
 *   pnpm import:undo -- <import-batch-uuid>
 *
 * Requires batch status !== RUNNING. Deletes delivery_notes where
 * last_seen_import_batch_id = batch id, then deletes the import_batches row.
 */
import { PrismaClient, batch_status } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const batchId = process.argv[2]?.trim();
  if (!batchId) {
    console.error(
      'Usage: pnpm import:undo -- <import-batch-uuid>\n' +
        'Set DATABASE_URL (e.g. load apps/api/.env in your shell).',
    );
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
  });
  if (!batch) {
    console.error(`Import batch not found: ${batchId}`);
    process.exit(1);
  }
  if (batch.status === batch_status.RUNNING) {
    console.error(
      'Cannot revert: batch is still RUNNING. Wait for the job to finish.',
    );
    process.exit(1);
  }

  const deletedCount = await prisma.$transaction(async (tx) => {
    const res = await tx.deliveryNote.deleteMany({
      where: { last_seen_import_batch_id: batchId },
    });
    await tx.importBatch.delete({ where: { id: batchId } });
    return res.count;
  });

  console.log(
    `OK — removed ${deletedCount} delivery note(s); deleted import batch ${batchId} (${batch.file_name}).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
