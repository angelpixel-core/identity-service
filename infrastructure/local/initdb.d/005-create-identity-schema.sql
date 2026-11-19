-- ==============================================================================
-- IDENTITY SERVICE: Schema DDL para PostgreSQL
-- Bounded Context: identity
-- Tablas: users (Multi-Tenant con aislamiento por tenant_id conforme a ADR-0003)
-- ==============================================================================

\c identity_db;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(100) NOT NULL,
    roles TEXT[] NOT NULL DEFAULT '{"member"}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_tenant ON users (email, tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);

\c identity_test_db;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(100) NOT NULL,
    roles TEXT[] NOT NULL DEFAULT '{"member"}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_tenant ON users (email, tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);

