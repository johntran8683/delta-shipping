-- Tracks which user moved a DN into PICKING (for "my picking" queue and completion rules).
ALTER TABLE delivery_notes
    ADD COLUMN IF NOT EXISTS picking_started_by_user_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_notes_picking_started_by_user_id_fkey'
    ) THEN
        ALTER TABLE delivery_notes
            ADD CONSTRAINT delivery_notes_picking_started_by_user_id_fkey
            FOREIGN KEY (picking_started_by_user_id)
            REFERENCES users(id)
            ON DELETE SET NULL
            ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_delivery_notes_picking_claimer_status
ON delivery_notes (picking_started_by_user_id, current_status);
