-- ==============================================================================
-- IDENTITY SERVICE: PostgreSQL Row-Level Security (RLS) Migration
-- Bounded Context: identity / tenancy
-- Tablas: users (Multi-Tenant con aislamiento estricto RLS conforme a ADR-0005)
-- ==============================================================================

\c identity_db;

-- 1. Habilitar y forzar Row-Level Security en users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- 2. Política simétrica de aislamiento multitenant (USING + WITH CHECK)
DROP POLICY IF EXISTS tenant_isolation_policy ON users;
CREATE POLICY tenant_isolation_policy ON users
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::text)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::text);

\c identity_test_db;

-- 1. Habilitar y forzar Row-Level Security en users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- 2. Política simétrica de aislamiento multitenant (USING + WITH CHECK)
DROP POLICY IF EXISTS tenant_isolation_policy ON users;
CREATE POLICY tenant_isolation_policy ON users
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::text)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::text);
