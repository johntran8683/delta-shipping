-- Run against existing databases created before po_date / customer_po / ship_to_region_state.
ALTER TABLE delivery_notes
    ADD COLUMN IF NOT EXISTS po_date DATE,
    ADD COLUMN IF NOT EXISTS customer_po VARCHAR(80),
    ADD COLUMN IF NOT EXISTS ship_to_region_state VARCHAR(120);
