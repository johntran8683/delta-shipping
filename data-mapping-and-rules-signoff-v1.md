# Data Mapping and Rules Sign-off (v1)

This document is the implementation bridge between source Excel files and the database schema.

Use this file for team sign-off before engineering starts coding import jobs.

---

## 1) Objectives

- Define exact source-to-target mappings
- Define transform/validation rules
- Define which errors block import
- Confirm ownership and workflow rules

---

## 2) Source Files in Scope

1. Daily input file from upstream department (Delivery Notes)
2. Shipping IDs master file (Customers/Vendors)

---

## 2a) Identity and access (users, roles, permissions)

The database includes:

| Table | Purpose |
|---|---|
| `users` | Login accounts (email, display name, active flag). |
| `roles` | Role definitions (`SUPERVISOR`, `PICKER`, `PACKER`, `SHIPPER`, `SYSTEM`); used for authorization and audit. |
| `user_roles` | Many-to-many: which roles each user is allowed to use (assigned by admin). |
| `permissions` | Fine-grained permission codes (e.g. `dn.status.pack`, `shipment.create`). |
| `role_permissions` | Maps each role to the permissions it grants. |

**Application behavior (not in Excel):** the user picks an **active role** for the current session. API calls check that the user has the permission **via** that role (or your chosen rule). Audit rows such as `dn_status_history` store `actor_user_id` and `actor_role_id` so reports can count work **by user and by role**.

---

## 3) Daily Delivery Note Mapping

Source: DN workbook sheet rows (header names vary slightly by date/sheet).

## 3.1 Header-level mapping (`delivery_notes`)

| Source Column (aliases) | Target Field | Transform Rule | Required | Notes |
|---|---|---|---:|---|
| `DN#`, `Document` | `delivery_notes.dn_number` | Trim text; keep as string | Yes | Unique business key |
| `Sold-to` | `delivery_notes.sold_to_code` | Trim/uppercase | Yes | Used to match customer |
| `Sold-to Name` | `customers.sold_to_name` | Trim | Yes | Upsert in `customers` |
| `Ship-to` | `delivery_notes.ship_to_code` | Trim/uppercase | Yes | Used to match ship-to |
| `Ship-to Name` | `ship_to_locations.ship_to_name` | Trim | Yes | Upsert in ship-to table |
| `Credit Status` | `delivery_notes.credit_status` | Trim uppercase | No | Examples: A, D |
| `Shipping Type` | `delivery_notes.shipping_type` | Trim | No | Carrier/service-like free text |
| `$`, `Document currency` | `delivery_notes.currency_code` | Trim uppercase | No | USD/CAD etc. |
| `DN Create date` | `delivery_notes.dn_create_date` | Parse date | No | Invalid date -> warning/error queue |
| `Customer Req. Delivery Date`, `Customer Req.Delivery Date` | `delivery_notes.requested_delivery_date` | Parse date | No | Column naming varies |
| `Projected Ship Date`, `PC Confirmed Delivery Date` | `delivery_notes.projected_ship_date` | Parse date | No | Prefer PC confirmed if present |
| `Priority` | `delivery_notes.current_priority_no` | Parse `P<number>` -> int | No (system-set) | Import may be empty |

## 3.2 Line-level mapping (`delivery_note_lines`)

| Source Column (aliases) | Target Field | Transform Rule | Required | Notes |
|---|---|---|---:|---|
| `Doc Item`, `Document Item` | `delivery_note_lines.doc_item` | Trim, parse int | Yes | Unique with DN |
| `SO#`, `Reference Doc.` | `delivery_note_lines.so_number` | Trim | No | Sales order reference |
| `Material` | `delivery_note_lines.material_code` | Trim uppercase | No | Product code |
| `Material Desc.` | `delivery_note_lines.material_description` | Keep text | No | Product description |
| `Order QTY` | `delivery_note_lines.order_qty` | Parse numeric | No | |
| `Open QTY` | `delivery_note_lines.open_qty` | Parse numeric | No | |
| `Shipped QTY` | `delivery_note_lines.shipped_qty` | Parse numeric | No | |
| `Price` | `delivery_note_lines.unit_price` | Parse numeric | No | |
| `Amount` | `delivery_note_lines.line_amount` | Parse numeric | No | |
| `Delivery Date` | `delivery_note_lines.delivery_date` | Parse date | No | |
| `Material type` | `delivery_note_lines.material_type` | Trim uppercase | No | Example: FERT |

## 3.3 Operational notes mapping

| Source Column | Target Table/Field | Rule |
|---|---|---|
| `Notes` | `dn_status_history.message` (on status change) OR future `dn_notes` | Preserve text, do not overwrite history |
| `Packer's Notes` | `dn_status_history.message` (packer transitions) | Preserve as event comment |
| `FirstOccurrence` | Optional derived/audit field | Can be ignored in MVP if redundant |

---

## 4) Shipping IDs Mapping

Source: `SHIPID_*.xlsm`, sheet `Customers`.

## 4.1 Customer mapping

| Source Column | Target Field | Transform Rule | Required | Notes |
|---|---|---|---:|---|
| `code` | `customers.sold_to_code` | Trim/uppercase | Yes | Key for upsert |
| `CUSTOMER NAME:` | `customers.sold_to_name` | Trim | Yes | |
| `FED ID #` | `customers.fed_id_number` | Keep string | No | Tax/company ID |
| `Contact:` | `customers.default_contact_name` | Trim | No | |
| `Phone #` | `customers.default_phone` | Keep formatting | No | |
| `Email:` | `customers.default_email` | Lowercase trim | No | |
| `SHIPPING INFO….` | `customers.shipping_preference` | Keep text | No | Free text |
| `Customer Preference:` | `customers.shipping_preference` (append/merge) | Keep text | No | If both exist, concatenate |

## 4.2 Carrier account mapping

| Source Column | Target Field | Transform Rule | Required | Notes |
|---|---|---|---:|---|
| `UPS #` | `customer_carrier_accounts` (`carrier_code=UPS`) | Keep as string | No | Create row only if value exists |
| `FED EX #` | `customer_carrier_accounts` (`carrier_code=FEDEX`) | Keep as string | No | |
| `DHL #` | `customer_carrier_accounts` (`carrier_code=DHL`) | Keep as string | No | |
| Purolator field (if present future) | `customer_carrier_accounts` (`carrier_code=PUROLATOR`) | Keep as string | No | Add when source contains it |

---

## 5) Matching and Upsert Keys

## 5.1 Master data keys

- `customers`: upsert by `sold_to_code`
- `ship_to_locations`: upsert by (`customer_id`, `ship_to_code`)
- `customer_carrier_accounts`: upsert by (`customer_id`, `carrier_code`, `account_number`)

## 5.2 Transaction keys

- `delivery_notes`: upsert by `dn_number`
- `delivery_note_lines`: upsert by (`delivery_note_id`, `doc_item`)

---

## 6) Priority and Carry-over Rules (Signed Business Logic)

1. Priority scale: lower number = more urgent (`P1` highest urgency)
2. Daily file priority may arrive empty
3. For DNs already in system and still unshipped (and not cancelled):
   - keep previous `current_priority_no`
   - keep previous `current_status`
4. For newly arrived DNs:
   - assign `max(current_priority_no among open DNs) + 1`
5. Write all system-applied priority assignments into `dn_priority_history`

---

## 7) Status Rules

Recommended controlled statuses:

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

Role ownership:

- Supervisor: prioritize, reprioritize, hold/release
- Picker: picking/picked updates
- Packer: packing/packed updates with message
- Shipper: shipping_in_progress/shipped updates with shipment data

---

## 8) Import Validation Rules

## 8.1 Blocking errors (row rejected)

- Missing `dn_number`
- Missing `doc_item` for line record
- Missing `sold_to_code`
- Invalid numeric parsing on required key fields
- Unresolvable duplicate key conflict within same batch

## 8.2 Non-blocking warnings (row accepted with warning)

- Missing optional dates
- Missing optional quantities/prices
- Unknown country/state formatting
- Unknown ship-to name spelling variation when code is valid

All rejected rows must be written to `import_row_errors`.

---

## 9) Daily Import Process (Execution Order)

1. Create `import_batches` record with `RUNNING`
2. Load source rows into staging structure
3. Validate and classify rows (valid/reject)
4. Upsert `customers` and `ship_to_locations`
5. Upsert `delivery_notes` and `delivery_note_lines`
6. Apply carry-over/new priority rule
7. Update `last_seen_import_batch_id`
8. Log row errors/warnings
9. Complete `import_batches` with counts and status

---

## 10) Open Items for Final Sign-off

- Confirm whether DN status is tracked only at header level or also line level
- Confirm if country fields come from a separate maintained ship-to file/UI
- Confirm Purolator account source column in Shipping IDs file
- Confirm mandatory fields needed before status can move to `SHIPPED`
- Confirm if manual priority override is allowed after picker starts work

---

## 11) Sign-off

- Business Owner: ____________________
- Operations Supervisor: ____________________
- Shipping Lead: ____________________
- IT/Engineering Lead: ____________________
- Date: ____________________

