-- Carrier accounts can belong to one ship-to location (a per-location
-- account) or to the whole customer (ship_to_location_id NULL, the previous
-- behaviour). The existing unique key on (customer_id, carrier_code,
-- account_number) is unchanged: one row per account number per customer, so
-- a number shared by several locations stays customer-wide.
ALTER TABLE "customer_carrier_accounts" ADD COLUMN "ship_to_location_id" UUID;
CREATE INDEX "customer_carrier_accounts_ship_to_location_id_idx" ON "customer_carrier_accounts"("ship_to_location_id");
ALTER TABLE "customer_carrier_accounts" ADD CONSTRAINT "customer_carrier_accounts_ship_to_location_id_fkey" FOREIGN KEY ("ship_to_location_id") REFERENCES "ship_to_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
