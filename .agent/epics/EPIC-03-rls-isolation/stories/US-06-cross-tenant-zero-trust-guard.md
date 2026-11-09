---
id: US-06
title: "Cross-Tenant Zero-Trust Data Access Guard & Security Audit Logger"
epic:
  id: EPIC-03
  name: "PostgreSQL Row-Level Security Isolation Engine"
status: completed
priority: P0
bounded_context: identity
subdomain: tenancy-audit
slice_type: security
timestamps:
  created_at: "2026-11-08T15:00:00-03:00"
  started_at: "2026-11-08T16:00:00-03:00"
  completed_at: "2026-11-08T19:55:00-03:00"
  updated_at: "2026-11-08T19:55:00-03:00"
traceability:
  adrs:
    - docs/adr/0005-postgresql-rls-strategy.md
  guidelines:
    - .agent/guidelines/GUIDELINE-07-cross-tenant-zero-trust-guard.md
  publications:
    - .agent/publications/ARTICLE-06-cross-tenant-zero-trust-guard.md
    - .agent/publications/ARTICLE-06-B-refactoring-cross-tenant-guard.md
  commits:
    - "5211923"
    - "7017633"
    - 06280f3
    - 963edca
    - 9863c38
    - fd1ac59
    - 73f1637
    - 31c1e9c
tags:
  - zero-trust
  - cross-tenant-guard
  - anti-enumeration
  - audit-logger
  - penetration-testing
---

# US-06: Cross-Tenant Zero-Trust Data Access Guard & Audit

**Epic:** [EPIC-03: PostgreSQL Row-Level Security Isolation Engine](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `identity` / `tenancy-audit`  
**Slice Type:** Security / Penetration Test Harness  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  
**ADR Relacionado:** [`ADR-0005: PostgreSQL Row-Level Security Strategy`](../../../docs/adr/0005-postgresql-rls-strategy.md)  
**Guía Interactiva:** [`GUIDELINE-07`](../../guidelines/GUIDELINE-07-cross-tenant-zero-trust-guard.md)  
**Publicaciones:** [`ARTICLE-06`](../../publications/ARTICLE-06-cross-tenant-zero-trust-guard.md), [`ARTICLE-06-B`](../../publications/ARTICLE-06-B-refactoring-cross-tenant-guard.md)

---

## 1. Descripción

**Como** oficial de seguridad de la plataforma,  
**Quiero** disponer de un arnés automatizado de pruebas de penetración cruzada y auditoría contra los repositorios y endpoints de la API,  
**Para** verificar activamente que cualquier intento de forzar lecturas, mutaciones o inyecciones de datos entre organizaciones ajenas sea bloqueado en todas las capas (HTTP, Dominio y Base de Datos) y registrado en logs de auditoría de seguridad.

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Rechazo Inmediato Cross-Tenant en Escritura:** Si un comando intenta insertar o actualizar un registro con un `tenantId` divergente al establecido en el token JWT / contexto autenticado, el sistema debe arrojar una excepción `ForbiddenDomainError` o disparar una violación de política `WITH CHECK` en PostgreSQL.
2. **Invisibilidad en Lectura Cross-Tenant:** Intentar consultar mediante ID un recurso existente que pertenece a otro tenant debe comportarse de forma idéntica a si el recurso no existiera (HTTP 404 Not Found o 0 filas retornadas), evitando divulgación de existencia de recursos ajenos (*enumeration attacks*).
3. **Registro de Auditoría de Intrusión:** Todo intento de acceso anómalo o divergencia entre el `tenant_id` del token y los parámetros de URL debe emitir un log estructurado de advertencia (`SECURITY_AUDIT: CROSS_TENANT_VIOLATION`).

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: Cross-Tenant Zero-Trust Data Access Guard & Audit

  Scenario: Prevent user enumeration across tenant boundaries
    Given an authenticated user belonging to tenant "alpha-corp"
    And an existing user profile with ID "user-999" belonging to tenant "beta-corp"
    When the user requests "/api/v1/users/user-999"
    Then the system should respond with HTTP 404 Not Found
    And no profile data of "beta-corp" should be disclosed

  Scenario: Block cross-tenant update attempts
    Given an authenticated user in tenant "alpha-corp"
    When the user attempts to update a profile in tenant "beta-corp"
    Then the operation must be aborted
    And a security audit event "CROSS_TENANT_VIOLATION" should be logged
```

---

## 4. Cobertura de Pruebas Requerida (Pirámide de Testing)

- [x] **Integration Test 1 (Penetration Suite):** `tests/integration/security/test_cross_tenant_penetration.ts`
  - Ejecutar vectores de ataque simulados (SQL injection en tenant context, manipulación de cabeceras `x-tenant-id`).
- [x] **Acceptance Test (BDD):** `tests/acceptance/features/cross_tenant_zero_trust.feature`
  - Escenario ejecutable con Cucumber.

---

## 5. Trazabilidad de Implementación

- **Seguridad e Interfaces:**
  - `interfaces/http/middlewares/security_audit_logger.ts`
  - `interfaces/http/rest/v1/identity/user_controller.ts`
  - `tests/integration/security/test_cross_tenant_penetration.ts`
  - `tests/acceptance/features/cross_tenant_zero_trust.feature`
  - `tests/acceptance/step_defs/test_cross_tenant_zero_trust_steps.ts`

