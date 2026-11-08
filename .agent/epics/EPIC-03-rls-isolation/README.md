# EPIC-03: PostgreSQL Row-Level Security (RLS) Tenant Isolation Engine

* **ID:** EPIC-03
* **Bounded Context:** `identity` / `tenancy` / `security`
* **Estado:** Completed
* **Arquitectura:** Defense-in-Depth / PostgreSQL RLS Engine + Transactional Context Injection + Zero-Trust Guard
* **Topología de Referencia:** [`.agent/TREE.txt`](../../TREE.txt)

---

## 1. Visión y Definición del Dominio

Esta épica consolida la estrategia de segregación multitenant de base de datos compartida (definida en [ADR-0003](../../../docs/adr/0003-multi-tenant-isolation-strategy.md) y [ADR-0005](../../../docs/adr/0005-postgresql-rls-strategy.md)) hacia un modelo **Enterprise de Defensa en Profundidad (Zero-Trust Defense-in-Depth)**.

Si bien la arquitectura a nivel aplicativo valida exhaustivamente el `tenant_id` mediante Value Objects y cláusulas en repositorios, cualquier omisión involuntaria en consultas manuales o migraciones complejas podría derivar en una fuga de datos entre organizaciones. Con la incorporación de **Row-Level Security (RLS)** directamente en PostgreSQL, el propio motor de persistencia bloquea e invisibiliza las filas que no correspondan al tenant activo en la sesión de base de datos (`app.current_tenant_id`), mientras que los middlewares perimetrales de aplicación neutralizan vectores de enumeración (Anti-Enumeration 404), suplantación de cabeceras e inyecciones SQL.

---

## 2. Alcance y Vertical Slices

### 2.1. Database Tenant Session Context & RLS Policies Migration
* **User Story:** [`US-05: Database Tenant Session Context & RLS Policies Migration`](stories/US-05-tenant-session-rls-migration.md)
* **Estado:** Completed
* **Flujo:** 
  * Migraciones DDL para habilitar RLS en `users` y tablas con discriminador organizativo ([`007-enable-postgresql-rls.sql`](../../../infrastructure/local/initdb.d/007-enable-postgresql-rls.sql)), incorporando la función PL/pgSQL reutilizable `apply_tenant_rls()` y el rol de aplicación `identity_app` (`NOSUPERUSER NOBYPASSRLS`).
  * Estrategia de Connection Pooling: Uso estricto de `SET LOCAL app.current_tenant_id = $1` en transacciones o bloques acotados mediante [`TenantAwareTransactionRunner`](../../../src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner.ts), con soporte para Savepoints anidados y prevención de contaminación de conexiones del pool.
* **Guía y Artículos:**
  * [GUIDELINE-06: PostgreSQL RLS Isolation](../../guidelines/GUIDELINE-06-postgresql-rls-isolation.md)
  * [ARTICLE-05: Aislamiento Multi-Tenant Nativo con PostgreSQL RLS](../../publications/ARTICLE-05-tenant-session-rls-migration.md)
  * [ARTICLE-05-B: Bucle de Refactorización Inside-Out en US-05](../../publications/ARTICLE-05-B-refactoring-tenant-session-rls.md)

### 2.2. Zero-Trust Cross-Tenant Penetration and Isolation Test Harness
* **User Story:** [`US-06: Cross-Tenant Zero-Trust Data Access Guard & Security Audit Logger`](stories/US-06-cross-tenant-zero-trust-guard.md)
* **Estado:** Completed
* **Flujo:** 
  * Middleware perimetral `createCrossTenantGuard` y enriquecimiento de `createAuthMiddleware` para comparar el claim de tenant autenticado contra `params`, `body` y `query`. Emisión automática de eventos de auditoría `cross_tenant_violation` y bloqueo inmediato con HTTP 403 Forbidden.
  * Política Anti-Enumeración estricta en `UserController`: Consultas a usuarios ajenos devuelven idéntico HTTP 404 Not Found (`{"error":"User not found"}`) que a usuarios inexistentes.
  * Bucle de Refactorización Inside-Out: Encapsulación de `User.updateEmail` y desacoplamiento de `UpdateUserProfileCommandHandler` con invalidación de caché.
  * Arnés de penetración en 5 vectores críticos y Living Documentation BDD.
* **Guía y Artículos:**
  * [GUIDELINE-07: Cross-Tenant Zero-Trust Guard & Anti-Enumeration](../../guidelines/GUIDELINE-07-cross-tenant-zero-trust-guard.md)
  * [ARTICLE-06: Arquitectura Zero-Trust Multi-Tenant y Arnés Defensivo](../../publications/ARTICLE-06-cross-tenant-zero-trust-guard.md)
  * [ARTICLE-06-B: Bucle de Refactorización Inside-Out en US-06](../../publications/ARTICLE-06-B-refactoring-cross-tenant-guard.md)

---

## 3. Hoja de Ruta de Implementación

1. **Definición de DDL y Políticas RLS:**
   * Script de migración con activación de RLS forzado (`FORCE ROW LEVEL SECURITY`) y función PL/pgSQL `apply_tenant_rls`.
   * Provisión de rol de aplicación `identity_app` (`NOSUPERUSER NOBYPASSRLS`).
2. **Abstracción de Ejecución Transaccional con Contexto Tenant:**
   * Implementación de `TenantAwareTransactionRunner` con soporte para Savepoints (`SAVEPOINT` / `RELEASE SAVEPOINT`).
   * Higienización de conexiones del pool con `SET LOCAL app.current_tenant_id = $1`.
3. **Refactorización Inside-Out y Desacoplamiento Hexagonal:**
   * Agregados ricos en dominio (`User.updateEmail`, Value Objects inmutables `TenantSessionContext`).
   * Casos de uso desacoplados de persistencia (`UpdateUserProfileCommandHandler`, `GetUserProfileQueryHandler`).
   * Controladores delgados (*thin controllers*) con mapeo determinista de códigos HTTP.
4. **Harness de Pruebas de Penetración y Living Documentation:**
   * Suite de pruebas de penetración en 5 vectores ([`test_cross_tenant_penetration.ts`](../../../tests/integration/security/test_cross_tenant_penetration.ts)).
   * Especificaciones BDD Cucumber ([`cross_tenant_zero_trust.feature`](../../../tests/acceptance/features/cross_tenant_zero_trust.feature)).
5. **Testing & Calidad Piramidal:**
   * 100% GREEN en todas las suites: Unit (160 tests), Integration (67 tests), Acceptance BDD (18 tests), E2E (24 tests), SDK (27 tests).

---

## 4. Definición de Hecho (Definition of Done - DoD)

- [x] Políticas RLS activas en todas las tablas con datos sensibles de tenant (`users`).
- [x] Pruebas automatizadas de penetración multitenant pasando al 100%.
- [x] Cero fugas de variables de sesión en el connection pool (`SET LOCAL` verificado).
- [x] Trazabilidad en [`TRACEABILITY_MATRIX.md`](../../memory/TRACEABILITY_MATRIX.md) con estado `Completed`.
- [x] Artículos técnicos y guías interactivas documentados en `.agent/publications/` y `.agent/guidelines/`.

