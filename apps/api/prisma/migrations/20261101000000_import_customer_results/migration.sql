-- Per-row outcomes for Shipping IDs (customer) imports, so the import report
-- can list which customers a batch created or updated. One row per
-- successful Excel row; the report groups rows by customer (CREATED wins
-- over UPDATED, account counts sum).
CREATE TABLE "import_customer_results" (
  "id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "customer_id" UUID,
  "sold_to_code" VARCHAR(30) NOT NULL,
  "sold_to_name" VARCHAR(255) NOT NULL,
  "outcome" VARCHAR(20) NOT NULL,
  "accounts_upserted" INTEGER NOT NULL DEFAULT 0,
  "excel_row" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_customer_results_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "import_customer_results_batch_id_idx" ON "import_customer_results"("batch_id");
CREATE INDEX "import_customer_results_batch_id_outcome_idx" ON "import_customer_results"("batch_id", "outcome");
ALTER TABLE "import_customer_results" ADD CONSTRAINT "import_customer_results_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_customer_results" ADD CONSTRAINT "import_customer_results_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
