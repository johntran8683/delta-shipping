# Database Design Document (v1)

This document specifies the database design for the shipping operations workflow, based on discussions and sample input files.

**v1.1 update:** added **users**, **roles**, **user_roles**, **permissions**, and **role_permissions**; `dn_status_history` now uses `actor_role_id` (FK → `roles`) instead of a PostgreSQL `user_role` enum; optional `actor_role_id` on `dn_priority_history`. Foreign keys tie `actor_user_id`, `shipper_user_id`, and `import_batches.created_by` to `users`.

## Scope

The system ingests:

- Daily Delivery Note file (transactional operations data)
- Shipping IDs file (customer/master reference data)

The schema separates:

- **Identity and access** (users, roles, permissions, role-permission mapping)
- Master data (customers, ship-to, carrier accounts)
- Transaction data (delivery notes, line items, shipments, statuses)
- Audit/import control data (history logs, batch imports, row errors)

Roles are stored in the `roles` table (not only as an enum) so admins can assign multiple roles per user and the app can check **permissions** per role. The **active role** for a session is typically kept in application state; audit rows store which role was used via `actor_role_id`.

---

## 1) Table: `users`

Purpose: application login accounts (one row per person).

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Internal user id; referenced by audit and shipment rows. |
| `email` | VARCHAR(255) UNIQUE | Yes | Login identifier (or primary contact email). |
| `display_name` | VARCHAR(255) | No | Shown name in UI and reports. |
| `password_hash` | VARCHAR(255) | No | If using local passwords; nullable if using SSO only. |
| `is_active` | BOOLEAN | Yes | Disable login without deleting history. |
| `created_at` | TIMESTAMP | Yes | Created timestamp. |
| `updated_at` | TIMESTAMP | Yes | Last update timestamp. |

---

## 2) Table: `roles`

Purpose: definable roles used for authorization and for audit (`actor_role_id`). Seed codes match operational roles.

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Role id. |
| `code` | VARCHAR(30) UNIQUE | Yes | Stable code: `SUPERVISOR`, `PICKER`, `PACKER`, `SHIPPER`, `SYSTEM`. |
| `name` | VARCHAR(100) | Yes | Display label. |
| `description` | TEXT | No | Optional explanation. |
| `sort_order` | INTEGER | Yes | UI ordering. |
| `is_active` | BOOLEAN | Yes | Disable role without deleting assignments. |
| `created_at` | TIMESTAMP | Yes | Created timestamp. |
| `updated_at` | TIMESTAMP | Yes | Updated timestamp. |

---

## 3) Table: `user_roles`

Purpose: many-to-many assignment — which roles each user may use (assigned by admin).

| Field | Type | Required | Description |
|---|---|---:|---|
| `user_id` | UUID (FK -> users.id) | Yes | User. |
| `role_id` | UUID (FK -> roles.id) | Yes | Granted role. |
| `assigned_at` | TIMESTAMP | Yes | When assignment was created. |
| `assigned_by` | UUID (FK -> users.id) | No | Admin who granted the role. |

Primary key: (`user_id`, `role_id`).

---

## 4) Table: `permissions`

Purpose: fine-grained feature flags (e.g. `dn.status.pack`, `shipment.create`). The app checks these for API and UI.

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Permission id. |
| `code` | VARCHAR(80) UNIQUE | Yes | Stable machine code. |
| `description` | TEXT | No | Human description. |
| `created_at` | TIMESTAMP | Yes | Created timestamp. |

---

## 5) Table: `role_permissions`

Purpose: which permissions each role has (admin-managed through DB or admin UI).

| Field | Type | Required | Description |
|---|---|---:|---|
| `role_id` | UUID (FK -> roles.id) | Yes | Role. |
| `permission_id` | UUID (FK -> permissions.id) | Yes | Permission. |

Primary key: (`role_id`, `permission_id`).

---

## 6) Table: `customers`

Purpose: one row per Sold-to customer/company.

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Internal unique ID for customer. |
| `sold_to_code` | VARCHAR(30) UNIQUE | Yes | Customer code from DN file (`Sold-to`). Main business key. |
| `sold_to_name` | VARCHAR(255) | Yes | Customer company name from DN file (`Sold-to Name`). |
| `fed_id_number` | VARCHAR(50) | No | Federal tax/company ID from Shipping IDs (`FED ID #`). |
| `default_contact_name` | VARCHAR(120) | No | Default customer contact from Shipping IDs. |
| `default_phone` | VARCHAR(50) | No | Default customer phone. |
| `default_email` | VARCHAR(255) | No | Default customer email. |
| `shipping_preference` | TEXT | No | Free-text shipping preference/instructions. |
| `is_active` | BOOLEAN default TRUE | Yes | Soft-active flag for customer. |
| `created_at` | TIMESTAMP | Yes | Record creation timestamp. |
| `updated_at` | TIMESTAMP | Yes | Last update timestamp. |

Notes:

- Unique key: `sold_to_code`
- One customer can have many ship-to addresses and many carrier accounts

---

## 7) Table: `ship_to_locations`

Purpose: delivery destinations (Ship-to) belonging to customers.

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Internal unique ID for ship-to location. |
| `customer_id` | UUID (FK -> customers.id) | Yes | Parent customer. |
| `ship_to_code` | VARCHAR(30) | Yes | Code from DN file (`Ship-to`). |
| `ship_to_name` | VARCHAR(255) | Yes | Name from DN file (`Ship-to Name`). |
| `street1` | VARCHAR(255) | No | Address line 1. |
| `street2` | VARCHAR(255) | No | Address line 2 (optional). |
| `city` | VARCHAR(120) | No | City. |
| `state_region` | VARCHAR(120) | No | State/province/region. |
| `postal_code` | VARCHAR(30) | No | Postal/ZIP code. |
| `country_code` | VARCHAR(10) | No | ISO country code if available (`US`, `CA`, etc.). |
| `country_name` | VARCHAR(120) | No | Human-readable country name. |
| `contact_name` | VARCHAR(120) | No | Ship-to contact person. |
| `phone` | VARCHAR(50) | No | Ship-to phone number. |
| `is_active` | BOOLEAN default TRUE | Yes | Active flag. |
| `created_at` | TIMESTAMP | Yes | Created timestamp. |
| `updated_at` | TIMESTAMP | Yes | Updated timestamp. |

Recommended unique constraint:

- (`customer_id`, `ship_to_code`)

---

## 8) Table: `customer_carrier_accounts`

Purpose: store carrier billing accounts per customer (for collect shipments).

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Internal ID. |
| `customer_id` | UUID (FK -> customers.id) | Yes | Customer owner of account. |
| `carrier_code` | VARCHAR(30) | Yes | Carrier (`FEDEX`, `UPS`, `DHL`, `PUROLATOR`, etc.). |
| `account_number` | VARCHAR(80) | Yes | Carrier billing account number. |
| `is_collect_enabled` | BOOLEAN default TRUE | Yes | Whether account can be used for collect. |
| `notes` | TEXT | No | Any special comments/conditions. |
| `is_active` | BOOLEAN default TRUE | Yes | Active flag. |
| `created_at` | TIMESTAMP | Yes | Created timestamp. |
| `updated_at` | TIMESTAMP | Yes | Updated timestamp. |

Recommended unique constraint:

- (`customer_id`, `carrier_code`, `account_number`)

---

## 9) Table: `delivery_notes`

Purpose: DN header-level current state and key operational fields.

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Internal ID. |
| `dn_number` | VARCHAR(30) UNIQUE | Yes | Delivery Note number (`DN#` or `Document`). |
| `sold_to_code` | VARCHAR(30) | Yes | Sold-to code from input. |
| `ship_to_code` | VARCHAR(30) | Yes | Ship-to code from input. |
| `customer_id` | UUID (FK -> customers.id) | No | Linked customer (nullable during import edge cases). |
| `ship_to_location_id` | UUID (FK -> ship_to_locations.id) | No | Linked ship-to location. |
| `current_priority_no` | INTEGER | No | Numeric priority (`1` means `P1`). |
| `current_status` | `dn_status` (ENUM) | Yes | Current workflow status. |
| `credit_status` | VARCHAR(10) | No | Credit status from source (`A`, `D`, etc.). |
| `shipping_type` | VARCHAR(120) | No | Source shipping type/method text. |
| `currency_code` | VARCHAR(10) | No | `USD`, `CAD`, etc. |
| `dn_create_date` | DATE | No | DN create date. |
| `requested_delivery_date` | DATE | No | Customer requested delivery date. |
| `projected_ship_date` | DATE | No | Projected/PC confirmed date. |
| `last_seen_import_batch_id` | UUID (FK -> import_batches.id) | Yes | Last batch where this DN appeared. |
| `is_open` | BOOLEAN default TRUE | Yes | Open vs shipped/closed shortcut flag. |
| `created_at` | TIMESTAMP | Yes | Created timestamp. |
| `updated_at` | TIMESTAMP | Yes | Updated timestamp. |

Business meaning:

- Stores latest state per DN
- Detailed line items are in `delivery_note_lines`
- History is tracked in history tables

---

## 10) Table: `delivery_note_lines`

Purpose: product lines under each DN (`doc_item` level).

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Internal line ID. |
| `delivery_note_id` | UUID (FK -> delivery_notes.id) | Yes | Parent DN. |
| `doc_item` | INTEGER | Yes | Line number (10, 20, 30...) from `Doc Item`/`Document Item`. |
| `so_number` | VARCHAR(30) | No | Sales order number (`SO#` / `Reference Doc.`). |
| `material_code` | VARCHAR(80) | No | Product code (`Material`). |
| `material_description` | TEXT | No | Product description (`Material Desc.`). |
| `order_qty` | NUMERIC(18,4) | No | Ordered quantity. |
| `open_qty` | NUMERIC(18,4) | No | Open quantity. |
| `shipped_qty` | NUMERIC(18,4) | No | Shipped quantity. |
| `unit_price` | NUMERIC(18,4) | No | Price from source. |
| `line_amount` | NUMERIC(18,4) | No | Amount from source. |
| `delivery_date` | DATE | No | Delivery date for line if provided. |
| `material_type` | VARCHAR(40) | No | Source material type (`FERT`, etc.). |
| `created_at` | TIMESTAMP | Yes | Created timestamp. |
| `updated_at` | TIMESTAMP | Yes | Updated timestamp. |

Recommended unique constraint:

- (`delivery_note_id`, `doc_item`)

---

## 11) Table: `dn_status_history`

Purpose: full audit trail for status transitions plus role messages (packer/shipper comments).

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Internal event ID. |
| `delivery_note_id` | UUID (FK -> delivery_notes.id) | Yes | DN affected. |
| `from_status` | `dn_status` (ENUM) | No | Previous status. |
| `to_status` | `dn_status` (ENUM) | Yes | New status. |
| `message` | TEXT | No | User-entered message/comment during status change. |
| `actor_user_id` | UUID (FK -> users.id) | Yes | User who changed status. |
| `actor_role_id` | UUID (FK -> roles.id) | Yes | Role the user was acting as (for reports: by user and by role). |
| `changed_at` | TIMESTAMP | Yes | Change timestamp. |
| `source` | VARCHAR(20) | Yes | `SYSTEM` or `MANUAL`. |

This table is the correct place for packer/shipper messages.

---

## 12) Table: `dn_priority_history`

Purpose: track all priority changes and reasons.

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Event ID. |
| `delivery_note_id` | UUID (FK -> delivery_notes.id) | Yes | DN affected. |
| `from_priority_no` | INTEGER | No | Previous priority number. |
| `to_priority_no` | INTEGER | Yes | New priority number. |
| `reason` | TEXT | No | Reason (rule, manual override, escalation). |
| `actor_user_id` | UUID (FK -> users.id) | Yes | User or system identity performing change. |
| `actor_role_id` | UUID (FK -> roles.id) | No | Role context when priority changed (optional for system jobs). |
| `changed_at` | TIMESTAMP | Yes | Change timestamp. |
| `source` | VARCHAR(20) | Yes | `SYSTEM` or `MANUAL`. |

---

## 13) Table: `shipments`

Purpose: shipment execution details entered by shippers.

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Shipment record ID. |
| `delivery_note_id` | UUID (FK -> delivery_notes.id) | Yes | DN being shipped. |
| `carrier_code` | VARCHAR(30) | Yes | Carrier used. |
| `service_level` | VARCHAR(80) | No | Service chosen (Ground, Priority, etc.). |
| `payment_method` | VARCHAR(20) | Yes | `COLLECT`, `PREPAID`, `THIRD_PARTY`, etc. |
| `collect_account_number` | VARCHAR(80) | No | Required when payment method is collect. |
| `tracking_number` | VARCHAR(80) | No | Carrier tracking number. |
| `shipment_reference` | VARCHAR(120) | No | External shipment/job reference. |
| `ship_date` | DATE | Yes | Date shipped. |
| `shipper_user_id` | UUID (FK -> users.id) | Yes | Shipper who created shipment. |
| `notes` | TEXT | No | Shipment notes/exceptions. |
| `created_at` | TIMESTAMP | Yes | Created timestamp. |
| `updated_at` | TIMESTAMP | Yes | Updated timestamp. |

Rule:

- If `payment_method = COLLECT`, `collect_account_number` must be present.

---

## 14) Table: `import_batches`

Purpose: one record per import file run.

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Batch ID. |
| `source_type` | `source_type` (ENUM) | Yes | `DAILY_DN` or `SHIPPING_IDS`. |
| `file_name` | VARCHAR(255) | Yes | Imported file name. |
| `file_checksum` | VARCHAR(128) | No | Hash to detect duplicate file loads. |
| `started_at` | TIMESTAMP | Yes | Import start time. |
| `completed_at` | TIMESTAMP | No | Import end time. |
| `status` | `batch_status` (ENUM) | Yes | `RUNNING`, `SUCCESS`, `FAILED`, `PARTIAL`. |
| `total_rows` | INTEGER | Yes | Total parsed rows. |
| `success_rows` | INTEGER | Yes | Successfully processed rows. |
| `error_rows` | INTEGER | Yes | Failed rows. |
| `created_by` | UUID (FK -> users.id) | No | User who started import (nullable for automated jobs using service account). |
| `summary_message` | TEXT | No | Human-readable summary. |

---

## 15) Table: `import_row_errors`

Purpose: row-level import failures for review and correction.

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | UUID (PK) | Yes | Error ID. |
| `batch_id` | UUID (FK -> import_batches.id) | Yes | Parent import batch. |
| `sheet_name` | VARCHAR(120) | No | Source worksheet name. |
| `row_number` | INTEGER | No | Source row number. |
| `error_code` | VARCHAR(60) | Yes | Normalized code (for example, `MISSING_DN`). |
| `severity` | `error_severity` (ENUM) | Yes | `BLOCKER`, `WARNING`, `INFO`. |
| `error_message` | TEXT | Yes | Error detail. |
| `raw_row_json` | JSONB | No | Raw row payload for debug/replay. |
| `created_at` | TIMESTAMP | Yes | Error logged time. |

---

## 16) Standards: Status and Priority

### Allowed `current_status` values

- `IMPORTED`
- `PRIORITIZED`
- `PICKING`
- `PICKED`
- `PACKING`
- `PACKED`
- `SHIPPING_IN_PROGRESS`
- `SHIPPED`
- `ON_HOLD`
- `CANCELLED`

### Priority storage

- Store numeric value in `current_priority_no` (`1`, `2`, `3`)
- Display as `P1`, `P2`, `P3` in UI
- Lower number means more urgent

---

## 17) Import and Matching Rules

- Match customer by `sold_to_code` (upsert)
- Match ship-to by (`customer_id`, `ship_to_code`) (upsert)
- Match DN by `dn_number` (upsert)
- Match DN line by (`delivery_note_id`, `doc_item`) (upsert)

Daily DN carry-over rule:

- Existing unshipped DN: keep previous priority and status
- New DN: assign `max(current_priority_no among open DNs) + 1`

---

## 18) Why This Design Fits the Operation

- Supports daily repeated imports without losing prior-day work progress
- Preserves packer/shipper comments with full audit trail
- Keeps master data and operations data cleanly separated
- Supports collect shipment billing with carrier account controls
- Enables role-based work queues, permission checks, and reliable KPI reporting (including per-user, per-role audit)

