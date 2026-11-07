-- ==============================================================================
-- IDENTITY SERVICE: PostgreSQL Row-Level Security (RLS) Migration
-- Bounded Context: identity / tenancy
-- Tablas: users (Multi-Tenant con aislamiento estricto RLS conforme a ADR-0005)
-- ==============================================================================

\c identity_db;

-- Función helper reutilizable para aplicar RLS forzado y política simétrica a cualquier tabla multitenant
CREATE OR REPLACE FUNCTION apply_tenant_rls(target_table text) RETURNS void AS $$
BEGIN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', target_table);
    EXECUTE format(
        'CREATE POLICY tenant_isolation_policy ON %I FOR ALL USING (tenant_id = current_setting(''app.current_tenant_id'', true)::text) WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true)::text)',
        target_table
    );
END;
$$ LANGUAGE plpgsql;

-- 1. Aplicar RLS a tabla users
SELECT apply_tenant_rls('users');

\c identity_test_db;

-- Función helper reutilizable para aplicar RLS forzado y política simétrica a cualquier tabla multitenant
CREATE OR REPLACE FUNCTION apply_tenant_rls(target_table text) RETURNS void AS $$
BEGIN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', target_table);
    EXECUTE format(
        'CREATE POLICY tenant_isolation_policy ON %I FOR ALL USING (tenant_id = current_setting(''app.current_tenant_id'', true)::text) WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true)::text)',
        target_table
    );
END;
$$ LANGUAGE plpgsql;

-- 1. Aplicar RLS a tabla users
SELECT apply_tenant_rls('users');
