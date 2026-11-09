---
id: US-09
title: "Sliding Session Refresh Token Rotation with HttpOnly Cookies"
epic:
  id: EPIC-04
  name: "OIDC / OAuth2 Authorization Server & Session Lifecycle"
status: planned
priority: P0
bounded_context: identity
subdomain: session-management
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
  - session
  - refresh-token
  - token-rotation
  - httponly-cookie
  - csrf-defense
---

# US-09: Sliding Session Refresh Token Rotation with HttpOnly Cookies

**Epic:** [EPIC-04: OIDC / OAuth2 Authorization Server & Session Lifecycle](../README.md)  
**Status:** Planned  
**Domain / Bounded Context:** `identity` / `session-management`  
**Slice Type:** Command & Security (Session Lifecycle Slice)  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  
**ADR Relacionado:** [`ADR-0006: OIDC Authorization Server & Cryptography`](../../../docs/adr/0006-oidc-session-flow.md)

---

## 1. Descripción

**Como** usuario autenticado en una aplicación del ecosistema,  
**Quiero** mantener mi sesión activa de manera fluida y renovar mi Access Token de corta duración sin ingresar mis credenciales constantemente,  
**Para** disfrutar de una experiencia de usuario continua garantizando que el Refresh Token viaje resguardado en cookies seguras e inmunes a ataques XSS y con detección inmediata de robo o reuso indebido.

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Tokens Opacos con Resguardo Hashed:** Los Refresh Tokens no son JWTs legibles; son cadenas opacas de alta entropía (256-bit crypto-random) cuyo valor plano solo se expone al cliente al emitirse y cuyo hash criptográfico se almacena en PostgreSQL.
2. **Transporte Exclusivo vía Cookies Seguras:** El Refresh Token se despacha en la cabecera `Set-Cookie` con los atributos obligatorios:
   * `HttpOnly`: Bloquea acceso desde JavaScript/DOM mitigando vectores de robo XSS.
   * `Secure`: Transmisión restringida a HTTPS (excepto localhost en entorno de desarrollo).
   * `SameSite=Strict`: Previene que el navegador adjunte la cookie en peticiones de origen cruzado (mitigación total de CSRF).
   * `Path=/api/v1/oauth2`: Acota el alcance de la cookie únicamente a los endpoints de sesión (`/refresh`, `/logout`).
3. **Rotación Estricta en Cada Uso:** Cada llamada exitosa a `/oauth2/refresh` consume el Refresh Token actual, lo marca como utilizado en base de datos y emite un nuevo Refresh Token y nuevo Access Token (rotación 1 a 1).
4. **Detección de Reuso y Revocación de Familia (Token Family Revocation):** Todo Refresh Token pertenece a una `family_id`. Si se presenta un token que ya fue consumido previamente, el sistema detecta un posible compromiso o ataque de repetición e invalida de inmediato **todos** los tokens activos pertenecientes a dicha `family_id`, revocando la sesión por completo.

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: Sliding Session Refresh Token Rotation with HttpOnly Cookies

  Scenario: Successful refresh token rotation
    Given an active session with valid refresh token cookie belonging to family "fam-100"
    When the client sends a POST request to "/oauth2/refresh"
    Then the response status code should be 200 OK
    And a new access_token should be returned in the response body
    And a new refresh_token cookie with "HttpOnly" and "SameSite=Strict" should be set
    And the previous refresh token should be marked as consumed

  Scenario: Detection of token reuse and complete family revocation
    Given a previously consumed refresh token from family "fam-100"
    When an attacker attempts to replay this consumed token at "/oauth2/refresh"
    Then the system should reject the request with HTTP 401 Unauthorized
    And all tokens associated with family "fam-100" should be immediately revoked
    And a security alert "REFRESH_TOKEN_REUSE_DETECTED" should be emitted
```

---

## 4. Cobertura de Pruebas Requerida (Pirámide de Testing)

- [ ] **Unit Test 1 (Session Aggregate):** `tests/unit/identity/domain/test_refresh_session_aggregate.ts`
  - Validar lógica de rotación y detección de reuso en el agregado `RefreshSession`.
- [ ] **Integration Test 1 (Endpoint Refresh & Cookies):** `tests/integration/identity/interfaces/test_refresh_token_rotation.ts`
  - Verificar emisión y actualización de cookies HttpOnly con supertest.
- [ ] **Acceptance Test (BDD):** `tests/acceptance/features/refresh_token_rotation.feature`
  - Escenario ejecutable con Cucumber.

---

## 5. Trazabilidad de Implementación

- **Dominio:**
  - `src/contexts/identity/domain/entities/refresh_session/aggregate.ts`
- **Application Commands:**
  - `src/contexts/identity/application/commands/rotate_refresh_token/`
  - `src/contexts/identity/application/commands/revoke_session/`
- **Interfaces HTTP:**
  - `interfaces/http/rest/v1/oauth2/session_controller.ts`

