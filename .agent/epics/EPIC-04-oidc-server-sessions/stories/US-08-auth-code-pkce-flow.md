---
id: US-08
title: "OAuth2 Authorization Code Flow with PKCE & User Consent"
epic:
  id: EPIC-04
  name: "OIDC / OAuth2 Authorization Server & Session Lifecycle"
status: planned
priority: P0
bounded_context: identity
subdomain: oauth2-auth-flow
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
  - oauth2
  - authorization-code
  - pkce
  - s256
  - consent
---

# US-08: OAuth2 Authorization Code Flow with PKCE & User Consent

**Epic:** [EPIC-04: OIDC / OAuth2 Authorization Server & Session Lifecycle](../README.md)  
**Status:** Planned  
**Domain / Bounded Context:** `identity` / `oauth2-auth-flow`  
**Slice Type:** Command & Protocol (Authorization Code with PKCE Slice)  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  
**ADR Relacionado:** [`ADR-0006: OIDC Authorization Server & Cryptography`](../../../docs/adr/0006-oidc-session-flow.md)

---

## 1. Descripción

**Como** usuario final accediendo a una Single Page Application (SPA / React) o cliente móvil,  
**Quiero** autenticarme en `identity-service` mediante el flujo Authorization Code protegido con PKCE (Proof Key for Code Exchange),  
**Para** autorizar a la aplicación cliente a acceder a mi perfil de forma segura sin exponer mis credenciales directamente a la aplicación y sin riesgo de intercepción del código de autorización.

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Obligatoriedad de PKCE para Clientes Públicos:** Toda petición a `GET /oauth2/authorize` originada por un cliente de tipo `public` debe incluir obligatoriamente los parámetros `code_challenge` y `code_challenge_method=S256`. Peticiones con método `plain` o ausentes son rechazadas con error `invalid_request`.
2. **Ciclo de Vida de `authorization_code`:** El código de autorización emitido tiene una vida útil máxima efímera (60 segundos) y puede ser canjeado exactamente una sola vez (uso único). Tras el primer canje, queda invalidado permanentemente.
3. **Validación Criptográfica de `code_verifier`:** En el endpoint `POST /oauth2/token`, el cliente debe presentar el `code_verifier`. El servidor calcula:
   `BASE64URL(SHA256(ASCII(code_verifier)))` y comprueba que sea idéntico al `code_challenge` almacenado previamente. Si difiere, se rechaza la petición con error `invalid_grant`.
4. **Validación de `redirect_uri`:** La URI de retorno provista en el canje de token debe coincidir de forma idéntica con la especificada durante la solicitud de autorización inicial.
5. **Emisión de Tokens OIDC:** Al completar exitosamente el canje, se emiten:
   * `access_token`: JWT RS256 con claims organizacionales (`tenant_id`, `sub`, `scope`).
   * `id_token`: JWT RS256 cumpliendo el estándar OpenID Connect Core 1.0.

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: OAuth2 Authorization Code Flow with PKCE

  Scenario: Successful authorization code generation with PKCE
    Given a registered public client "e-commerce-spa" with redirect URI "https://shop.local/callback"
    When the user authorizes the client with code_challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" and method "S256"
    Then the system should issue an authorization_code
    And redirect to "https://shop.local/callback?code=<authorization_code>"

  Scenario: Successful token exchange with valid code_verifier
    Given an issued authorization_code with code_challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    When the client sends a POST request to "/oauth2/token" with code_verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    Then the system should return HTTP 200 OK
    And the response should include "access_token" and "id_token"

  Scenario: Reject token exchange with invalid code_verifier
    Given an issued authorization_code
    When the client presents an incorrect code_verifier "wrong_verifier_string"
    Then the system should reject the exchange with HTTP 400 Bad Request
    And the error code should be "invalid_grant"
```

---

## 4. Cobertura de Pruebas Requerida (Pirámide de Testing)

- [ ] **Unit Test 1 (PKCE Verifier Domain Service):** `tests/unit/identity/domain/services/test_pkce_validator.ts`
  - Validar cálculo SHA-256 / Base64URL y verificación de cadenas RFC 7636.
- [ ] **Integration Test 1 (Authorize & Token Handshake):** `tests/integration/identity/interfaces/test_oauth2_auth_code_flow.ts`
  - Ejecutar el flujo completo de dos pasos (emisión de código y canje) verificando que el código no pueda reutilizarse.
- [ ] **Acceptance Test (BDD):** `tests/acceptance/features/oauth2_pkce_flow.feature`
  - Escenario ejecutable con Cucumber.

---

## 5. Trazabilidad de Implementación

- **Application Commands:**
  - `src/contexts/identity/application/commands/issue_authorization_code/`
  - `src/contexts/identity/application/commands/exchange_authorization_code/`
- **Interfaces HTTP:**
  - `interfaces/http/rest/v1/oauth2/authorize_controller.ts`
  - `interfaces/http/rest/v1/oauth2/token_controller.ts`

