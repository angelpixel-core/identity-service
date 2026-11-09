---
id: US-10
title: "External OIDC Provider Connectors (Google & Microsoft Entra ID)"
epic:
  id: EPIC-05
  name: "Identity Federation & External IdP Brokerage"
status: planned
priority: P1
bounded_context: identity
subdomain: federation-connectors
slice_type: integration
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
  - oidc
  - google-oauth
  - microsoft-entra
  - external-idp
---

# US-10: External OIDC Provider Connectors (Google & Microsoft Entra ID)

**Epic:** [EPIC-05: Identity Federation & External IdP Brokerage](../README.md)  
**Status:** Planned  
**Domain / Bounded Context:** `identity` / `federation-connectors`  
**Slice Type:** Command & Integration (External IdP Connector Slice)  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  
**ADR Relacionado:** [`ADR-0006: OIDC Authorization Server & Cryptography`](../../../docs/adr/0006-oidc-session-flow.md)

---

## 1. Descripción

**Como** usuario o administrador de un tenant que utiliza Google Workspace o Microsoft 365,  
**Quiero** autenticarme en la plataforma mediante mi cuenta corporativa externa de Google o Microsoft Entra ID,  
**Para** acceder de manera transparente sin necesidad de crear ni gestionar una contraseña local adicional en `identity-service`.

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Abstracción Desacoplada (`ExternalIdentityProviderPort`):** Cada conector externo implementa una interfaz común del dominio con métodos para generar la URL de autorización y procesar el código de respuesta del callback.
2. **Protección Anti-CSRF y Anti-Replay (`state` y `nonce`):**
   * El parámetro `state` enviado al proveedor externo es un JWT efímero firmado por `identity-service` que almacena el `tenant_id`, `client_id` original y un timestamp.
   * El parámetro `nonce` previene ataques de repetición en el ID Token recibido.
3. **Validación Criptográfica de Tokens Externos:** El ID Token devuelto por Google o Microsoft debe ser verificado contra las claves públicas expuestas en sus respectivos JWKS oficiales (`https://www.googleapis.com/oauth2/v3/certs` y `https://login.microsoftonline.com/common/discovery/v2.0/keys`).
4. **Verificación Mandatoria de Email:** Únicamente se aceptan perfiles externos donde el proveedor certifique explícitamente `email_verified: true`.

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: External OIDC Provider Connectors

  Scenario: Initiate Google federated authentication
    When a user requests login via provider "google" for tenant "acme-corp"
    Then the system should generate an authorization URL pointing to Google Accounts
    And the URL must contain a valid cryptographic "state" parameter and "nonce"

  Scenario: Successfully validate Google callback and parse verified profile
    Given a valid authorization code from Google and matching "state" parameter
    When the callback endpoint processes the response
    Then the Google ID Token signature should be verified against Google JWKS
    And the normalized user profile should contain email and "email_verified": true
```

---

## 4. Cobertura de Pruebas Requerida (Pirámide de Testing)

- [ ] **Unit Test 1 (External Provider Port & State Generator):** `tests/unit/identity/infrastructure/federation/test_federation_state.ts`
  - Validar generación y verificación del token `state` anti-CSRF.
- [ ] **Integration Test 1 (Google OIDC Adapter Mocked):** `tests/integration/identity/infrastructure/federation/test_google_adapter.ts`
  - Simular respuestas de token endpoint y verificación JWKS con nock/msw.
- [ ] **Acceptance Test (BDD):** `tests/acceptance/features/external_oidc_connectors.feature`
  - Escenario ejecutable con Cucumber.

---

## 5. Trazabilidad de Implementación

- **Puertos de Dominio:**
  - `src/contexts/identity/domain/ports/external_identity_provider_port.ts`
- **Adaptadores de Infraestructura:**
  - `src/contexts/identity/infrastructure/federation/google_oidc_adapter.ts`
  - `src/contexts/identity/infrastructure/federation/microsoft_entra_adapter.ts`
- **Interfaces HTTP:**
  - `interfaces/http/rest/v1/federation/federation_controller.ts`

