-- AlterTable
ALTER TABLE "delivery_notes" ADD COLUMN "latest_rush_reason" TEXT;

-- Backfill from most recent rush-mark history (to_rushed = true)
UPDATE "delivery_notes" dn
SET "latest_rush_reason" = sub.reason
FROM (
  SELECT DISTINCT ON (delivery_note_id)
    delivery_note_id,
    reason
  FROM "dn_rush_history"
  WHERE "to_rushed" = true
  ORDER BY delivery_note_id, changed_at DESC
) sub
WHERE dn.id = sub.delivery_note_id
  AND dn.is_rushed = true;
