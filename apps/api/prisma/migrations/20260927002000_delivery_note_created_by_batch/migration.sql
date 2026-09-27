-- Track which import batch created a delivery note (for revert).
ALTER TABLE "delivery_notes" ADD COLUMN "created_by_import_batch_id" UUID;

ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_created_by_import_batch_id_fkey"
  FOREIGN KEY ("created_by_import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_delivery_notes_created_by_batch" ON "delivery_notes"("created_by_import_batch_id");
