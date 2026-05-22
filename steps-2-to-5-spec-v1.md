# Steps 2-5 Specification (v1)

This document continues the implementation plan from:

- Step 2: Workflow enums and transition ownership
- Step 3: Priority rule details
- Step 4: Import error policy
- Step 5: DDL approval package

---

## Step 2: Workflow Enums and Transition Ownership

## 2.1 `dn_status` enum (authoritative)

Allowed values:

1. `IMPORTED`
2. `PRIORITIZED`
3. `PICKING`
4. `PICKED`
5. `PACKING`
6. `PACKED`
7. `SHIPPING_IN_PROGRESS`
8. `SHIPPED`
9. `ON_HOLD`
10. `CANCELLED`

## 2.2 Role ownership

- `SUPERVISOR`
  - Set/adjust priority
  - Move to/from `ON_HOLD`
  - Move `IMPORTED -> PRIORITIZED`
  - Cancel/un-cancel if needed
- `PICKER`
  - `PRIORITIZED -> PICKING`
  - `PICKING -> PICKED`
- `PACKER`
  - `PICKED -> PACKING`
  - `PACKING -> PACKED`
  - Add packer comments
- `SHIPPER`
  - `PACKED -> SHIPPING_IN_PROGRESS`
  - `SHIPPING_IN_PROGRESS -> SHIPPED`
  - Add shipper comments and shipment details

## 2.3 Transition matrix

- `IMPORTED -> PRIORITIZED` (SUPERVISOR, SYSTEM)
- `PRIORITIZED -> PICKING` (PICKER)
- `PICKING -> PICKED` (PICKER)
- `PICKED -> PACKING` (PACKER)
- `PACKING -> PACKED` (PACKER)
- `PACKED -> SHIPPING_IN_PROGRESS` (SHIPPER)
- `SHIPPING_IN_PROGRESS -> SHIPPED` (SHIPPER)
- `* -> ON_HOLD` (SUPERVISOR)
- `ON_HOLD -> PRIORITIZED` (SUPERVISOR)
- `* -> CANCELLED` (SUPERVISOR)

Invalid transitions should be blocked and written to audit logs.

---

## Step 3: Priority Rule (Final Detail)

## 3.1 Definition

- Priority stored as integer `current_priority_no`
- Display format `P` + number (for example `P8`)
- Lower number means more urgent

## 3.2 Daily import priority behavior

For each DN in the new daily input:

1. If DN already exists and current status is not `SHIPPED` and not `CANCELLED`:
   - keep existing `current_priority_no`
   - keep existing `current_status`
2. If DN is new:
   - set `current_priority_no = max_priority_open + 1`
   - default status to `IMPORTED` (or `PRIORITIZED` if supervisor approves immediately)

Where:

- `max_priority_open` = maximum `current_priority_no` among open DNs (`is_open = true`)
- If there are no open DNs, use `1`

`is_open` maintenance rule:

- set `is_open = false` when status becomes `SHIPPED` or `CANCELLED`
- otherwise keep `is_open = true`

## 3.3 Optional manual override policy

- Supervisor may override any priority
- Override must create a `dn_priority_history` row with reason and actor

---

## Step 4: Import Error Policy

## 4.1 Severity levels

- `BLOCKER`: row cannot be imported
- `WARNING`: row imported with missing/normalized optional fields
- `INFO`: non-critical normalization notes

## 4.2 Blocker examples

- Missing `DN#` / `Document`
- Missing `Doc Item` / `Document Item` on line record
- Missing `Sold-to`
- Invalid duplicate (`dn_number`, `doc_item`) conflict inside same batch
- Unparseable required key fields

## 4.3 Warning examples

- Missing optional dates
- Missing optional quantity fields
- Missing optional material description
- Country unknown (if optional in source)
- Source header variant auto-mapped

## 4.4 Batch result policy

- `SUCCESS`: no blocker rows
- `PARTIAL`: blocker rows exist but at least one row imported
- `FAILED`: no rows imported due to systemic issue (file unreadable/schema mismatch)

All blocker rows must be written to `import_row_errors`.

---

## Step 5: DDL Approval Package

The SQL schema file is provided at:

- `schema-v1.sql`

It includes:

- enum types (`dn_status`, `batch_status`, `source_type`, `error_severity`)
- identity tables: `users`, `roles`, `user_roles`, `permissions`, `role_permissions` (RBAC)
- operational tables: customers, ship-to, carrier accounts, delivery notes/lines, shipments, import batches
- audit tables: `dn_status_history` uses `actor_user_id` → `users`, `actor_role_id` → `roles`; `dn_priority_history` includes optional `actor_role_id`
- key constraints and FKs from audit/shipment/import columns to `users`
- indexes for operational queries
- update timestamp triggers
- collect-account consistency check in `shipments`

Note: the older `user_role` PostgreSQL enum was removed in favor of the `roles` table so admins can extend mappings without schema enum migrations.

## 5.1 Suggested approval checklist

- [ ] Status enum values approved
- [ ] Role ownership approved
- [ ] Priority carry-over rule approved
- [ ] Import blocker/warning policy approved
- [ ] Table names and field names approved
- [ ] Constraints and indexes approved

---

## Decision Log

- Lower number priority is more urgent: **Confirmed**
- Existing unshipped DNs keep priority/status: **Confirmed**
- New DN priority = max open priority + 1: **Confirmed**
- Packer/Shipper messages stored in status history: **Confirmed**

