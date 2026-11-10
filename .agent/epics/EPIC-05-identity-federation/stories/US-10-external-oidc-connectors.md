---
id: US-10
title: "External OIDC Provider Connectors (Google & Microsoft Entra ID)"
epic:
  id: EPIC-05
  name: "Identity Federation & External IdP Brokerage"
status: completed
priority: P1
bounded_context: identity
subdomain: federation-connectors
slice_type: integration
timestamps:
  created_at: "2026-11-04T00:00:00-03:00"
  started_at: "2026-11-10T01:53:00-03:00"
  completed_at: "2026-11-10T02:45:00-03:00"
  updated_at: "2026-11-10T02:45:00-03:00"
traceability:
  adrs:
    - docs/adr/0004-client-authentication-strategy.md
    - docs/adr/0006-oidc-session-flow.md
  guidelines:
    - .agent/guidelines/GUIDELINE-11-external-oidc-connectors.md
  publications:
    - .agent/publications/ARTICLE-10-external-oidc-connectors.md
    - .agent/publications/ARTICLE-10-B-refactoring-federation-security.md
  commits:
    - "129efce"
    - "7415811"
    - "c503ee3"
    - "278f50a"
    - "680ea84"
    - "0e98021"
    - "34ac939"
tags:
  - federation
  - oidc
  - google-oauth
  - microsoft-entra
  - external-idp
---

# US-10: External OIDC Provider Connectors (Google & Microsoft Entra ID)

**Epic:** [EPIC-05: Identity Federation & External IdP Brokerage](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `identity` / `federation-connectors`  
**Slice Type:** Command & Integration (External IdP Connector Slice)  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  
**ADR Relacionado:** [`ADR-0004: Client Authentication Strategy`](../../../docs/adr/0004-client-authentication-strategy.md), [`ADR-0006: OIDC Authorization Server & Cryptography`](../../../docs/adr/0006-oidc-session-flow.md)

---

## 1. Descripción

**Como** usuario o administrador de un tenant que utiliza Google Workspace o Microsoft 365,  
**Quiero** autenticarme en la plataforma mediante mi cuenta corporativa externa de Google o Microsoft Entra ID,  
**Para** acceder de manera transparente sin necesidad de crear ni gestionar una contraseña local adicional en `identity-service`.

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Abstracción Desacoplada (`ExternalIdentityProviderPort`):** Cada conector externo implementa una interfaz común del dominio con métodos para generar la URL de autorización y procesar el código de respuesta del callback.
2. **Protección Anti-CSRF y Anti-Replay (`state` y `nonce`):**
   * El parámetro `state` enviado al proveedor externo es un JWT efímero firmado por `identity-service` mediante HMAC-SHA256 que almacena el `tenant_id`, `client_id` original, timestamp y `target_url`.
   * El parámetro `nonce` previene ataques de repetición en el ID Token recibido.
   * La comparación de firmas `state` utiliza `crypto.timingSafeEqual` con tolerancia temporal de 60 segundos contra desfases de reloj (skew).
3. **Validación Criptográfica de Tokens Externos con Auto-Rollover:** El ID Token devuelto por Google o Microsoft debe ser verificado contra las claves públicas expuestas en sus respectivos JWKS oficiales (`https://www.googleapis.com/oauth2/v3/certs` y `https://login.microsoftonline.com/common/discovery/v2.0/keys`).
   * Mecanismo de auto-refresco en caliente ante `kid miss` con cooldown de 5 segundos para prevenir ataques de denegación de servicio (DoS).
   * Estrategia de reintento con backoff exponencial (hasta 3 intentos) y retención fail-safe de claves previas.
4. **Verificación Mandatoria de Email:** Únicamente se aceptan perfiles externos donde el proveedor certifique explícitamente `email_verified: true`.
5. **Normalización Heterogénea de Claims:** Mapeo consistente de identificadores únicos (`sub` en Google, `oid` en Microsoft Entra) y emails corporativos (`email`, `preferred_username`, `upn`).

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

- [x] **Unit Tests (Dominio, Infraestructura y Aplicación Aislados - 6 Suites):**
  - [x] `tests/unit/identity/infrastructure/federation/test_federation_state_manager.ts` (Generación/validación timing-safe, expiración, claims inválidos y redacción de secretos).
  - [x] `tests/unit/identity/infrastructure/federation/test_jwks_token_verifier.ts` (Verificación RS256, auto-refresco ante kid miss, cooldown anti-DoS y reintentos con backoff).
  - [x] `tests/unit/identity/infrastructure/federation/test_google_oidc_adapter.ts` (Generación de URL Google Accounts v2, validación de ID Token y exigencia de email_verified: true).
  - [x] `tests/unit/identity/infrastructure/federation/test_microsoft_entra_adapter.ts` (Generación de URL Entra v2, mapeo de claims oid/sub y extracción de preferred_username/upn).
  - [x] `tests/unit/identity/application/federation/test_federated_handlers.ts` (Handlers aislados GenerateFederatedLoginUrl y ProcessFederatedCallback sin red).
  - [x] `tests/unit/identity/interfaces/test_federation_controller.ts` (Respuestas HTTP 200, 400 y mapeo de errores OIDC en controlador REST).
- [x] **Integration Tests (Adaptadores e Interfaces HTTP - 3 Suites):**
  - [x] `tests/integration/identity/infrastructure/federation/test_google_adapter.ts` (Intercambio de tokens y verificación criptográfica completa con JWKS mockeado).
  - [x] `tests/integration/identity/infrastructure/federation/test_microsoft_entra_adapter.ts` (Flujo multi-tenant de Microsoft Entra y mapeo de perfiles corporativos).
  - [x] `tests/integration/identity/interfaces/test_federation_api.ts` (Endpoints REST `/api/v1/auth/federation/:provider/login` y `/callback`).
- [x] **SDK Tests (TypeScript):**
  - [x] `sdks/typescript/tests/federation.test.ts` (Métodos `client.federation.getLoginUrl` y `client.federation.processCallback`).
- [x] **Acceptance Tests (BDD Living Doc):**
  - [x] `tests/acceptance/features/external_oidc_connectors.feature` (5 escenarios ejecutables en Cucumber: login Google/Microsoft, mitigación de replay, detección de CSRF y verificación JWKS).
  - [x] `tests/acceptance/step_defs/test_external_oidc_connectors_steps.ts` (Step definitions BDD con mocks criptográficos en memoria).

---

## 5. Trazabilidad de Implementación

- **Puertos de Dominio:**
  - `src/contexts/identity/domain/ports/external_identity_provider_port.ts`
- **Infraestructura de Federación y Criptografía:**
  - `src/contexts/identity/infrastructure/federation/federation_state_manager.ts`
  - `src/contexts/identity/infrastructure/federation/jwks_token_verifier.ts`
  - `src/contexts/identity/infrastructure/federation/google_oidc_adapter.ts`
  - `src/contexts/identity/infrastructure/federation/microsoft_entra_adapter.ts`
- **Application Queries & Commands:**
  - `src/contexts/identity/application/queries/generate_federated_login_url/query.ts`
  - `src/contexts/identity/application/queries/generate_federated_login_url/handler.ts`
  - `src/contexts/identity/application/commands/process_federated_callback/command.ts`
  - `src/contexts/identity/application/commands/process_federated_callback/handler.ts`
- **Interfaces HTTP REST:**
  - `interfaces/http/rest/v1/federation/federation_controller.ts`
  - `interfaces/http/rest/v1/federation/federation_schemas.ts`
  - `interfaces/http/server.ts`
- **Especificación OpenAPI 3.1:**
  - `docs/openapi.yaml`
- **SDK Oficial TypeScript:**
  - `sdks/typescript/src/resources/federation_resource.ts`
  - `sdks/typescript/src/client.ts`
- **Guía Técnica Interactiva:**
  - `.agent/guidelines/GUIDELINE-11-external-oidc-connectors.md`
- **Publicaciones Oficiales:**
  - `.agent/publications/ARTICLE-10-external-oidc-connectors.md`
  - `.agent/publications/ARTICLE-10-B-refactoring-federation-security.md`
