---
id: US-11
title: "Federated Account Linking & Tenant Profile Provisioning (JIT)"
epic:
  id: EPIC-05
  name: "Identity Federation & External IdP Brokerage"
status: planned
priority: P1
bounded_context: identity
subdomain: federated-provisioning
slice_type: command
timestamps:
  created_at: "2026-11-04T00:00:00-03:00"
  started_at: null
  completed_at: null
  updated_at: "2026-11-09T15:00:00-03:00"
traceability:
  adrs:
    - docs/adr/0006-oidc-session-flow.md
  guidelines: []
  publications: []
  commits: []
tags:
  - federation
  - jit-provisioning
  - account-linking
  - user-identity
---

# US-11: Federated Account Linking & Tenant Profile Provisioning (JIT)

**Epic:** [EPIC-05: Identity Federation & External IdP Brokerage](../README.md)  
**Status:** Planned  
**Domain / Bounded Context:** `identity` / `federated-provisioning`  
**Slice Type:** Command & Provisioning (JIT Account Linking Slice)  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  
**ADR Relacionado:** [`ADR-0006: OIDC Authorization Server & Cryptography`](../../../docs/adr/0006-oidc-session-flow.md)

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

- [ ] **Unit Test 1 (Federated Account Linking Command):** `tests/unit/identity/application/federation/test_account_linking_handler.ts`
  - Validar lógica condicional de creación JIT vs vinculación a cuenta existente.
- [ ] **Integration Test 1 (Postgres Federated Repository):** `tests/integration/identity/repositories/test_federated_identity_repository.ts`
  - Comprobar persistencia y recuperación de identidades vinculadas bajo PostgreSQL con RLS.
- [ ] **Acceptance Test (BDD):** `tests/acceptance/features/federated_account_linking.feature`
  - Escenario ejecutable con Cucumber.

---

## 5. Trazabilidad de Implementación

- **Dominio:**
  - `src/contexts/identity/domain/entities/federated_identity/aggregate.ts`
- **Application Commands:**
  - `src/contexts/identity/application/commands/link_or_provision_federated_user/`
- **Repositorios:**
  - `src/contexts/identity/infrastructure/persistence/repositories/federated_identity/postgres_federated_identity_repository.ts`
- **DDL:**
  - `infrastructure/local/initdb.d/008-create-federated-identities.sql`

