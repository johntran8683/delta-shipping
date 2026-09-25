-- Mirror of migrations/sql/006_role_csa.sql
INSERT INTO roles (code, name, description, sort_order, is_active, created_at, updated_at)
VALUES
    ('CSA', 'CSA', 'Customer profiles and courier account maintenance', 15, true, NOW(), NOW())
ON CONFLICT (code) DO NOTHING;
