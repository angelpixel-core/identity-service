-- ==============================================================================
-- IDENTITY SERVICE: Schema DDL para Registered Clients (Client Registry)
-- Bounded Context: identity / client-registry
-- Tablas: registered_clients (conforme a ADR-0004)
-- ==============================================================================

\c identity_db;

CREATE TABLE IF NOT EXISTS registered_clients (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(100) NOT NULL UNIQUE,
    client_secret_hash VARCHAR(255),
    client_name VARCHAR(150) NOT NULL,
    client_type VARCHAR(20) NOT NULL CHECK (client_type IN ('confidential', 'public')),
    allowed_origins TEXT[] NOT NULL DEFAULT '{}',
    redirect_uris TEXT[] NOT NULL DEFAULT '{}',
    allowed_grant_types TEXT[] NOT NULL DEFAULT '{}',
    scopes TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_registered_clients_client_id ON registered_clients (client_id);

\c identity_test_db;

CREATE TABLE IF NOT EXISTS registered_clients (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(100) NOT NULL UNIQUE,
    client_secret_hash VARCHAR(255),
    client_name VARCHAR(150) NOT NULL,
    client_type VARCHAR(20) NOT NULL CHECK (client_type IN ('confidential', 'public')),
    allowed_origins TEXT[] NOT NULL DEFAULT '{}',
    redirect_uris TEXT[] NOT NULL DEFAULT '{}',
    allowed_grant_types TEXT[] NOT NULL DEFAULT '{}',
    scopes TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_registered_clients_client_id ON registered_clients (client_id);

