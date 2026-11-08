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

-- Semillas de clientes por defecto para desarrollo local y testing
INSERT INTO registered_clients (
    id, client_id, client_secret_hash, client_name, client_type,
    allowed_origins, redirect_uris, allowed_grant_types, scopes, is_active
) VALUES 
(
    'client-seed-1',
    'portal-web',
    NULL,
    'AngelSolutions Web Portal',
    'public',
    ARRAY['https://portal.angelsolutions.io'],
    ARRAY['https://portal.angelsolutions.io/callback'],
    ARRAY['authorization_code', 'refresh_token'],
    ARRAY['openid', 'profile', 'email'],
    true
),
(
    'client-seed-2',
    'legacy-app',
    NULL,
    'Legacy Portal App',
    'public',
    ARRAY['https://legacy.angelsolutions.io'],
    ARRAY['https://legacy.angelsolutions.io/callback'],
    ARRAY['authorization_code'],
    ARRAY['openid'],
    false
),
(
    'client-seed-3',
    'm2m-service-app',
    '$2b$06$xEZUS7jmJ1CcedNxhaSU5.FoviZ/lI0sZ49qR8kQgSiwirWZohsTi',
    'Machine to Machine Service Worker',
    'confidential',
    ARRAY[]::TEXT[],
    ARRAY[]::TEXT[],
    ARRAY['client_credentials'],
    ARRAY['identity:read', 'identity:write', 'audit:log'],
    true
)
ON CONFLICT (client_id) DO NOTHING;

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

-- Semillas de clientes por defecto para base de datos de pruebas
INSERT INTO registered_clients (
    id, client_id, client_secret_hash, client_name, client_type,
    allowed_origins, redirect_uris, allowed_grant_types, scopes, is_active
) VALUES 
(
    'client-seed-1',
    'portal-web',
    NULL,
    'AngelSolutions Web Portal',
    'public',
    ARRAY['https://portal.angelsolutions.io'],
    ARRAY['https://portal.angelsolutions.io/callback'],
    ARRAY['authorization_code', 'refresh_token'],
    ARRAY['openid', 'profile', 'email'],
    true
),
(
    'client-seed-2',
    'legacy-app',
    NULL,
    'Legacy Portal App',
    'public',
    ARRAY['https://legacy.angelsolutions.io'],
    ARRAY['https://legacy.angelsolutions.io/callback'],
    ARRAY['authorization_code'],
    ARRAY['openid'],
    false
),
(
    'client-seed-3',
    'm2m-service-app',
    '$2b$06$xEZUS7jmJ1CcedNxhaSU5.FoviZ/lI0sZ49qR8kQgSiwirWZohsTi',
    'Machine to Machine Service Worker',
    'confidential',
    ARRAY[]::TEXT[],
    ARRAY[]::TEXT[],
    ARRAY['client_credentials'],
    ARRAY['identity:read', 'identity:write', 'audit:log'],
    true
)
ON CONFLICT (client_id) DO NOTHING;

