---
id: US-05
title: "Database Tenant Session Context & RLS Policies Migration"
epic:
  id: EPIC-03
  name: "PostgreSQL Row-Level Security Isolation Engine"
status: completed
priority: P0
bounded_context: identity
subdomain: tenancy
slice_type: infrastructure
timestamps:
  created_at: "2026-11-07T10:00:00-03:00"
  started_at: "2026-11-07T11:00:00-03:00"
  completed_at: "2026-11-08T14:26:00-03:00"
  updated_at: "2026-11-08T18:00:00-03:00"
traceability:
  adrs:
    - docs/adr/0005-postgresql-rls-strategy.md
  guidelines:
    - .agent/guidelines/GUIDELINE-06-postgresql-rls-isolation.md
  publications:
    - .agent/publications/ARTICLE-05-tenant-session-rls-migration.md
    - .agent/publications/ARTICLE-05-B-refactoring-tenant-session-rls.md
  commits:
    - 524ad28
    - 2a03a24
    - b543f99
    - a2ff14e
    - 1f6e3b6
    - b528bac
    - 8901df3
    - 0c7efd1
    - 037c686
    - d14b29b
    - 0940471
    - 88709f4
    - 6be4b5a
    - e84691b
    - 508135e
    - eb03963
    - cae41af
    - d5136f0
tags:
  - postgresql
  - rls
  - row-level-security
  - tenant-isolation
  - transaction-runner
---

# US-05: Database Tenant Session Context & RLS Policies Migration

**Epic:** [EPIC-03: PostgreSQL Row-Level Security Isolation Engine](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `identity` / `tenancy`  
**Slice Type:** Infrastructure / Database Security Migration  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  
**ADR Relacionado:** [`ADR-0005: PostgreSQL Row-Level Security Strategy`](../../../docs/adr/0005-postgresql-rls-strategy.md)  
**Guía Interactiva:** [`GUIDELINE-06`](../../guidelines/GUIDELINE-06-postgresql-rls-isolation.md)  
**Publicaciones:** [`ARTICLE-05`](../../publications/ARTICLE-05-tenant-session-rls-migration.md), [`ARTICLE-05-B`](../../publications/ARTICLE-05-B-refactoring-tenant-session-rls.md)

---

## 1. Descripción

**Como** arquitecto de seguridad e infraestructura,  
**Quiero** habilitar políticas de Row-Level Security (RLS) en las tablas multitenant de PostgreSQL y gestionar el contexto de sesión transaccional mediante `SET LOCAL app.current_tenant_id = $1` sobre el connection pool de Node.js,  
**Para** garantizar que la base de datos filtre de forma nativa e inviolable cualquier acceso a registros que no pertenezcan al tenant activo, evitando fugas de estado entre conexiones reutilizadas.

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Activación Mandatoria de RLS:** Toda tabla que posea una columna discriminadora `tenant_id` (`users`, `user_profiles`, `registered_clients`, `federated_identities`) debe tener RLS habilitado y forzado (`FORCE ROW LEVEL SECURITY`).
2. **Política Determinista de Aislamiento:**
   ```sql
   CREATE POLICY tenant_isolation_policy ON <table>
     FOR ALL
     USING (tenant_id = current_setting('app.current_tenant_id', true)::text)
     WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::text);
   ```
3. **Comportamiento Fail-Closed:** Si una consulta se ejecuta sin haber establecido la variable de configuración `app.current_tenant_id`, `current_setting(..., true)` devolverá `NULL`, bloqueando la visualización o inserción de cualquier registro (0 filas afectadas / error de check).
4. **Ciclo de Vida Transaccional (`SET LOCAL`):** La variable se establece exclusivamente dentro de un bloque transaccional (`BEGIN ... COMMIT / ROLLBACK`). Al finalizar la transacción, el parámetro de sesión expira automáticamente en el motor PostgreSQL, garantizando que la conexión física quede totalmente desvinculada del tenant al volver al pool.

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: Database Tenant Session Context & RLS Policies Migration

  Scenario: Tenant data isolation enforced by PostgreSQL RLS
    Given a user belonging to tenant "alpha-corp" and another user in "beta-corp"
    When a database transaction executes with "SET LOCAL app.current_tenant_id = 'alpha-corp'"
    And a query selects all users with "SELECT * FROM users"
    Then only records belonging to "alpha-corp" should be returned
    And zero records belonging to "beta-corp" should be exposed

  Scenario: Connection pool recycling without residual tenant state
    Given a connection used by tenant "alpha-corp" completes its transaction
    When another transaction executes on the same pooled connection for tenant "beta-corp"
    Then the session parameter should reflect only "beta-corp"
    And no data from "alpha-corp" should leak into the second execution

  Scenario: Fail-closed behavior when tenant context is omitted
    Given a connection where "app.current_tenant_id" was never set
    When an unauthenticated query executes "SELECT * FROM users"
    Then the database should return exactly 0 rows
```

---

## 4. Cobertura de Pruebas Requerida (Pirámide de Testing)

- [x] **Unit Test (Runner & Port Machine):** `tests/unit/identity/infrastructure/database/test_tenant_aware_transaction_runner.ts`
  - Validar con mocks aislados la validación de `TenantId`, ciclo `BEGIN`, `set_config`, `COMMIT`, rollback seguro, liberación garantizada y descarte en pool.
- [x] **Integration Test 1 (RLS Engine Verification):** `tests/integration/security/test_rls_policies.ts`
  - Conectar directamente a PostgreSQL, insertar registros con dos tenants distintos y verificar la restricción al cambiar `SET LOCAL app.current_tenant_id`.
- [x] **Integration Test 2 (Connection Pool Context Runner):** `tests/integration/security/test_tenant_aware_transaction_runner.ts`
  - Validar ciclo de vida transaccional sobre `pg.Pool`, commits, rollbacks automáticos en excepciones y saneamiento de conexión.
- [x] **Acceptance Test (BDD):** `tests/acceptance/features/tenant_rls_isolation.feature` & `tests/acceptance/step_defs/test_tenant_rls_isolation_steps.ts`
  - Escenario ejecutable con Cucumber validando el aislamiento físico a nivel base de datos.
- [x] **E2E Test (Concurrency & Pool Stress):** `tests/e2e/security/tenant_rls_isolation.spec.ts`
  - Validar concurrencia sobre `pg.Pool` ejecutando 50 transacciones en paralelo alternando tenants y comprobando que no existan carreras o contaminación de estado.

---

## 5. Trazabilidad de Implementación

- **Scripts SQL de Migración:**
  - `infrastructure/local/initdb.d/007-enable-postgresql-rls.sql`
- **Componentes de Persistencia:**
  - `src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner.ts`
  - `src/contexts/identity/infrastructure/persistence/repositories/user/postgres_user_repository.ts`

