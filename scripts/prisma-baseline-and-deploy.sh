#!/usr/bin/env bash
# Baseline Prisma Migrate on a PostgreSQL database that already has schema/objects
# from outside Prisma (e.g. schema-v1.sql), so `migrate deploy`
# fails with P3005 ("database schema is not empty").
#
# This records the first two idempotent migrations as applied WITHOUT running them,
# then runs `prisma migrate deploy` for anything newer.
#
# Only use if your DB already has:
#   - user_ui_preferences (20260509143700_add_user_ui_preferences)
#   - delivery_notes.picking_started_by_user_id + index (20260510130000_delivery_notes_picking_claim)
# If those are missing, apply the corresponding prisma/migrations/.../migration.sql first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/api"
SCHEMA="prisma/schema.prisma"
pnpm exec prisma migrate resolve --applied 20260509143700_add_user_ui_preferences --schema="$SCHEMA"
pnpm exec prisma migrate resolve --applied 20260510130000_delivery_notes_picking_claim --schema="$SCHEMA"
pnpm exec prisma migrate deploy --schema="$SCHEMA"
