-- Permanent fix for the 2026-09-26 defect: Prisma schema expects
-- users.must_change_password, but no migration created it (the temporary
-- database was patched by hand). Fresh deploys need this column.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
