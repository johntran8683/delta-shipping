-- Part master table (minimal): one canonical record per part number.
-- Seeded from delivery-note line history + the item-weights spreadsheet.
-- Codes are stored normalized (trimmed + uppercased) by the application.
CREATE TABLE "products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(80) NOT NULL,
  "description" VARCHAR(255),
  "unit_price" DECIMAL(18, 4),
  "weight_lb" DECIMAL(18, 4),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "products_code_key" ON "products" ("code");
