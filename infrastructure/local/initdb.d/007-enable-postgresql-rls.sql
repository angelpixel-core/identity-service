-- ==============================================================================
-- IDENTITY SERVICE: PostgreSQL Row-Level Security (RLS) Migration
-- Bounded Context: identity / tenancy
-- Tablas: users (Multi-Tenant con aislamiento estricto RLS conforme a ADR-0005)
-- ==============================================================================

\c identity_db;

-- 1. Rol de aplicación no-superadministrador para forzar evaluación RLS
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_app') THEN
    CREATE ROLE identity_app WITH LOGIN PASSWORD 'identity_app_pass_2026' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO identity_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO identity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO identity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO identity_app;

-- 2. Función helper reutilizable para aplicar RLS forzado y política simétrica a cualquier tabla multitenant
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

-- 3. Aplicar RLS a tabla users
SELECT apply_tenant_rls('users');

\c identity_test_db;

-- 1. Rol de aplicación no-superadministrador en base de datos de pruebas
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_app') THEN
    CREATE ROLE identity_app WITH LOGIN PASSWORD 'identity_app_pass_2026' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO identity_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO identity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO identity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO identity_app;

-- 2. Función helper reutilizable para aplicar RLS forzado y política simétrica a cualquier tabla multitenant
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

-- 3. Aplicar RLS a tabla users
SELECT apply_tenant_rls('users');
