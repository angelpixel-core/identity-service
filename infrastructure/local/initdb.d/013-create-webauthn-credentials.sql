-- ==============================================================================
-- IDENTITY SERVICE: WebAuthn / FIDO2 Passkey Credentials (US-35 / ADR-0011)
-- Bounded Context: identity / webauthn
-- Zero-Biometric-PII: solo almacena public_key_cose (BYTEA) y metadatos.
-- ==============================================================================

\c identity_db;

CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    tenant_id TEXT NOT NULL,
    credential_id TEXT NOT NULL UNIQUE,
    public_key_cose BYTEA NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    transports TEXT[] NOT NULL DEFAULT '{}',
    device_type TEXT NOT NULL,
    backed_up BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_tenant
    ON webauthn_credentials (user_id, tenant_id);

ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_credentials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webauthn_credentials_isolation_policy ON webauthn_credentials;
CREATE POLICY webauthn_credentials_isolation_policy ON webauthn_credentials
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

CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    tenant_id TEXT NOT NULL,
    credential_id TEXT NOT NULL UNIQUE,
    public_key_cose BYTEA NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    transports TEXT[] NOT NULL DEFAULT '{}',
    device_type TEXT NOT NULL,
    backed_up BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_tenant
    ON webauthn_credentials (user_id, tenant_id);

ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_credentials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webauthn_credentials_isolation_policy ON webauthn_credentials;
CREATE POLICY webauthn_credentials_isolation_policy ON webauthn_credentials
  FOR ALL
  USING (
    current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  );
