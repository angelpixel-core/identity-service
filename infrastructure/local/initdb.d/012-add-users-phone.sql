-- ==============================================================================
-- IDENTITY SERVICE: Users Phone Attribute (US-32 / ADR-0010)
-- Bounded Context: identity / registration
-- ==============================================================================

\c identity_db;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NULL;

\c identity_test_db;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NULL;
