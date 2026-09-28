-- Allow delivery notes created manually (not from an import batch) to have
-- no "last seen" import batch. Import revert only deletes notes whose
-- created_by_import_batch_id matches the reverted batch, so manual notes
-- (created_by_import_batch_id IS NULL) are never removed by a revert.
ALTER TABLE "delivery_notes" ALTER COLUMN "last_seen_import_batch_id" DROP NOT NULL;
