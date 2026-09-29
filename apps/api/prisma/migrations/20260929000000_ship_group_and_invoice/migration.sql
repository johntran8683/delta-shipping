-- Group shipping: shippers can ship multiple PACKED delivery notes together
-- (same customer / ship-to / ship method). The group is recorded when shipping
-- starts so "mark shipped" moves exactly the chosen notes.
ALTER TABLE "delivery_notes" ADD COLUMN "shipping_group_id" UUID;

-- One invoice number per delivery note, entered when marking shipped (required).
ALTER TABLE "shipments" ADD COLUMN "invoice_number" VARCHAR(80);
