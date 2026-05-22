-- Per-customer opt-out from DN combine-with picker hints (see CustomersModule + delivery-notes SQL).

ALTER TABLE "customers"
ADD COLUMN IF NOT EXISTS "dn_combine_hints_disallowed" BOOLEAN NOT NULL DEFAULT false;
