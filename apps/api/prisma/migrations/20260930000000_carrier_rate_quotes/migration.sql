-- Carrier API credentials for live rate quotes + app settings + quoted fee on shipments.
CREATE TABLE "carrier_rate_configs" (
  "id" UUID NOT NULL,
  "carrier_code" VARCHAR(20) NOT NULL,
  "environment" VARCHAR(20) NOT NULL,
  "client_id" VARCHAR(200) NOT NULL,
  "client_secret_enc" TEXT NOT NULL,
  "account_number" VARCHAR(80),
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "carrier_rate_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "carrier_rate_configs_carrier_code_environment_key" ON "carrier_rate_configs"("carrier_code", "environment");

CREATE TABLE "app_settings" (
  "key" VARCHAR(120) NOT NULL,
  "value" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "shipments" ADD COLUMN "quoted_fee" DECIMAL(12,2);
ALTER TABLE "shipments" ADD COLUMN "quoted_fee_currency" VARCHAR(3);
ALTER TABLE "shipments" ADD COLUMN "quoted_service_code" VARCHAR(60);
ALTER TABLE "shipments" ADD COLUMN "quoted_service_name" VARCHAR(120);
