---
id: US-01
title: "Tenant User Registration"
epic:
  id: EPIC-01
  name: "Identity & Access Management"
status: completed
priority: P0
bounded_context: identity
subdomain: multitenant-registration
slice_type: command
timestamps:
  created_at: "2026-11-04T00:00:00-03:00"
  started_at: "2026-11-04T02:00:00-03:00"
  completed_at: "2026-11-04T20:58:00-03:00"
  updated_at: "2026-11-08T18:00:00-03:00"
traceability:
  adrs:
    - docs/adr/0001-hexagonal-architecture.md
    - docs/adr/0003-multi-tenant-isolation-strategy.md
  guidelines: []
  publications:
    - .agent/publications/ARTICLE-01-tenant-user-registration.md
  commits:
    - "commit 2"
    - "commit 3"
    - "commit 5"
    - "commit 7"
    - "commit 8"
    - "commit 9"
    - "commit 12"
    - "commit 19"
    - "commit 22"
tags:
  - identity
  - registration
  - multitenant
  - bcrypt
  - jwt
---

# US-01: Tenant User Registration

**Epic:** [EPIC-01: Identity & Access Management](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `identity` (Multitenant)  
**Slice Type:** Command (Write Slice: `register_user`)  
**Referencia Estructural:** [`.agent/TREE.txt`](../../TREE.txt)  
**ADRs Relacionados:** [`ADR-0001`](../../../docs/adr/0001-hexagonal-architecture.md), [`ADR-0003`](../../../docs/adr/0003-multi-tenant-isolation-strategy.md)  
**Publicación:** [`ARTICLE-01`](../../publications/ARTICLE-01-tenant-user-registration.md)

---

## 1. Descripción

**Como** administrador o usuario de una organización (*Tenant*),  
**Quiero** registrar una nueva cuenta de usuario proporcionando un correo, contraseña y el identificador de mi organización (`tenantId`),  
**Para** autenticarme de forma segura en la plataforma y acceder a los recursos aislados de mi tenant.

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Email Válido:** El correo electrónico debe cumplir estrictamente con una estructura válida de RFC 5322 (manejado por el Value Object `Email`).
2. **Formato de Clave:** La contraseña debe cumplir con los requisitos mínimos de complejidad (mínimo 8 caracteres, al menos un número y una letra).
3. **Persistencia Hashed:** Bajo ninguna circunstancia se almacena la clave en texto plano; debe procesarse mediante `BcryptAdapter` (salting + hashing).
4. **Unicidad por Tenant:** El par `(email, tenantId)` debe ser único en el sistema.
5. **Claims en Token:** La respuesta exitosa emite un token JWT firmado que incluye explícitamente los claims `userId`, `email` y `tenantId`.

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: Tenant User Registration

  Scenario: Successful tenant user registration
    Given the tenant "acme-corp" exists and is active
    When the client sends a POST request to "/api/v1/auth/register" with:
      | tenantId | acme-corp          |
      | email    | user@acme.com      |
      | password | SecurePass123!     |
    Then the response status code should be 201 Created
    And the response body should contain a valid JWT access token
    And the JWT token claims should contain "tenantId": "acme-corp"

  Scenario: Registration failure due to invalid email format
    Given a client attempting registration
    When the client submits "invalid-email-format" as email
    Then the system should throw a DomainValidationError
    And the response status code should be 400 Bad Request
    And no record should be persisted in the database

  Scenario: Registration failure due to duplicate email in same tenant
    Given an existing user "user@acme.com" registered in tenant "acme-corp"
    When another user attempts to register with "user@acme.com" in tenant "acme-corp"
    Then the system should catch a ConflictError
    And the response status code should be 409 Conflict
```

---

## 4. Cobertura de Pruebas Requerida (Pirámide de Testing)

- [ ] **Unit Test 1 (Domain Value Object):** `tests/unit/identity/domain/test_email.ts`
  - Validar instanciación correcta con emails válidos y lanzamiento de excepción ante formatos inválidos.
- [ ] **Unit Test 2 (Domain Aggregate):** `tests/unit/identity/domain/test_user_aggregate.ts`
  - Validar control de invariantes del agregado `User`.
- [ ] **Unit Test 3 (Application Command Handler):** `tests/unit/identity/application/test_register_user_handler.ts`
  - Comprobar que el handler orquesta la creación del usuario invocando los puertos `UserRepositoryPort` y `HashProviderPort` en aislamiento (usando mocks).
- [ ] **Integration Test 1 (Persistence / DB):** `tests/integration/identity/repositories/test_postgres_repository.ts`
  - Verificar inserción exitosa y consulta del registro en base de datos PostgreSQL filtrando por `tenant_id`.
- [ ] **Integration Test 2 (Adapter HTTP / Express):** `tests/integration/identity/interfaces/test_register_api.ts`
  - Simular petición POST a `/api/v1/auth/register` vía `supertest`, verificando código de estado HTTP 201 y emisión de token.
- [ ] **Acceptance Test (BDD):** `tests/acceptance/features/user_registration.feature`
  - Especificación ejecutable en lenguaje ubicuo Gherkin vinculada a `tests/acceptance/step_defs/test_user_registration_steps.ts`.
- [ ] **End-to-End Test (E2E / Frontend):** `tests/e2e/web/register_form.spec.tsx`
  - Renderizar el formulario React, completar los inputs, simular el evento Submit y verificar actualización del `AuthContext`.

---

## 5. Trazabilidad de Implementación

### Artefactos de Código

- **Domain:**
  - `src/contexts/identity/domain/value_objects/email/value.ts`
  - `src/contexts/identity/domain/value_objects/tenant_id/value.ts`
  - `src/contexts/identity/domain/entities/user/aggregate.ts`
  - `src/contexts/identity/domain/exceptions/user/error.ts`

- **Application:**
  - `src/contexts/identity/application/ports/user/repository.ts`
  - `src/contexts/identity/application/ports/security/hash_provider.ts`
  - `src/contexts/identity/application/ports/security/token_provider.ts`
  - `src/contexts/identity/application/commands/register_user/command.ts`
  - `src/contexts/identity/application/commands/register_user/handler.ts`
  - `src/contexts/identity/application/dtos/register_user/dto.ts`

- **Infrastructure:**
  - `src/contexts/identity/infrastructure/security/bcrypt_adapter.ts`
  - `src/contexts/identity/infrastructure/security/jwt_adapter.ts`
  - `src/contexts/identity/infrastructure/persistence/models/user/model.ts`
  - `src/contexts/identity/infrastructure/persistence/repositories/user/repository.ts`
  - `src/contexts/identity/infrastructure/persistence/mappers/user/mapper.ts`

- **Interfaces:**
  - `interfaces/http/rest/v1/identity/controllers.ts`
  - `interfaces/http/rest/v1/identity/schemas.ts`
  - `interfaces/web/client/contexts/identity/domain/types.ts`
  - `interfaces/web/client/contexts/identity/data/api.ts`
  - `interfaces/web/client/contexts/identity/ui/context/auth_context.tsx`
  - `interfaces/web/client/contexts/identity/ui/components/register_form.tsx`

---

## 6. Commits Asociados

- `[commit 2]`: `feat(domain): define Value Objects (Email, TenantId)`
- `[commit 3]`: `feat(domain): define User Aggregate with domain invariants`
- `[commit 4]`: `feat(domain): define UserRepositoryPort and HashProviderPort interfaces`
- `[commit 5]`: `feat(app): implement register_user Command Slice (command and handler)`
- `[commit 7]`: `feat(infra): implement BcryptAdapter for password hashing`
- `[commit 8]`: `feat(infra): implement JwtTokenAdapter for authentication & tenant claims`
- `[commit 9]`: `feat(infra): implement PostgresUserRepository`
- `[commit 12]`: `feat(interfaces): expose Express AuthController endpoints (/register)`
- `[commit 19]`: `feat(frontend): build RegisterForm UI component`
- `[commit 22]`: `test(backend): add unit tests and acceptance BDD feature for user registration`
