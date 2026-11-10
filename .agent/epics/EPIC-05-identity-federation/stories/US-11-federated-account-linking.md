---
id: US-11
title: "Federated Account Linking & Tenant Profile Provisioning (JIT)"
epic:
  id: EPIC-05
  name: "Identity Federation & External IdP Brokerage"
status: completed
priority: P1
bounded_context: identity
subdomain: federated-provisioning
slice_type: command
timestamps:
  created_at: "2026-11-04T00:00:00-03:00"
  started_at: "2026-11-10T03:30:00-03:00"
  completed_at: "2026-11-10T12:35:00-03:00"
  updated_at: "2026-11-10T12:35:00-03:00"
traceability:
  adrs:
    - docs/adr/0004-client-authentication-strategy.md
    - docs/adr/0005-postgresql-rls-strategy.md
    - docs/adr/0006-oidc-session-flow.md
  guidelines:
    - .agent/guidelines/GUIDELINE-12-federated-account-linking.md
  publications:
    - .agent/publications/ARTICLE-11-federated-account-linking.md
    - .agent/publications/ARTICLE-11-B-refactoring-jit-provisioning.md
  commits:
    - "f9e11fe"
    - "5b5ba18"
    - "72aa57c"
    - "945bcc9"
    - "9085e61"
    - "0d6be23"
    - "15d5163"
tags:
  - federation
  - jit-provisioning
  - account-linking
  - user-identity
---

# US-11: Federated Account Linking & Tenant Profile Provisioning (JIT)

**Epic:** [EPIC-05: Identity Federation & External IdP Brokerage](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `identity` / `federated-provisioning`  
**Slice Type:** Command & Provisioning (JIT Account Linking Slice)  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  
**ADR Relacionado:** [`ADR-0004: Client Authentication Strategy`](../../../docs/adr/0004-client-authentication-strategy.md), [`ADR-0005: PostgreSQL Row-Level Security Strategy`](../../../docs/adr/0005-postgresql-rls-strategy.md), [`ADR-0006: OIDC Authorization Server & Cryptography`](../../../docs/adr/0006-oidc-session-flow.md)
**Plan de Refactorización:** [`US-11: Refactoring Plan Inside-Out`](US-11-federated-account-linking-refactoring-plan.md)  
**Guía Interactiva:** [`GUIDELINE-12: Enlace de Cuentas Federadas y Provisión Just-In-Time`](../../guidelines/GUIDELINE-12-federated-account-linking.md)  
**Publicaciones Técnicas:** [`ARTICLE-11: Federated Account Linking`](../../publications/ARTICLE-11-federated-account-linking.md), [`ARTICLE-11-B: Inside-Out Refactoring`](../../publications/ARTICLE-11-B-refactoring-jit-provisioning.md)

---

## 1. Descripción

**Como** usuario autenticado mediante un proveedor federado externo (Google / Microsoft),  
**Quiero** que mi identidad externa sea vinculada automáticamente a mi cuenta existente o se cree un perfil de usuario Just-In-Time (JIT) dentro del tenant correspondiente,  
**Para** acceder inmediatamente a la aplicación solicitada recibiendo los tokens de sesión nativos de `identity-service` sin fricción operativa ni necesidad de pre-crear usuarios manualmente.

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Unicidad de Identidad Federada:** El par `(provider, external_subject_id)` es único globalmente en la persistencia (`federated_identities`).
2. **Vinculación Segura por Email Verificado:** Si el correo electrónico provisto por el IdP externo coincide con un usuario existente dentro del mismo `tenant_id` y el correo está certificado como `email_verified: true`, se vincula la identidad externa a la cuenta local preexistente.
3. **Aprovisionamiento Just-In-Time (JIT):** Si el usuario no existe en la organización, el comando crea un nuevo agregado `User` en dicho tenant con correo verificado, asigna el rol base predeterminado y genera el registro en `federated_identities`.
4. **Emisión de Sesión Nativa:** Al finalizar la vinculación o creación JIT, el Identity Broker emite un token JWT nativo firmado por `identity-service` conteniendo los claims de tenant y entrega la cookie de Refresh Token correspondiente.

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: Federated Account Linking and JIT Tenant Provisioning

  Scenario: Just-In-Time (JIT) user creation for new federated identity
    Given a new user authenticating via Google with email "new.user@external.com" in tenant "acme-corp"
    When the federated authentication completes successfully
    Then a new User record should be provisioned in tenant "acme-corp"
    And a federated identity record linking "google" to the new user should be created
    And native session tokens should be issued

  Scenario: Account linking with existing tenant user by verified email
    Given an existing user "alice@acme.com" in tenant "acme-corp"
    When Alice authenticates with Microsoft Entra ID with verified email "alice@acme.com"
    Then the system should link the Microsoft identity to the existing Alice record
    And no duplicate User record should be created
```

---

## 4. Cobertura de Pruebas Requerida (Pirámide de Testing)

- [x] **Unit Test 1 (Federated Account Linking Command):** `tests/unit/identity/application/federation/test_link_or_provision_handler.ts`
  - Validar lógica condicional de creación JIT vs vinculación a cuenta existente, direct sign-in, multi-provider y guardias de seguridad (7 tests).
- [x] **Unit Test 2 (Federated Identity Aggregate Root):** `tests/unit/identity/domain/federation/test_federated_identity_aggregate.ts`
  - Validar invariantes, métodos `matchesSubject`, `belongsToTenant` y comparaciones de igualdad (12 tests).
- [x] **Unit Test 3 (In-Memory Federated Repository):** `tests/unit/identity/infrastructure/repositories/test_in_memory_federated_identity_repository.ts`
  - Comprobar operaciones en memoria, clave compuesta e indexación multi-tenant (8 tests).
- [x] **Unit Test 4 (User Aggregate Hardening):** `tests/unit/identity/domain/test_user_aggregate.ts`
  - Comprobar `createFederatedUser` con hash inalcanzable y método `hasLocalPassword()`.
- [x] **Integration Test 1 (Federated Identity Repositories):** `tests/integration/identity/repositories/test_federated_identity_repository.ts`
  - Comprobar persistencia y recuperación de identidades vinculadas bajo PostgreSQL con RLS y soporte transaccional `withClient()` (6 tests).
- [x] **Integration Test 2 (Federation API Callback Integration):** `tests/integration/identity/interfaces/test_federation_api.ts`
  - Comprobar endpoints de callback REST GET y POST con emisión de sesión nativa (8 tests).
- [x] **Acceptance Test (BDD):** `tests/acceptance/features/federated_account_linking.feature` & `tests/acceptance/step_defs/test_federated_account_linking_steps.ts`
  - 5 escenarios ejecutables pasando al 100% (JIT provisioning, account linking, multi-provider, direct sign-in, unverified email rejection).
- [x] **SDK TypeScript Resource:** `sdks/typescript/tests/federation.test.ts`
  - Verificación del recurso `client.federation.handleCallback(...)` con mapeo de tokens y banderas de provisión (38 tests SDK pasando).

---

## 5. Trazabilidad de Implementación

- **Dominio:**
  - `src/contexts/identity/domain/entities/federated_identity/aggregate.ts`
  - `src/contexts/identity/domain/entities/user/aggregate.ts` (Hardened con `createFederatedUser` y `hasLocalPassword`)
  - `src/contexts/identity/domain/ports/repositories/federated_identity_repository_port.ts`
- **Application Commands:**
  - `src/contexts/identity/application/commands/link_or_provision_federated_user/command.ts`
  - `src/contexts/identity/application/commands/link_or_provision_federated_user/dto.ts`
  - `src/contexts/identity/application/commands/link_or_provision_federated_user/handler.ts`
- **Repositorios & Persistencia:**
  - `src/contexts/identity/infrastructure/persistence/repositories/federated_identity/postgres_federated_identity_repository.ts`
  - `src/contexts/identity/infrastructure/persistence/repositories/federated_identity/in_memory_federated_identity_repository.ts`
  - `src/contexts/identity/infrastructure/persistence/models/federated_identity/model.ts`
  - `src/contexts/identity/infrastructure/persistence/mappers/federated_identity/mapper.ts`
- **DDL & Migración Multi-Tenant:**
  - `infrastructure/local/initdb.d/008-create-federated-identities.sql`
- **Interfaces HTTP & SDK:**
  - `interfaces/http/rest/v1/federation/federation_controller.ts`
  - `interfaces/http/server.ts`
  - `docs/openapi.yaml`
  - `sdks/typescript/src/resources/federation_resource.ts`
- **Guía Operativa & Publicaciones:**
  - `.agent/guidelines/GUIDELINE-12-federated-account-linking.md`
  - `.agent/publications/ARTICLE-11-federated-account-linking.md`
  - `.agent/publications/ARTICLE-11-B-refactoring-jit-provisioning.md`

