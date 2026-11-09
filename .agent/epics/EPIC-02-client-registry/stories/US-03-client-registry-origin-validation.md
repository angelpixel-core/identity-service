---
id: US-03
title: "Dynamic Client Registry and Origin Validation"
epic:
  id: EPIC-02
  name: "Client Registry & Service Authorization"
status: completed
priority: P1
bounded_context: identity
subdomain: client-registry
slice_type: command-query
timestamps:
  created_at: "2026-11-05T12:00:00-03:00"
  started_at: "2026-11-05T13:00:00-03:00"
  completed_at: "2026-11-06T13:08:00-03:00"
  updated_at: "2026-11-08T18:00:00-03:00"
traceability:
  adrs:
    - docs/adr/0004-client-registry-authorization.md
  guidelines: []
  publications:
    - .agent/publications/ARTICLE-03-client-registry.md
    - .agent/publications/ARTICLE-03-B-refactoring-client-registry.md
  commits:
    - c4f5bb3
    - 3acc136
    - 89ca254
    - 9abee7e
    - ebea58c
    - 0f86b19
    - bd7baa7
    - abf5b23
    - 468d0de
    - 91ec3df
    - b8f1bf5
    - 63c515f
tags:
  - oauth2
  - client-registry
  - origin-validation
  - cors-defense
  - spa
---

# US-03: Dynamic Client Registry and Origin Validation

**Epic:** [EPIC-02: Client Registry & Service Authorization](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `identity` / `client-registry`  
**Slice Type:** Command & Query (Client Registry Slice)  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  
**ADR Relacionado:** [`ADR-0004: Client Registry and Service Authorization`](../../../docs/adr/0004-client-registry-authorization.md)  
**Publicaciones:** [`ARTICLE-03`](../../publications/ARTICLE-03-client-registry.md), [`ARTICLE-03-B`](../../publications/ARTICLE-03-B-refactoring-client-registry.md)

---

## 1. Descripción

**Como** operador de seguridad o aplicación consumidora del ecosistema,  
**Quiero** registrar y validar aplicaciones clientes (`client_id`, tipo `confidential` o `public`, orígenes permitidos y URIs de redirección),  
**Para** garantizar que únicamente aplicaciones autorizadas e identificadas puedan interactuar con el Identity Provider y mitigar suplantaciones de origen o redirecciones maliciosas.

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Unicidad de `client_id`:** Cada aplicación cliente posee un identificador único global en formato alfanumérico o kebab-case.
2. **Diferenciación de Tipo de Cliente:**
   * Clientes `confidential` deben poseer un `client_secret` con longitud mínima de 32 caracteres, almacenado exclusivamente mediante hashing seguro (Argon2id/Bcrypt).
   * Clientes `public` no poseen `client_secret` y su uso requiere de forma obligatoria el parámetro PKCE `code_challenge` en flujos de autorización.
3. **Validación Estricta de Orígenes (`allowed_origins`):** Si una petición HTTP entrante incluye cabecera `Origin` o `Referer`, debe coincidir exactamente con alguno de los dominios registrados para dicho `client_id`.
4. **Validación de Redirección (`redirect_uris`):** En flujos interactivos, la URI de retorno solicitada debe coincidir de manera exacta (esquema, host, puerto y ruta) con las registradas.
5. **Estado Activo:** Peticiones provenientes de clientes con `is_active = false` son rechazadas de inmediato con error `unauthorized_client`.

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: Dynamic Client Registry and Origin Validation

  Scenario: Successful validation of a registered public SPA client
    Given a registered client "portal-web" of type "public" with allowed origin "https://portal.angelpixel.io"
    When the client initiates an authorization request from origin "https://portal.angelpixel.io"
    Then the client authorization middleware should accept the request
    And propagate the client context downstream

  Scenario: Rejection of unregistered origin for a valid client
    Given a registered client "portal-web" with allowed origin "https://portal.angelpixel.io"
    When an unauthorized site "https://malicious-site.com" attempts to make a request with client_id "portal-web"
    Then the system should reject the request with HTTP 403 Forbidden
    And return an error code "unauthorized_client_origin"

  Scenario: Rejection of inactive client application
    Given a client "legacy-app" marked as inactive
    When the client attempts to authenticate
    Then the system should reject the request with HTTP 401 Unauthorized
    And return an error code "client_deactivated"
```

---

## 4. Cobertura de Pruebas Requerida (Pirámide de Testing)

- [x] **End-to-End Test (E2E / Client Origin):** `tests/e2e/web/client_registry_origin.spec.tsx` (`91ec3df`)
  - Validar de extremo a extremo que el cliente frontend no pueda operar contra la API si su origen no está homologado en `registered_clients`.
- [x] **Acceptance Test (BDD):** `tests/acceptance/features/client_registry_validation.feature` (`468d0de`)
  - Ejecutar escenarios BDD de validación de clientes y orígenes en lenguaje ubicuo.
- [x] **Integration Test 1 (Postgres Repository):** `tests/integration/identity/repositories/test_postgres_client_repository.ts` (`0f86b19`)
  - Persistir y consultar un cliente registrado verificando la correcta recuperación de arrays de orígenes y tipos.
- [x] **Integration Test 2 (Middleware Express):** `tests/integration/identity/interfaces/test_client_authorization_middleware.ts` (`bd7baa7`)
  - Validar que peticiones HTTP con cabeceras `Origin` inválidas sean interceptadas con 403.
- [x] **Unit Test 1 (Value Objects):** `tests/unit/identity/domain/client_registry/test_client_id.ts` & `test_origin_domain.ts` (`c4f5bb3`)
  - Validar reglas de sintaxis y restricciones de longitud para `ClientId` y `OriginDomain`.
- [x] **Unit Test 2 (Aggregate):** `tests/unit/identity/domain/client_registry/test_client_application.ts` (`c4f5bb3`)
  - Validar invariantes del agregado `ClientApplication` (prohibición de secret en clientes públicos, validación de listas de orígenes).

---

## 5. Trazabilidad de Implementación

- **Entidades de Dominio y Value Objects:**
  - `src/contexts/identity/domain/entities/client_application/aggregate.ts`
  - `src/contexts/identity/domain/value_objects/client_id/value.ts`
  - `src/contexts/identity/domain/value_objects/origin_domain/value.ts`
  - `src/contexts/identity/domain/value_objects/grant_type/value.ts`
  - `src/contexts/identity/domain/value_objects/scope/value.ts`
- **Puertos de Dominio:**
  - `src/contexts/identity/domain/ports/client_application_repository_port.ts`
- **Capa de Aplicación (Query Slice & Cache-Aside):**
  - `src/contexts/identity/application/dtos/client_validation/dto.ts`
  - `src/contexts/identity/application/queries/validate_client_origin/query.ts`
  - `src/contexts/identity/application/queries/validate_client_origin/handler.ts`
- **Infraestructura e Interfaces:**
  - `src/contexts/identity/infrastructure/persistence/repositories/client_application/postgres_client_repository.ts`
  - `interfaces/http/rest/v1/oauth2/client_controller.ts`
  - `interfaces/http/middlewares/client_authorization_middleware.ts`
  - `interfaces/web/client/contexts/identity/ui/components/client_authorization_guard.tsx`
  - `interfaces/web/client/contexts/identity/ui/components/client_authorization_guard.stories.tsx`
- **DDL:**
  - `infrastructure/local/initdb.d/006-create-registered-clients.sql`

---

## 6. Plan de Ejecución Guiado por Tests en 4 Capas (Outside-In / Inside-Out)

Conforme a [`.agent/rules/DEVELOPMENT_WORKFLOW.md`](../../../rules/DEVELOPMENT_WORKFLOW.md), la implementación de este slice se ejecuta en dos fases estrictas:

### Fase 1: Apertura de Capas (Top-Down / Red Phase)
1. **Paso 1 (Apertura Capa 4 - E2E):** Crear `tests/e2e/web/client_registry_origin.spec.tsx` definiendo la verificación de orígenes no autorizados desde el cliente web. [RED]
2. **Paso 2 (Apertura Capa 3 - Aceptación BDD):** Crear `tests/acceptance/features/client_registry_validation.feature` y sus step definitions. [RED]
3. **Paso 3 (Apertura Capa 2 - Integración):** Crear `tests/integration/identity/repositories/test_postgres_client_repository.ts` y `test_client_authorization_middleware.ts`. [RED]
4. **Paso 4 (Apertura Capa 1 - Unidad):** Crear `tests/unit/identity/domain/client_registry/test_client_id.ts` y `test_client_application.ts`. [RED]

### Fase 2: Clausura de Capas (Bottom-Up / Green Phase)
5. **Paso 5 (Clausura Capa 1 - Unidad):** Implementar Value Objects `ClientId`, `OriginDomain` y agregado `ClientApplication`. Correr `npm run test:unit` $\rightarrow$ [GREEN].
6. **Paso 6 (Clausura Capa 2 - Integración):** Implementar script DDL `006-create-registered-clients.sql`, repositorio PostgreSQL y `ClientAuthorizationMiddleware`. Correr `npm run test:integration` $\rightarrow$ [GREEN].
7. **Paso 7 (Clausura Capa 3 - Aceptación BDD):** Conectar la API Express y verificar los escenarios Gherkin con Cucumber $\rightarrow$ [GREEN].
8. **Paso 8 (Clausura Capa 4 - E2E):** Ejecutar suite E2E completa $\rightarrow$ [GREEN].


