-- Add CSA role for customer / courier-account maintenance.
INSERT INTO roles (code, name, description, sort_order)
VALUES
    ('CSA', 'CSA', 'Customer profiles and courier account maintenance', 15)
ON CONFLICT (code) DO NOTHING;
