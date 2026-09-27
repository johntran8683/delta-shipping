-- Add TEAM_LEAD role for delivery note supervision (hold/cancel/resume/rush).
INSERT INTO roles (code, name, description, sort_order, is_active, created_at, updated_at)
VALUES
    ('TEAM_LEAD', 'Team Lead', 'Delivery note supervision: hold, cancel, resume, rush', 12, true, NOW(), NOW())
ON CONFLICT (code) DO NOTHING;
