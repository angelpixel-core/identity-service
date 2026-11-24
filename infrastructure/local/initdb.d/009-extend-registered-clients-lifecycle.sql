-- ==============================================================================
-- IDENTITY SERVICE: Client Lifecycle Management & Secret Rotation (US-28)
-- Bounded Context: identity / client-registry
-- Extiende registered_clients con tenant_id, client_profile, status,
-- previous_secret_hash, secret_grace_expires_at y política RLS.
-- ==============================================================================

\c identity_db;

ALTER TABLE registered_clients
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'acme-corp',
  ADD COLUMN IF NOT EXISTS client_profile VARCHAR(20) NOT NULL DEFAULT 'spa',
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS previous_secret_hash VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS secret_grace_expires_at TIMESTAMP WITH TIME ZONE NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_registered_clients_profile'
  ) THEN
    ALTER TABLE registered_clients
      ADD CONSTRAINT chk_registered_clients_profile
      CHECK (client_profile IN ('spa', 'web', 'native', 'm2m'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_registered_clients_status'
  ) THEN
    ALTER TABLE registered_clients
      ADD CONSTRAINT chk_registered_clients_status
      CHECK (status IN ('active', 'suspended'));
  END IF;
END
$$;

UPDATE registered_clients
SET
  client_profile = CASE WHEN client_type = 'confidential' THEN 'm2m' ELSE 'spa' END,
  status = CASE WHEN is_active THEN 'active' ELSE 'suspended' END;

CREATE INDEX IF NOT EXISTS idx_registered_clients_tenant_id ON registered_clients (tenant_id);

ALTER TABLE registered_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE registered_clients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS registered_clients_tenant_policy ON registered_clients;
CREATE POLICY registered_clients_tenant_policy ON registered_clients
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  );

\c identity_test_db;

ALTER TABLE registered_clients
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'acme-corp',
  ADD COLUMN IF NOT EXISTS client_profile VARCHAR(20) NOT NULL DEFAULT 'spa',
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS previous_secret_hash VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS secret_grace_expires_at TIMESTAMP WITH TIME ZONE NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_registered_clients_profile'
  ) THEN
    ALTER TABLE registered_clients
      ADD CONSTRAINT chk_registered_clients_profile
      CHECK (client_profile IN ('spa', 'web', 'native', 'm2m'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_registered_clients_status'
  ) THEN
    ALTER TABLE registered_clients
      ADD CONSTRAINT chk_registered_clients_status
      CHECK (status IN ('active', 'suspended'));
  END IF;
END
$$;

UPDATE registered_clients
SET
  client_profile = CASE WHEN client_type = 'confidential' THEN 'm2m' ELSE 'spa' END,
  status = CASE WHEN is_active THEN 'active' ELSE 'suspended' END;

CREATE INDEX IF NOT EXISTS idx_registered_clients_tenant_id ON registered_clients (tenant_id);

ALTER TABLE registered_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE registered_clients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS registered_clients_tenant_policy ON registered_clients;
CREATE POLICY registered_clients_tenant_policy ON registered_clients
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  );
