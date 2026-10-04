-- Per-box contents recorded by the packer (customs packing list), plus a
-- per-customer flag requiring box contents at pack time.
CREATE TABLE "pack_box_items" (
  "id" UUID NOT NULL,
  "pack_box_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "material_code" VARCHAR(80),
  "material_description" TEXT,
  "quantity" DECIMAL(18,4) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pack_box_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pack_box_items_pack_box_id_sort_order_idx" ON "pack_box_items"("pack_box_id", "sort_order");
ALTER TABLE "pack_box_items" ADD CONSTRAINT "pack_box_items_pack_box_id_fkey" FOREIGN KEY ("pack_box_id") REFERENCES "pack_boxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customers" ADD COLUMN "requires_box_content" BOOLEAN NOT NULL DEFAULT false;
