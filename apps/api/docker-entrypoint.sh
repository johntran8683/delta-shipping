#!/bin/sh
# API container entrypoint: bring the database schema up to date, then start.
set -eu

# Fresh production databases are initialized from schema-v1.sql (see
# docker-compose.prod.yml), which already contains what the first two Prisma
# migrations add. Mark those as applied so `migrate deploy` only runs the rest.
# `|| true`: on later deploys they are already recorded — not an error.
pnpm exec prisma migrate resolve --applied 20260509143700_add_user_ui_preferences \
  --schema=prisma/schema.prisma || true
pnpm exec prisma migrate resolve --applied 20260510130000_delivery_notes_picking_claim \
  --schema=prisma/schema.prisma || true

pnpm exec prisma migrate deploy --schema=prisma/schema.prisma

# One-time admin creation on first deploy (set RUN_SEED_ON_BOOT=1 in .env).
if [ "${RUN_SEED_ON_BOOT:-0}" = "1" ]; then
  echo "Seeding initial users..."
  pnpm exec prisma db seed --schema=prisma/schema.prisma || echo "Seed skipped/failed (may already exist)."
fi

exec node dist/main
