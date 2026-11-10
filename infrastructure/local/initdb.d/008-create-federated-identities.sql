-- ==============================================================================
-- IDENTITY SERVICE: Schema DDL para Federated Identities (US-11)
-- Bounded Context: identity / federated-provisioning
-- Tablas: federated_identities (Aislamiento por tenant_id con RLS conforme a ADR-0005)
-- ==============================================================================

\c identity_db;

CREATE TABLE IF NOT EXISTS federated_identities (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    external_subject_id VARCHAR(255) NOT NULL,
    external_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_federated_provider_subject ON federated_identities (provider, external_subject_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_federated_user_provider ON federated_identities (user_id, provider);
CREATE INDEX IF NOT EXISTS idx_federated_identities_tenant_id ON federated_identities (tenant_id);

SELECT apply_tenant_rls('federated_identities');

\c identity_test_db;

CREATE TABLE IF NOT EXISTS federated_identities (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    external_subject_id VARCHAR(255) NOT NULL,
    external_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_federated_provider_subject ON federated_identities (provider, external_subject_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_federated_user_provider ON federated_identities (user_id, provider);
CREATE INDEX IF NOT EXISTS idx_federated_identities_tenant_id ON federated_identities (tenant_id);

SELECT apply_tenant_rls('federated_identities');
