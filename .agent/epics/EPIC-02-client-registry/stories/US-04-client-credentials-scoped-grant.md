---
id: US-04
title: "Client Credentials & Scoped Access Token Grant"
epic:
  id: EPIC-02
  name: "Client Registry & Service Authorization"
status: completed
priority: P0
bounded_context: identity
subdomain: oauth2-token
slice_type: command
timestamps:
  created_at: "2026-11-06T14:00:00-03:00"
  started_at: "2026-11-06T16:00:00-03:00"
  completed_at: "2026-11-08T02:17:00-03:00"
  updated_at: "2026-11-08T18:00:00-03:00"
traceability:
  adrs:
    - docs/adr/0004-client-registry-authorization.md
  guidelines:
    - .agent/guidelines/GUIDELINE-05-m2m-tokens.md
  publications:
    - .agent/publications/ARTICLE-04-client-credentials-grant.md
    - .agent/publications/ARTICLE-04-B-refactoring-client-credentials.md
  commits:
    - 0a7fdc4
    - 2fbb007
    - 86667aa
    - 0e12a19
    - a88ce84
    - 3680915
    - 0652760
    - 13eadd8
    - ea70e38
    - df79d80
    - 2ce18af
    - 0f3cf5c
    - c6ff687
    - 2e84d5f
    - 6008293
tags:
  - oauth2
  - client-credentials
  - m2m
  - rfc6749
  - scoped-grant
---

# US-04: Client Credentials & Scoped Access Token Grant

**Epic:** [EPIC-02: Client Registry & Service Authorization](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `identity` / `oauth2-token`  
**Slice Type:** Command (OAuth2 M2M Token Slice)  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  
**ADR Relacionado:** [`ADR-0004: Client Registry and Service Authorization`](../../../docs/adr/0004-client-registry-authorization.md)  
**Guía Interactiva:** [`GUIDELINE-05`](../../guidelines/GUIDELINE-05-m2m-tokens.md)  
**Publicaciones:** [`ARTICLE-04`](../../publications/ARTICLE-04-client-credentials-grant.md), [`ARTICLE-04-B`](../../publications/ARTICLE-04-B-refactoring-client-credentials.md)

---

## 1. Descripción

**Como** servicio backend o microservicio satélite del ecosistema,  
**Quiero** autenticarme mediante mis credenciales de cliente (`client_id` y `client_secret`) y solicitar scopes específicos de acceso,  
**Para** obtener un Access Token JWT firmado asimétricamente y consumir APIs de forma segura en un contexto Machine-to-Machine (M2M) sin requerir interacción de un usuario humano.

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Restricción de Tipo de Cliente:** El grant type `client_credentials` está estrictamente reservado para clientes clasificados como `confidential`. Los clientes `public` son rechazados con error `unauthorized_client`.
2. **Validación Criptográfica de Secreto:** La contraseña o secreto de cliente provisto debe validarse contra el hash almacenado mediante el puerto `HashProviderPort`.
3. **Validación de Scopes:** El cliente únicamente puede solicitar scopes que formen parte del subconjunto registrado previamente en su definición. Si solicita un scope no concedido, la solicitud es rechazada con error `invalid_scope`.
4. **Emisión de JWT Acotado:** El Access Token emitido debe contener `client_id`, los scopes autorizados concedidos, fecha de expiración acotada (por ejemplo 1 hora) y el subject `sub` igual al `client_id`.

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: Client Credentials Scoped Grant

  Scenario: Successful machine-to-machine authentication with authorized scopes
    Given a confidential client "order-service" with valid secret "secret-hash-123" and scopes ["identity:read"]
    When the client sends a POST request to "/oauth2/token" with:
      | grant_type    | client_credentials |
      | client_id     | order-service       |
      | client_secret | ValidSecret123!     |
      | scope         | identity:read       |
    Then the response status code should be 200 OK
    And the response body should contain an access_token of type "Bearer"
    And the token claims should contain scope "identity:read"

  Scenario: Rejection of client credentials request from a public client
    Given a public client "spa-frontend"
    When the client attempts to use "client_credentials" grant type
    Then the response status code should be 400 Bad Request
    And the response body error should be "unauthorized_client"

  Scenario: Rejection of unauthorized scopes
    Given a confidential client "analytics-worker" with scopes ["metrics:write"]
    When the client requests scope "identity:admin"
    Then the response status code should be 400 Bad Request
    And the response body error should be "invalid_scope"
```

---

## 4. Cobertura de Pruebas Requerida (Pirámide de Testing)

- [x] **End-to-End Test (E2E Consumidor M2M):** `tests/e2e/m2m/client_credentials_flow.spec.ts` (`0f3cf5c`, `c6ff687`)
  - Validar flujo de extremo a extremo desde el cliente consumidor `OAuth2M2MClient`.
- [x] **Acceptance Test (BDD):** `tests/acceptance/features/client_credentials_grant.feature` (`2ce18af`)
  - Escenario Gherkin ejecutable con step definitions (`test_client_credentials_grant_steps.ts`).
- [x] **Integration Test 1 (OAuth2 Token Endpoint):** `tests/integration/identity/interfaces/test_oauth2_token_m2m.ts` (`0652760`, `13eadd8`)
  - Ejecutar peticiones POST `/api/v1/oauth2/token` con Supertest validando formato RFC 6749, HTTP Basic y URL-encoded.
- [x] **Unit Test 1 (Command Handler):** `tests/unit/identity/application/oauth2/test_authenticate_client_m2m_handler.ts` (`86667aa`, `0e12a19`)
  - Validar orquestación, hashing de secreto, cálculo de scopes e invariantes de token M2M.

---

## 5. Trazabilidad de Implementación

- **Domain Exceptions:**
  - `src/contexts/identity/domain/exceptions/oauth2/error.ts` (`OAuth2AuthenticationError`)
- **Application DTOs & Command:**
  - `src/contexts/identity/application/dtos/oauth2_token/dto.ts` (`OAuth2TokenResponseDTO`)
  - `src/contexts/identity/application/commands/authenticate_client_m2m/command.ts`
  - `src/contexts/identity/application/commands/authenticate_client_m2m/handler.ts`
- **Interfaces HTTP:**
  - `interfaces/http/rest/v1/oauth2/token_controller.ts` (`OAuth2TokenController`)
  - `interfaces/http/server.ts` (rutas `/api/v1/oauth2/token` y `/oauth2/token`)
- **Interfaces Client (M2M SDK):**
  - `interfaces/http/client/oauth2_m2m_client.ts` (`OAuth2M2MClient`)

