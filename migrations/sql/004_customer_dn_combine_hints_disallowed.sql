-- Mirror of prisma/migrations/20260510220000_customer_dn_combine_hints_disallowed/migration.sql

ALTER TABLE "customers"
ADD COLUMN IF NOT EXISTS "dn_combine_hints_disallowed" BOOLEAN NOT NULL DEFAULT false;
