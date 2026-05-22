-- Pack sessions: combined or single-DN packing with multiple boxes (lb / inches).

CREATE TABLE IF NOT EXISTS "pack_sessions" (
    "id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "pack_sessions_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pack_sessions_created_by_user_id_fkey'
    ) THEN
        ALTER TABLE "pack_sessions"
            ADD CONSTRAINT "pack_sessions_created_by_user_id_fkey"
            FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "pack_session_delivery_notes" (
    "pack_session_id" UUID NOT NULL,
    "delivery_note_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pack_session_delivery_notes_pkey" PRIMARY KEY ("pack_session_id", "delivery_note_id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pack_session_delivery_notes_pack_session_id_fkey'
    ) THEN
        ALTER TABLE "pack_session_delivery_notes"
            ADD CONSTRAINT "pack_session_delivery_notes_pack_session_id_fkey"
            FOREIGN KEY ("pack_session_id") REFERENCES "pack_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pack_session_delivery_notes_delivery_note_id_fkey'
    ) THEN
        ALTER TABLE "pack_session_delivery_notes"
            ADD CONSTRAINT "pack_session_delivery_notes_delivery_note_id_fkey"
            FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "pack_session_delivery_notes_delivery_note_id_idx"
    ON "pack_session_delivery_notes"("delivery_note_id");

CREATE TABLE IF NOT EXISTS "pack_boxes" (
    "id" UUID NOT NULL,
    "pack_session_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "box_number" VARCHAR(80),
    "weight_lb" DECIMAL(12, 4) NOT NULL,
    "length_in" DECIMAL(12, 4) NOT NULL,
    "width_in" DECIMAL(12, 4) NOT NULL,
    "height_in" DECIMAL(12, 4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pack_boxes_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pack_boxes_pack_session_id_fkey'
    ) THEN
        ALTER TABLE "pack_boxes"
            ADD CONSTRAINT "pack_boxes_pack_session_id_fkey"
            FOREIGN KEY ("pack_session_id") REFERENCES "pack_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "pack_boxes_pack_session_id_sort_order_idx"
    ON "pack_boxes"("pack_session_id", "sort_order");

CREATE INDEX IF NOT EXISTS "pack_sessions_completed_at_idx" ON "pack_sessions"("completed_at");
CREATE INDEX IF NOT EXISTS "pack_sessions_created_by_user_id_idx" ON "pack_sessions"("created_by_user_id");
