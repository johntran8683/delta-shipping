-- Shipping Operations Schema v1
-- PostgreSQL
--
-- Includes: identity & access (users, roles, permissions), operations, audit, imports.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================
-- Enums
-- =========================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dn_status') THEN
        CREATE TYPE dn_status AS ENUM (
            'IMPORTED',
            'PRIORITIZED',
            'PICKING',
            'PICKED',
            'PACKING',
            'PACKED',
            'SHIPPING_IN_PROGRESS',
            'SHIPPED',
            'ON_HOLD',
            'CANCELLED'
        );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'batch_status') THEN
        CREATE TYPE batch_status AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'source_type') THEN
        CREATE TYPE source_type AS ENUM ('DAILY_DN', 'SHIPPING_IDS');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'error_severity') THEN
        CREATE TYPE error_severity AS ENUM ('BLOCKER', 'WARNING', 'INFO');
    END IF;
END $$;

-- =========================
-- Utility trigger
-- =========================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================
-- Identity & access (RBAC)
-- =========================

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(80) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id
ON role_permissions (permission_id);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255),
    password_hash VARCHAR(255),
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles (role_id);

DROP TRIGGER IF EXISTS trg_roles_updated_at ON roles;
CREATE TRIGGER trg_roles_updated_at
BEFORE UPDATE ON roles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Seed roles (idempotent by code)
INSERT INTO roles (code, name, description, sort_order)
VALUES
    ('SUPERVISOR', 'Supervisor', 'Priority, hold, import, overrides', 10),
    ('CSA', 'CSA', 'Customer profiles and courier account maintenance', 15),
    ('PICKER', 'Picker', 'Pick queue and pick completion', 20),
    ('PACKER', 'Packer', 'Pack queue and pack completion', 30),
    ('SHIPPER', 'Shipper', 'Shipment creation and shipped', 40),
    ('SYSTEM', 'System', 'Automated import and jobs', 5)
ON CONFLICT (code) DO NOTHING;

-- Minimal permission seeds (extend in app or migrations)
INSERT INTO permissions (code, description)
VALUES
    ('import.daily_dn', 'Import daily DN file'),
    ('dn.priority.set', 'Set or change DN priority'),
    ('dn.status.pick', 'Update status for picking workflow'),
    ('dn.status.pack', 'Update status for packing workflow'),
    ('shipment.create', 'Create shipment / mark shipped'),
    ('report.read', 'View operational reports')
ON CONFLICT (code) DO NOTHING;

-- Wire permissions to roles (idempotent; extend in migrations)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'import.daily_dn' WHERE r.code = 'SUPERVISOR'
ON CONFLICT (role_id, permission_id) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'dn.priority.set' WHERE r.code = 'SUPERVISOR'
ON CONFLICT (role_id, permission_id) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'dn.status.pick' WHERE r.code = 'SUPERVISOR'
ON CONFLICT (role_id, permission_id) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'dn.status.pack' WHERE r.code = 'SUPERVISOR'
ON CONFLICT (role_id, permission_id) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'shipment.create' WHERE r.code = 'SUPERVISOR'
ON CONFLICT (role_id, permission_id) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'report.read' WHERE r.code = 'SUPERVISOR'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'dn.status.pick' WHERE r.code = 'PICKER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'dn.status.pack' WHERE r.code = 'PACKER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'shipment.create' WHERE r.code = 'SHIPPER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'import.daily_dn' WHERE r.code = 'SYSTEM'
ON CONFLICT (role_id, permission_id) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'report.read' WHERE r.code = 'SYSTEM'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =========================
-- Import control
-- =========================

CREATE TABLE IF NOT EXISTS import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type source_type NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_checksum VARCHAR(128),
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    status batch_status NOT NULL DEFAULT 'RUNNING',
    total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
    success_rows INTEGER NOT NULL DEFAULT 0 CHECK (success_rows >= 0),
    error_rows INTEGER NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    summary_message TEXT
);

CREATE TABLE IF NOT EXISTS import_row_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    sheet_name VARCHAR(120),
    row_number INTEGER,
    error_code VARCHAR(60) NOT NULL,
    severity error_severity NOT NULL DEFAULT 'BLOCKER',
    error_message TEXT NOT NULL,
    raw_row_json JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_row_errors_batch_id
ON import_row_errors (batch_id);

-- =========================
-- Master data
-- =========================

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sold_to_code VARCHAR(30) NOT NULL UNIQUE,
    sold_to_name VARCHAR(255) NOT NULL,
    fed_id_number VARCHAR(50),
    default_contact_name VARCHAR(120),
    default_phone VARCHAR(50),
    default_email VARCHAR(255),
    shipping_preference TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ship_to_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    ship_to_code VARCHAR(30) NOT NULL,
    ship_to_name VARCHAR(255) NOT NULL,
    street1 VARCHAR(255),
    street2 VARCHAR(255),
    city VARCHAR(120),
    state_region VARCHAR(120),
    postal_code VARCHAR(30),
    country_code VARCHAR(10),
    country_name VARCHAR(120),
    contact_name VARCHAR(120),
    phone VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ship_to_per_customer UNIQUE (customer_id, ship_to_code)
);

CREATE TABLE IF NOT EXISTS customer_carrier_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    carrier_code VARCHAR(30) NOT NULL,
    account_number VARCHAR(80) NOT NULL,
    is_collect_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_customer_carrier_account UNIQUE (customer_id, carrier_code, account_number)
);

CREATE INDEX IF NOT EXISTS idx_ship_to_customer_id
ON ship_to_locations (customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_carrier_customer_id
ON customer_carrier_accounts (customer_id);

-- =========================
-- Delivery notes
-- =========================

CREATE TABLE IF NOT EXISTS delivery_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dn_number VARCHAR(30) NOT NULL UNIQUE,
    sold_to_code VARCHAR(30) NOT NULL,
    ship_to_code VARCHAR(30) NOT NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
    ship_to_location_id UUID REFERENCES ship_to_locations(id) ON DELETE RESTRICT,
    current_priority_no INTEGER CHECK (current_priority_no >= 1),
    current_status dn_status NOT NULL DEFAULT 'IMPORTED',
    credit_status VARCHAR(10),
    shipping_type VARCHAR(120),
    currency_code VARCHAR(10),
    dn_create_date DATE,
    requested_delivery_date DATE,
    projected_ship_date DATE,
    po_date DATE,
    customer_po VARCHAR(80),
    ship_to_region_state VARCHAR(120),
    picking_started_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    last_seen_import_batch_id UUID REFERENCES import_batches(id) ON DELETE RESTRICT,
    is_open BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_note_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_note_id UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
    doc_item INTEGER NOT NULL,
    so_number VARCHAR(30),
    material_code VARCHAR(80),
    material_description TEXT,
    order_qty NUMERIC(18,4),
    open_qty NUMERIC(18,4),
    shipped_qty NUMERIC(18,4),
    unit_price NUMERIC(18,4),
    line_amount NUMERIC(18,4),
    delivery_date DATE,
    material_type VARCHAR(40),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_dn_doc_item UNIQUE (delivery_note_id, doc_item)
);

CREATE INDEX IF NOT EXISTS idx_delivery_notes_status_priority
ON delivery_notes (current_status, current_priority_no);

CREATE INDEX IF NOT EXISTS idx_delivery_notes_open
ON delivery_notes (is_open);

CREATE INDEX IF NOT EXISTS idx_delivery_notes_customer_ship_to
ON delivery_notes (sold_to_code, ship_to_code);

CREATE INDEX IF NOT EXISTS idx_delivery_notes_picking_claimer_status
ON delivery_notes (picking_started_by_user_id, current_status);

CREATE INDEX IF NOT EXISTS idx_delivery_note_lines_dn
ON delivery_note_lines (delivery_note_id);

-- Part master (minimal): one canonical record per part number, seeded from
-- delivery-note line history + the item-weights spreadsheet. Codes are stored
-- normalized (trimmed + uppercased) by the application.
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(80) NOT NULL,
    description VARCHAR(255),
    unit_price NUMERIC(18,4),
    weight_lb NUMERIC(18,4),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_products_code UNIQUE (code)
);

-- =========================
-- Audit history
-- =========================

CREATE TABLE IF NOT EXISTS dn_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_note_id UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
    from_status dn_status,
    to_status dn_status NOT NULL,
    message TEXT,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    source VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
);

CREATE TABLE IF NOT EXISTS dn_priority_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_note_id UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
    from_priority_no INTEGER CHECK (from_priority_no IS NULL OR from_priority_no >= 1),
    to_priority_no INTEGER NOT NULL CHECK (to_priority_no >= 1),
    reason TEXT,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    source VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
);

CREATE INDEX IF NOT EXISTS idx_dn_status_history_dn_changed_at
ON dn_status_history (delivery_note_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_dn_priority_history_dn_changed_at
ON dn_priority_history (delivery_note_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_dn_status_history_actor
ON dn_status_history (actor_user_id, actor_role_id, changed_at DESC);

-- =========================
-- Shipment execution
-- =========================

CREATE TABLE IF NOT EXISTS shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_note_id UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
    carrier_code VARCHAR(30) NOT NULL,
    service_level VARCHAR(80),
    payment_method VARCHAR(20) NOT NULL,
    collect_account_number VARCHAR(80),
    tracking_number VARCHAR(80),
    shipment_reference VARCHAR(120),
    ship_date DATE NOT NULL,
    shipper_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_collect_account_required
    CHECK (
        payment_method <> 'COLLECT'
        OR (payment_method = 'COLLECT' AND collect_account_number IS NOT NULL AND length(trim(collect_account_number)) > 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_shipments_dn
ON shipments (delivery_note_id);

CREATE INDEX IF NOT EXISTS idx_shipments_tracking
ON shipments (tracking_number);

-- =========================
-- Update timestamp triggers
-- =========================

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ship_to_locations_updated_at ON ship_to_locations;
CREATE TRIGGER trg_ship_to_locations_updated_at
BEFORE UPDATE ON ship_to_locations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_customer_carrier_accounts_updated_at ON customer_carrier_accounts;
CREATE TRIGGER trg_customer_carrier_accounts_updated_at
BEFORE UPDATE ON customer_carrier_accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_delivery_notes_updated_at ON delivery_notes;
CREATE TRIGGER trg_delivery_notes_updated_at
BEFORE UPDATE ON delivery_notes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_delivery_note_lines_updated_at ON delivery_note_lines;
CREATE TRIGGER trg_delivery_note_lines_updated_at
BEFORE UPDATE ON delivery_note_lines
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_shipments_updated_at ON shipments;
CREATE TRIGGER trg_shipments_updated_at
BEFORE UPDATE ON shipments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =========================
-- User UI preferences (optional; Prisma also manages this table)
-- =========================

CREATE TABLE IF NOT EXISTS user_ui_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    delivery_notes_visible_columns JSONB,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_user_ui_preferences_updated_at ON user_ui_preferences;
CREATE TRIGGER trg_user_ui_preferences_updated_at
BEFORE UPDATE ON user_ui_preferences
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
