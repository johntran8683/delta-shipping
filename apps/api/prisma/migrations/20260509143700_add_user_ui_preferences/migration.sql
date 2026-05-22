-- Per-user delivery notes list column visibility (see MeModule).
-- Idempotent: safe if the table already exists (e.g. from schema-v1.sql on fresh Docker init).

CREATE TABLE IF NOT EXISTS "user_ui_preferences" (
    "user_id" UUID NOT NULL,
    "delivery_notes_visible_columns" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_ui_preferences_pkey" PRIMARY KEY ("user_id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_ui_preferences_user_id_fkey'
    ) THEN
        ALTER TABLE "user_ui_preferences"
            ADD CONSTRAINT "user_ui_preferences_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
