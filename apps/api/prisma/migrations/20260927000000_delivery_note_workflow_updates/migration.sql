-- Delivery note workflow updates:
-- 1. Rename dn_status IMPORTED -> NEW
-- 2. Remove PRIORITIZED (migrate existing rows to NEW)
-- 3. Add packing/shipping owner tracking + on-hold resume status

-- Migrate any PRIORITIZED rows to NEW before dropping the value
UPDATE "delivery_notes" SET "current_status" = 'NEW' WHERE "current_status" = 'PRIORITIZED';
UPDATE "dn_status_history" SET "from_status" = 'NEW' WHERE "from_status" = 'PRIORITIZED';
UPDATE "dn_status_history" SET "to_status" = 'NEW' WHERE "to_status" = 'PRIORITIZED';

-- Rename IMPORTED to NEW
ALTER TYPE "dn_status" RENAME VALUE 'IMPORTED' TO 'NEW';

-- Drop PRIORITIZED by recreating the enum type (Postgres cannot DROP VALUE directly)
ALTER TYPE "dn_status" RENAME TO "dn_status_old";
CREATE TYPE "dn_status" AS ENUM ('NEW', 'PICKING', 'PICKED', 'PACKING', 'PACKED', 'SHIPPING_IN_PROGRESS', 'SHIPPED', 'ON_HOLD', 'CANCELLED');

ALTER TABLE "delivery_notes" ALTER COLUMN "current_status" TYPE "dn_status" USING "current_status"::text::"dn_status";
ALTER TABLE "dn_status_history" ALTER COLUMN "from_status" TYPE "dn_status" USING "from_status"::text::"dn_status";
ALTER TABLE "dn_status_history" ALTER COLUMN "to_status" TYPE "dn_status" USING "to_status"::text::"dn_status";

DROP TYPE "dn_status_old";

-- Owner tracking for packing and shipping stages
ALTER TABLE "delivery_notes" ADD COLUMN "packing_started_by_user_id" UUID;
ALTER TABLE "delivery_notes" ADD COLUMN "shipping_started_by_user_id" UUID;
-- Status to resume when a note is released from ON_HOLD
ALTER TABLE "delivery_notes" ADD COLUMN "on_hold_from_status" "dn_status";

ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_packing_started_by_user_id_fkey"
  FOREIGN KEY ("packing_started_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_shipping_started_by_user_id_fkey"
  FOREIGN KEY ("shipping_started_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_delivery_notes_packing_claimer" ON "delivery_notes"("packing_started_by_user_id", "current_status");
CREATE INDEX IF NOT EXISTS "idx_delivery_notes_shipping_claimer" ON "delivery_notes"("shipping_started_by_user_id", "current_status");
