-- ==============================================================================
-- IDENTITY SERVICE: User KYC Verifications (US-37 / ADR-0011)
-- Bounded Context: identity / kyc
-- Zero-Biometric-PII: solo persiste status, level y provider_ref bajo RLS.
-- ==============================================================================

\c identity_db;

CREATE TABLE IF NOT EXISTS user_kyc_verifications (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    tenant_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED')),
    level TEXT NOT NULL CHECK (level IN ('basic', 'biometric_liveness')),
    provider_ref TEXT NULL,
    verified_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_kyc_provider_ref
    ON user_kyc_verifications (provider_ref, tenant_id);

ALTER TABLE user_kyc_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_kyc_verifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_kyc_verifications_isolation_policy ON user_kyc_verifications;
CREATE POLICY user_kyc_verifications_isolation_policy ON user_kyc_verifications
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

CREATE TABLE IF NOT EXISTS user_kyc_verifications (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    tenant_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED')),
    level TEXT NOT NULL CHECK (level IN ('basic', 'biometric_liveness')),
    provider_ref TEXT NULL,
    verified_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_kyc_provider_ref
    ON user_kyc_verifications (provider_ref, tenant_id);

ALTER TABLE user_kyc_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_kyc_verifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_kyc_verifications_isolation_policy ON user_kyc_verifications;
CREATE POLICY user_kyc_verifications_isolation_policy ON user_kyc_verifications
  FOR ALL
  USING (
    current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    current_setting('app.current_tenant_id', true) = 'system'
    OR tenant_id = current_setting('app.current_tenant_id', true)::text
  );
