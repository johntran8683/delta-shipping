# Database Design Document (v1)

This document describes **every PostgreSQL table** used by Delta Shipping.

| Source of truth | Path |
|-----------------|------|
| Canonical DDL (bootstrap) | `schema-v1.sql` |
| App models (current) | `apps/api/prisma/schema.prisma` |
| Additive migrations | `apps/api/prisma/migrations/` and `migrations/sql/` |

**Live data** is not in the repo: it lives in Docker Postgres (`delta-shipping-db`, host port **5433**, database `delta_shipping`).

---

## Scope

The system ingests:

- Daily Delivery Note file (transactional operations data)
- Shipping IDs file (customer/master reference data)

The schema separates:

1. **Identity & access** — users, roles, permissions, UI prefs  
2. **Import control** — batches and row errors  
3. **Master data** — customers, ship-to, carrier accounts  
4. **Operations** — delivery notes, lines, pack sessions/boxes, shipments  
5. **Audit** — status, priority, and rush history  

---

## Entity overview

```text
users ──┬── user_roles ── roles ── role_permissions ── permissions
        ├── user_ui_preferences
        ├── import_batches ── import_row_errors
        ├── pack_sessions ──┬── pack_session_delivery_notes ── delivery_notes
        │                   └── pack_boxes
        └── shipments ────────── delivery_notes

customers ──┬── ship_to_locations ── delivery_notes
            ├── customer_carrier_accounts
            └── delivery_notes ──┬── delivery_note_lines
                                 ├── dn_status_history
                                 ├── dn_priority_history
                                 └── dn_rush_history
```

---

## Enums

### `dn_status`

Workflow status on `delivery_notes.current_status` and status history.

| Value | Meaning |
|-------|---------|
| `IMPORTED` | Loaded from Excel; not yet prioritized |
| `PRIORITIZED` | Has a priority; waiting for pick |
| `PICKING` | Claimed / in pick |
| `PICKED` | Pick complete; ready to pack |
| `PACKING` | In a pack session |
| `PACKED` | Pack complete; ready to ship |
| `SHIPPING_IN_PROGRESS` | Shipper started shipping |
| `SHIPPED` | Shipped (typically `is_open = false`) |
| `ON_HOLD` | Held |
| `CANCELLED` | Cancelled (typically `is_open = false`) |

### `batch_status`

| Value | Meaning |
|-------|---------|
| `RUNNING` | Import job in progress |
| `SUCCESS` | All rows OK |
| `PARTIAL` | Some rows failed |
| `FAILED` | Batch failed |

### `source_type`

| Value | Meaning |
|-------|---------|
| `DAILY_DN` | Daily delivery-note Excel |
| `SHIPPING_IDS` | Shipping IDs / master reference file |

### `error_severity`

| Value | Meaning |
|-------|---------|
| `BLOCKER` | Row rejected |
| `WARNING` | Accepted with warning |
| `INFO` | Informational |

---

## 1) Identity & access

### 1.1 `users`

Purpose: application login accounts (one row per person).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Internal user id |
| `email` | VARCHAR(255) UNIQUE | Yes | Login identifier |
| `display_name` | VARCHAR(255) | No | Display name in UI |
| `password_hash` | VARCHAR(255) | No | Local password hash (nullable for SSO-only) |
| `must_change_password` | BOOLEAN default FALSE | Yes | Force password change on next login |
| `is_active` | BOOLEAN default TRUE | Yes | Soft-disable login |
| `created_at` | TIMESTAMP | Yes | Created |
| `updated_at` | TIMESTAMP | Yes | Updated |

### 1.2 `roles`

Purpose: operational / system roles for authorization and audit.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Role id |
| `code` | VARCHAR(30) UNIQUE | Yes | `SUPERVISOR`, `CSA`, `PICKER`, `PACKER`, `SHIPPER`, `SYSTEM` |
| `name` | VARCHAR(100) | Yes | Display label |
| `description` | TEXT | No | Optional explanation |
| `sort_order` | INTEGER default 0 | Yes | UI ordering |
| `is_active` | BOOLEAN default TRUE | Yes | Soft-disable role |
| `created_at` | TIMESTAMP | Yes | Created |
| `updated_at` | TIMESTAMP | Yes | Updated |

### 1.3 `user_roles`

Purpose: many-to-many — which roles each user may use.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | UUID (FK → users) | Yes | User |
| `role_id` | UUID (FK → roles) | Yes | Granted role |
| `assigned_at` | TIMESTAMP | Yes | When assigned |
| `assigned_by` | UUID (FK → users) | No | Admin who granted |

**PK:** (`user_id`, `role_id`)

### 1.4 `permissions`

Purpose: fine-grained feature flags (e.g. `dn.read`, `shipment.create`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Permission id |
| `code` | VARCHAR(80) UNIQUE | Yes | Stable machine code |
| `description` | TEXT | No | Human description |
| `created_at` | TIMESTAMP | Yes | Created |

### 1.5 `role_permissions`

Purpose: which permissions each role has.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role_id` | UUID (FK → roles) | Yes | Role |
| `permission_id` | UUID (FK → permissions) | Yes | Permission |

**PK:** (`role_id`, `permission_id`)

### 1.6 `user_ui_preferences`

Purpose: per-user UI settings (e.g. DN list column visibility).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | UUID (PK, FK → users) | Yes | One row per user |
| `delivery_notes_visible_columns` | JSONB | No | Column visibility prefs |
| `updated_at` | TIMESTAMP | Yes | Updated |

---

## 2) Import control

### 2.1 `import_batches`

Purpose: one record per import file run.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Batch id |
| `source_type` | `source_type` | Yes | `DAILY_DN` or `SHIPPING_IDS` |
| `file_name` | VARCHAR(255) | Yes | Uploaded file name |
| `file_checksum` | VARCHAR(128) | No | Hash to detect duplicate loads |
| `started_at` | TIMESTAMP | Yes | Start time |
| `completed_at` | TIMESTAMP | No | End time |
| `status` | `batch_status` default `RUNNING` | Yes | Batch outcome |
| `total_rows` | INTEGER ≥ 0 | Yes | Parsed rows |
| `success_rows` | INTEGER ≥ 0 | Yes | OK rows |
| `error_rows` | INTEGER ≥ 0 | Yes | Failed rows |
| `created_by` | UUID (FK → users) | No | Who started the import |
| `summary_message` | TEXT | No | Human summary |

**Undo rule:** deleting a batch removes DNs whose `last_seen_import_batch_id` is that batch (see API docs). Master data (customers / ship-tos) is kept.

### 2.2 `import_row_errors`

Purpose: row-level import failures for review.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Error id |
| `batch_id` | UUID (FK → import_batches, CASCADE) | Yes | Parent batch |
| `sheet_name` | VARCHAR(120) | No | Worksheet name |
| `row_number` | INTEGER | No | Source row |
| `error_code` | VARCHAR(60) | Yes | Normalized code (e.g. `MISSING_DN`) |
| `severity` | `error_severity` default `BLOCKER` | Yes | Severity |
| `error_message` | TEXT | Yes | Detail |
| `raw_row_json` | JSONB | No | Raw row for debug/replay |
| `created_at` | TIMESTAMP | Yes | Logged time |

---

## 3) Master data

### 3.1 `customers`

Purpose: one row per Sold-to customer/company.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Customer id |
| `sold_to_code` | VARCHAR(30) UNIQUE | Yes | Business key from DN (`Sold-to`) |
| `sold_to_name` | VARCHAR(255) | Yes | Company name |
| `fed_id_number` | VARCHAR(50) | No | Federal / tax ID (`FED ID #`) |
| `default_contact_name` | VARCHAR(120) | No | Default contact |
| `default_phone` | VARCHAR(50) | No | Default phone |
| `default_email` | VARCHAR(255) | No | Default email |
| `shipping_preference` | TEXT | No | Free-text shipping instructions |
| `is_active` | BOOLEAN default TRUE | Yes | Soft-active |
| `dn_combine_hints_disallowed` | BOOLEAN default FALSE | Yes | When true, picker “combine with” hints exclude this customer’s DNs |
| `created_at` | TIMESTAMP | Yes | Created |
| `updated_at` | TIMESTAMP | Yes | Updated |

### 3.2 `ship_to_locations`

Purpose: delivery destinations belonging to a customer.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Location id |
| `customer_id` | UUID (FK → customers, RESTRICT) | Yes | Parent customer |
| `ship_to_code` | VARCHAR(30) | Yes | Code from DN (`Ship-to`) |
| `ship_to_name` | VARCHAR(255) | Yes | Name |
| `street1` | VARCHAR(255) | No | Address line 1 |
| `street2` | VARCHAR(255) | No | Address line 2 |
| `city` | VARCHAR(120) | No | City |
| `state_region` | VARCHAR(120) | No | State / province |
| `postal_code` | VARCHAR(30) | No | Postal / ZIP |
| `country_code` | VARCHAR(10) | No | ISO country code |
| `country_name` | VARCHAR(120) | No | Country name |
| `contact_name` | VARCHAR(120) | No | Contact |
| `phone` | VARCHAR(50) | No | Phone |
| `is_active` | BOOLEAN default TRUE | Yes | Soft-active |
| `created_at` | TIMESTAMP | Yes | Created |
| `updated_at` | TIMESTAMP | Yes | Updated |

**Unique:** (`customer_id`, `ship_to_code`)

### 3.3 `customer_carrier_accounts`

Purpose: carrier billing accounts per customer (collect shipments).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Account id |
| `customer_id` | UUID (FK → customers, CASCADE) | Yes | Owner |
| `carrier_code` | VARCHAR(30) | Yes | e.g. `FEDEX`, `UPS` |
| `account_number` | VARCHAR(80) | Yes | Billing account number |
| `is_collect_enabled` | BOOLEAN default TRUE | Yes | Usable for collect |
| `notes` | TEXT | No | Special conditions |
| `is_active` | BOOLEAN default TRUE | Yes | Soft-active |
| `created_at` | TIMESTAMP | Yes | Created |
| `updated_at` | TIMESTAMP | Yes | Updated |

**Unique:** (`customer_id`, `carrier_code`, `account_number`)

---

## 4) Delivery notes (operations)

### 4.1 `delivery_notes`

Purpose: DN header — current operational state.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | DN id |
| `dn_number` | VARCHAR(30) UNIQUE | Yes | Delivery note number (`DN#`) |
| `sold_to_code` | VARCHAR(30) | Yes | Sold-to from file |
| `ship_to_code` | VARCHAR(30) | Yes | Ship-to from file |
| `customer_id` | UUID (FK → customers) | No | Linked customer (set on import upsert) |
| `ship_to_location_id` | UUID (FK → ship_to_locations) | No | Linked ship-to |
| `current_priority_no` | INTEGER ≥ 1 | No | Priority (`1` = P1); lower = more urgent |
| `is_rushed` | BOOLEAN default FALSE | Yes | Rush flag for queue highlight |
| `latest_rush_reason` | TEXT | No | Most recent rush reason (denormalized) |
| `current_status` | `dn_status` default `IMPORTED` | Yes | Workflow status |
| `credit_status` | VARCHAR(10) | No | Credit status from source |
| `shipping_type` | VARCHAR(120) | No | Shipping method text from source |
| `currency_code` | VARCHAR(10) | No | e.g. `USD`, `CAD` |
| `dn_create_date` | DATE | No | DN create date |
| `requested_delivery_date` | DATE | No | Requested delivery |
| `projected_ship_date` | DATE | No | Projected ship date |
| `po_date` | DATE | No | PO date from sheet |
| `customer_po` | VARCHAR(80) | No | Customer PO |
| `ship_to_region_state` | VARCHAR(120) | No | Region/state from sheet |
| `picking_started_by_user_id` | UUID (FK → users, SET NULL) | No | Picker who claimed this DN |
| `last_seen_import_batch_id` | UUID (FK → import_batches, RESTRICT) | Yes | Last import batch that touched this DN |
| `is_open` | BOOLEAN default TRUE | Yes | Open vs shipped/cancelled shortcut |
| `created_at` | TIMESTAMP | Yes | Created |
| `updated_at` | TIMESTAMP | Yes | Updated |

**Indexes:** status+priority, `is_open`, `is_rushed`, sold_to+ship_to, picking claimer+status.

### 4.2 `delivery_note_lines`

Purpose: product lines under each DN (`doc_item` level).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Line id |
| `delivery_note_id` | UUID (FK → delivery_notes, CASCADE) | Yes | Parent DN |
| `doc_item` | INTEGER | Yes | Line number (10, 20, …) |
| `so_number` | VARCHAR(30) | No | Sales order |
| `material_code` | VARCHAR(80) | No | Product code |
| `material_description` | TEXT | No | Product description |
| `order_qty` | NUMERIC(18,4) | No | Ordered qty |
| `open_qty` | NUMERIC(18,4) | No | Open qty |
| `shipped_qty` | NUMERIC(18,4) | No | Shipped qty |
| `unit_price` | NUMERIC(18,4) | No | Unit price |
| `line_amount` | NUMERIC(18,4) | No | Line amount |
| `delivery_date` | DATE | No | Line delivery date |
| `material_type` | VARCHAR(40) | No | e.g. `FERT` |
| `created_at` | TIMESTAMP | Yes | Created |
| `updated_at` | TIMESTAMP | Yes | Updated |

**Unique:** (`delivery_note_id`, `doc_item`)

---

## 5) Pack sessions

### 5.1 `pack_sessions`

Purpose: one packing operation — one or more DNs moved `PICKED` → `PACKING` together, then completed as `PACKED` with one or more boxes.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Session id |
| `created_by_user_id` | UUID (FK → users, RESTRICT) | Yes | Packer who started |
| `created_at` | TIMESTAMP | Yes | Started |
| `completed_at` | TIMESTAMP | No | When marked packed (null = in progress) |
| `pack_completion_note` | TEXT | No | Packer note (e.g. cart label) |

Shipper workflow uses the **latest completed** pack session for a DN to find peer DNs that ship together.

### 5.2 `pack_session_delivery_notes`

Purpose: membership — which DNs belong to a pack session (combined or single).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pack_session_id` | UUID (FK → pack_sessions, CASCADE) | Yes | Session |
| `delivery_note_id` | UUID (FK → delivery_notes, CASCADE) | Yes | DN |
| `created_at` | TIMESTAMP | Yes | Added time |

**PK:** (`pack_session_id`, `delivery_note_id`)

### 5.3 `pack_boxes`

Purpose: physical boxes recorded for a pack session (weight / dimensions for labels).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Box id |
| `pack_session_id` | UUID (FK → pack_sessions, CASCADE) | Yes | Parent session |
| `sort_order` | INTEGER default 0 | Yes | Display order |
| `box_number` | VARCHAR(80) | No | Optional box label/number |
| `weight_lb` | NUMERIC(12,4) | Yes | Weight in pounds |
| `length_in` | NUMERIC(12,4) | Yes | Length (inches) |
| `width_in` | NUMERIC(12,4) | Yes | Width (inches) |
| `height_in` | NUMERIC(12,4) | Yes | Height (inches) |
| `created_at` | TIMESTAMP | Yes | Created |

---

## 6) Shipments

### 6.1 `shipments`

Purpose: shipment execution details when a DN is marked `SHIPPED`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Shipment id |
| `delivery_note_id` | UUID (FK → delivery_notes, CASCADE) | Yes | DN shipped |
| `carrier_code` | VARCHAR(30) | Yes | Carrier used |
| `service_level` | VARCHAR(80) | No | Service (Ground, Priority, …) |
| `payment_method` | VARCHAR(20) | Yes | `COLLECT`, `PREPAID`, `THIRD_PARTY`, etc. |
| `collect_account_number` | VARCHAR(80) | No | Required when payment is `COLLECT` |
| `tracking_number` | VARCHAR(80) | No | Carrier tracking # |
| `shipment_reference` | VARCHAR(120) | No | External reference |
| `ship_date` | DATE | Yes | Date shipped |
| `shipper_user_id` | UUID (FK → users, RESTRICT) | Yes | Shipper who created row |
| `notes` | TEXT | No | Notes / exceptions |
| `created_at` | TIMESTAMP | Yes | Created |
| `updated_at` | TIMESTAMP | Yes | Updated |

**Rule:** if `payment_method = COLLECT`, `collect_account_number` must be non-empty (DB check in `schema-v1.sql`).

**Combined ship:** one physical shipment can create one `shipments` row **per DN** in the pack session, sharing the same `tracking_number`.

---

## 7) Audit history

### 7.1 `dn_status_history`

Purpose: full audit trail for status transitions (and role messages).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Event id |
| `delivery_note_id` | UUID (FK → delivery_notes, CASCADE) | Yes | DN |
| `from_status` | `dn_status` | No | Previous status |
| `to_status` | `dn_status` | Yes | New status |
| `message` | TEXT | No | Comment on transition |
| `actor_user_id` | UUID (FK → users, RESTRICT) | Yes | Who changed it |
| `actor_role_id` | UUID (FK → roles, RESTRICT) | Yes | Active role at change time |
| `changed_at` | TIMESTAMP | Yes | When |
| `source` | VARCHAR(20) default `MANUAL` | Yes | `MANUAL` or `SYSTEM` |

### 7.2 `dn_priority_history`

Purpose: audit trail for priority changes.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Event id |
| `delivery_note_id` | UUID (FK → delivery_notes, CASCADE) | Yes | DN |
| `from_priority_no` | INTEGER ≥ 1 | No | Previous priority |
| `to_priority_no` | INTEGER ≥ 1 | Yes | New priority |
| `reason` | TEXT | No | Why changed |
| `actor_user_id` | UUID (FK → users, RESTRICT) | Yes | Who |
| `actor_role_id` | UUID (FK → roles, SET NULL) | No | Role context |
| `changed_at` | TIMESTAMP | Yes | When |
| `source` | VARCHAR(20) default `MANUAL` | Yes | `MANUAL` or `SYSTEM` |

### 7.3 `dn_rush_history`

Purpose: audit trail when rush flag is toggled.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Event id |
| `delivery_note_id` | UUID (FK → delivery_notes, CASCADE) | Yes | DN |
| `from_rushed` | BOOLEAN | Yes | Previous rush state |
| `to_rushed` | BOOLEAN | Yes | New rush state |
| `reason` | TEXT | Yes | Required reason |
| `actor_user_id` | UUID (FK → users, RESTRICT) | Yes | Who |
| `actor_role_id` | UUID (FK → roles, SET NULL) | No | Role context |
| `changed_at` | TIMESTAMP | Yes | When |
| `source` | VARCHAR(20) default `MANUAL` | Yes | `MANUAL` or `SYSTEM` |

---

## 8) Standards & matching rules

### Priority display

- Stored as `current_priority_no` (`1`, `2`, `3`, …)
- Shown in UI as `P1`, `P2`, `P3`
- Lower number = more urgent

### Import matching (upsert keys)

| Entity | Match key |
|--------|-----------|
| Customer | `sold_to_code` |
| Ship-to | (`customer_id`, `ship_to_code`) |
| Delivery note | `dn_number` |
| DN line | (`delivery_note_id`, `doc_item`) |

### Daily DN carry-over

- Existing unshipped DN: keep previous priority and status  
- New DN: assign `max(current_priority_no among open DNs) + 1` (per product rules)

### Active role

The **active role** for a session lives in the JWT / app state, not in a dedicated table. Audit rows store which role was used via `actor_role_id`.

---

## 9) Table index (quick list)

| # | Table | Area |
|---|-------|------|
| 1 | `users` | Identity |
| 2 | `roles` | Identity |
| 3 | `user_roles` | Identity |
| 4 | `permissions` | Identity |
| 5 | `role_permissions` | Identity |
| 6 | `user_ui_preferences` | Identity / UI |
| 7 | `import_batches` | Import |
| 8 | `import_row_errors` | Import |
| 9 | `customers` | Master |
| 10 | `ship_to_locations` | Master |
| 11 | `customer_carrier_accounts` | Master |
| 12 | `delivery_notes` | Operations |
| 13 | `delivery_note_lines` | Operations |
| 14 | `pack_sessions` | Pack |
| 15 | `pack_session_delivery_notes` | Pack |
| 16 | `pack_boxes` | Pack |
| 17 | `shipments` | Ship |
| 18 | `dn_status_history` | Audit |
| 19 | `dn_priority_history` | Audit |
| 20 | `dn_rush_history` | Audit |

---

## 10) Why this design fits the operation

- Daily re-imports without losing in-progress pick/pack/ship work  
- Full audit for status, priority, and rush changes  
- Master data separated from transactional DNs  
- Combined packing (multi-DN sessions + boxes) and combined shipping (shared tracking)  
- RBAC via roles + permissions, with active role recorded on audit rows  
