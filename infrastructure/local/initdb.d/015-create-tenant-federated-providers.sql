-- ==============================================================================
-- IDENTITY SERVICE: Per-Tenant Federated Provider Registry (US-33 / EPIC-05)
-- Bounded Context: identity / federation
-- Tabla: tenant_federated_providers con aislamiento estricto RLS Fail-Closed
-- ==============================================================================

\c identity_db;

CREATE TABLE IF NOT EXISTS tenant_federated_providers (
    id UUID PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    protocol TEXT NOT NULL CHECK (protocol IN ('oidc', 'oauth2')),
    issuer_url TEXT NOT NULL,
    authorization_endpoint TEXT NULL,
    token_endpoint TEXT NULL,
    jwks_uri TEXT NULL,
    client_id TEXT NOT NULL,
    encrypted_client_secret TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{"openid","email","profile"}',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, provider_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_federated_providers_tenant
    ON tenant_federated_providers (tenant_id);

ALTER TABLE tenant_federated_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_federated_providers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_federated_providers_isolation_policy ON tenant_federated_providers;
CREATE POLICY tenant_federated_providers_isolation_policy ON tenant_federated_providers
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

CREATE TABLE IF NOT EXISTS tenant_federated_providers (
    id UUID PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    protocol TEXT NOT NULL CHECK (protocol IN ('oidc', 'oauth2')),
    issuer_url TEXT NOT NULL,
    authorization_endpoint TEXT NULL,
    token_endpoint TEXT NULL,
    jwks_uri TEXT NULL,
    client_id TEXT NOT NULL,
    encrypted_client_secret TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{"openid","email","profile"}',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, provider_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_federated_providers_tenant
    ON tenant_federated_providers (tenant_id);

ALTER TABLE tenant_federated_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_federated_providers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_federated_providers_isolation_policy ON tenant_federated_providers;
CREATE POLICY tenant_federated_providers_isolation_policy ON tenant_federated_providers
  FOR ALL
  USING (
    current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  );
