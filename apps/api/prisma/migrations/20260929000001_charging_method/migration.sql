-- Charging method per delivery note (Excel "Ship method" header; fixed list).
ALTER TABLE "delivery_notes" ADD COLUMN "charging_method" VARCHAR(40);
