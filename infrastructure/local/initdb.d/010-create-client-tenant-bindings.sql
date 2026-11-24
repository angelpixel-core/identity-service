-- ==============================================================================
-- IDENTITY SERVICE: Multi-Tenant / Multi-Domain Client Bindings (US-29)
-- Bounded Context: identity / client-registry
-- Tabla: client_tenant_bindings (N:M Client <-> Tenant / Custom Domain) + RLS
-- ==============================================================================

\c identity_db;

CREATE TABLE IF NOT EXISTS client_tenant_bindings (
    id UUID PRIMARY KEY,
    client_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    custom_domain TEXT NULL UNIQUE,
    allowed_redirect_uris TEXT[] NOT NULL DEFAULT '{}',
    allowed_cors_origins TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (client_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_ctb_client_id ON client_tenant_bindings (client_id);
CREATE INDEX IF NOT EXISTS idx_ctb_tenant_id ON client_tenant_bindings (tenant_id);

ALTER TABLE client_tenant_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_tenant_bindings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_tenant_bindings_policy ON client_tenant_bindings;
CREATE POLICY client_tenant_bindings_policy ON client_tenant_bindings
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

CREATE TABLE IF NOT EXISTS client_tenant_bindings (
    id UUID PRIMARY KEY,
    client_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    custom_domain TEXT NULL UNIQUE,
    allowed_redirect_uris TEXT[] NOT NULL DEFAULT '{}',
    allowed_cors_origins TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (client_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_ctb_client_id ON client_tenant_bindings (client_id);
CREATE INDEX IF NOT EXISTS idx_ctb_tenant_id ON client_tenant_bindings (tenant_id);

ALTER TABLE client_tenant_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_tenant_bindings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_tenant_bindings_policy ON client_tenant_bindings;
CREATE POLICY client_tenant_bindings_policy ON client_tenant_bindings
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
