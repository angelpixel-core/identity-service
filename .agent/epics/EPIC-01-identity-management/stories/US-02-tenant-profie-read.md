---
id: US-02
title: "Get Tenant User Profile"
epic:
  id: EPIC-01
  name: "Identity & Access Management"
status: completed
priority: P0
bounded_context: identity
subdomain: tenant-profile
slice_type: query
timestamps:
  created_at: "2026-11-04T21:00:00-03:00"
  started_at: "2026-11-04T22:00:00-03:00"
  completed_at: "2026-11-05T03:50:00-03:00"
  updated_at: "2026-11-08T18:00:00-03:00"
traceability:
  adrs:
    - docs/adr/0001-hexagonal-architecture.md
    - docs/adr/0003-multi-tenant-isolation-strategy.md
  guidelines: []
  publications:
    - .agent/publications/ARTICLE-02-tenant-profile-cache.md
  commits:
    - b0276de
    - 8e7e55e
    - 9acc60b
    - fef216f
    - 9a198c0
tags:
  - identity
  - profile
  - cache-aside
  - memory-cache
  - react-card
---

# US-02: Get Tenant User Profile

**Epic:** [EPIC-01: Identity & Access Management](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `identity` (Multitenant)  
**Slice Type:** Query (Read Slice: `get_user_profile`)  
**Referencia Estructural:** [`.agent/TREE.txt`](../../TREE.txt)  
**ADRs Relacionados:** [`ADR-0001`](../../../docs/adr/0001-hexagonal-architecture.md), [`ADR-0003`](../../../docs/adr/0003-multi-tenant-isolation-strategy.md)  
**Publicación:** [`ARTICLE-02`](../../publications/ARTICLE-02-tenant-profile-cache.md)

---

## 1. Descripción

**Como** usuario autenticado de la plataforma,  
**Quiero** consultar los detalles de mi perfil y los roles asociados a mi organización (*Tenant*),  
**Para** verificar mis permisos activos y visualizar la información contextual dentro del panel de control.

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Aislamiento por Tenant:** El usuario solo puede consultar el perfil correspondiente a su propio `tenantId` inyectado mediante los claims del token JWT.
2. **Caché Eficiente (Read Slice):** La consulta debe intentar primero responder desde la caché en memoria (`MemoryCacheAdapter`). Ante un *Cache Miss*, consulta a PostgreSQL y puebla la caché con un TTL (Time To Live) configurado usando la clave `user_profile:{tenantId}:{userId}`.
3. **Respuesta Sanitizada:** Se excluyen por completo hashes de contraseñas u otros atributos sensibles en el DTO de respuesta (`UserProfileDTO`).

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: Get Tenant User Profile

  Scenario: Successful profile retrieval with Cache Miss/Hit
    Given an authenticated user with a valid JWT token for tenant "acme-corp"
    And the user profile is not cached
    When the client sends a GET request to "/api/v1/auth/me" with Authorization header
    Then the system fetches user details from PostgreSQL
    And populates the cache with key "user_profile:acme-corp:user-id"
    And returns status code 200 OK with the UserProfileDTO

    When another GET request is sent to "/api/v1/auth/me" within TTL
    Then the response should be served directly from memory cache

  Scenario: Unauthorized profile access without JWT
    Given an unauthenticated request without Authorization header
    When the client sends a GET request to "/api/v1/auth/me"
    Then the response status code should be 401 Unauthorized
```

---

## 4. Cobertura de Pruebas Requerida (Pirámide de Testing)

- [x] **Unit Test 1 (Application Query Handler):** `tests/unit/identity/application/test_get_user_profile_handler.ts`
  - Verificar lógica de orquestación de caché (hit vs. miss) invocando `CacheProviderPort` y `UserRepositoryPort` mediante mocks.
- [x] **Unit Test 2 (Infrastructure Cache Adapter):** `tests/unit/identity/infrastructure/test_memory_cache_adapter.ts`
  - Validar almacenamiento en memoria, expiración de TTL y recuperación de valores por clave.
- [x] **Integration Test (API & Auth Middlewares):** `tests/integration/identity/interfaces/test_profile_api.ts`
  - Validar paso exitoso por `AuthMiddleware` y `TenantContextMiddleware` devolviendo claims y status HTTP 200.
- [x] **End-to-End Test (Frontend UI):** `tests/e2e/web/user_profile_card.spec.tsx`
  - Verificar renderizado de la tarjeta de usuario en React y estado de caché del custom hook `useUserProfile`.

---

## 5. Trazabilidad de Implementación

### Artefactos de Código

- **Application:**
  - `src/contexts/identity/application/ports/cache/cache_provider.ts`
  - `src/contexts/identity/application/queries/get_user_profile/query.ts`
  - `src/contexts/identity/application/queries/get_user_profile/handler.ts`
  - `src/contexts/identity/application/dtos/user_profile/dto.ts`

- **Infrastructure:**
  - `src/contexts/identity/infrastructure/cache/memory_cache_adapter.ts`

- **Interfaces:**
  - `interfaces/http/middlewares/auth_middleware.ts`
  - `interfaces/http/middlewares/tenant_context_middleware.ts`
  - `interfaces/http/rest/v1/identity/controllers.ts` (`GET /api/v1/auth/me`)
  - `interfaces/web/client/contexts/identity/data/queries.ts` (`useUserProfile`)
  - `interfaces/web/client/contexts/identity/ui/components/user_profile_card.tsx`

---

## 6. Commits Asociados

- `b0276de`: `test(acceptance): define gherkin scenarios for US-02 [expected red]`
- `1a0b491`: `test(app): add failing test for GetUserProfileQueryHandler [red]`
- `8e7e55e`: `feat(app): implement get_user_profile Query Slice (query and handler)`
- `62430e0`: `test(infra): add failing test for MemoryCacheAdapter [red]`
- `9acc60b`: `feat(infra): implement MemoryCacheAdapter for fast read queries`
- `9d47a4b`: `test(interfaces): add failing integration tests for profile API and auth middleware [red]`
- `fef216f`: `feat(interfaces): implement AuthMiddleware and expose GET /api/v1/auth/me profile endpoint`
- `0a224b8`: `test(frontend): add failing E2E component spec for UserProfileCard [red]`
- `9a198c0`: `feat(frontend): build UserProfileCard component and useUserProfile hook`
