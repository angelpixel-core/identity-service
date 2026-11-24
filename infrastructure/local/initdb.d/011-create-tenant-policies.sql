-- ==============================================================================
-- IDENTITY SERVICE: Tenant Policies & Capabilities (US-30 / ADR-0010)
-- Bounded Context: identity / tenant-policy
-- Tabla: tenant_policies con aislamiento estricto RLS Fail-Closed
-- ==============================================================================

\c identity_db;

CREATE TABLE IF NOT EXISTS tenant_policies (
    tenant_id TEXT PRIMARY KEY,
    required_attributes JSONB NOT NULL DEFAULT '{"phone": false}',
    kyc_policy JSONB NOT NULL DEFAULT '{"required": false, "minLevel": "basic"}',
    allowed_auth_methods JSONB NOT NULL DEFAULT '{"password": true, "passkeys": false, "federatedOidc": true}',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_by TEXT NOT NULL
);

ALTER TABLE tenant_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_policies_isolation_policy ON tenant_policies;
CREATE POLICY tenant_policies_isolation_policy ON tenant_policies
  FOR ALL
  USING (
    current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  );

\c identity_test_db;

CREATE TABLE IF NOT EXISTS tenant_policies (
    tenant_id TEXT PRIMARY KEY,
    required_attributes JSONB NOT NULL DEFAULT '{"phone": false}',
    kyc_policy JSONB NOT NULL DEFAULT '{"required": false, "minLevel": "basic"}',
    allowed_auth_methods JSONB NOT NULL DEFAULT '{"password": true, "passkeys": false, "federatedOidc": true}',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_by TEXT NOT NULL
);

ALTER TABLE tenant_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_policies_isolation_policy ON tenant_policies;
CREATE POLICY tenant_policies_isolation_policy ON tenant_policies
  FOR ALL
  USING (
    current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  );
