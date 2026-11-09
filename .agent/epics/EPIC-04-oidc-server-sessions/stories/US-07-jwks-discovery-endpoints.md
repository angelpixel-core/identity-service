---
id: US-07
title: "Cryptographic Keypair Management, JWKS and OpenID Discovery Endpoints"
epic:
  id: EPIC-04
  name: "OIDC / OAuth2 Authorization Server & Session Lifecycle"
status: completed
priority: P1
bounded_context: identity
subdomain: oidc-crypto
slice_type: infrastructure
timestamps:
  created_at: "2026-11-04T00:00:00-03:00"
  started_at: "2026-11-09T15:30:00-03:00"
  completed_at: "2026-11-09T17:10:00-03:00"
  updated_at: "2026-11-09T17:10:00-03:00"
traceability:
  adrs:
    - docs/adr/0004-client-authentication-strategy.md
    - docs/adr/0005-postgresql-rls-strategy.md
  guidelines:
    - .agent/guidelines/GUIDELINE-08-oidc-discovery-and-jwks.md
  publications:
    - .agent/publications/ARTICLE-07-jwks-discovery-endpoints.md
    - .agent/publications/ARTICLE-07-B-refactoring-jwks-discovery.md
  commits:
    - "3a6e3e6"
    - "f56808f"
    - "b18de12"
    - "a9d91bc"
    - "ef5c0fb"
    - "f515b6a"
tags:
  - oidc
  - jwks
  - discovery
  - rsa256
  - keypair
---

# US-07: Cryptographic Keypair Management, JWKS and OpenID Discovery Endpoints

**Epic:** [EPIC-04: OIDC / OAuth2 Authorization Server & Session Lifecycle](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `identity` / `oidc-crypto`  
**Slice Type:** Query & Infrastructure (OIDC Discovery Slice)  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  
**ADR Relacionado:** [`ADR-0006: OIDC Authorization Server & Cryptography`](../../../docs/adr/0006-oidc-session-flow.md)

---

## 1. Descripción

**Como** desarrollador de aplicaciones cliente o servicio consumidor en el ecosistema,  
**Quiero** consultar los endpoints estándar de descubrimiento OpenID (`/.well-known/openid-configuration`) y el conjunto de claves públicas JWKS (`/.well-known/jwks.json`),  
**Para** configurar automáticamente mi cliente OIDC y verificar criptográficamente las firmas de los tokens JWT emitidos sin depender de secretos compartidos ni acoplamiento técnico con el IdP.

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Par de Claves Asimétricas RS256:** El Identity Provider gestiona un par de claves RSA (mínimo 2048 bits). La clave privada se mantiene estrictamente aislada y nunca se expone fuera del servicio.
2. **Identificador de Clave (`kid`):** Toda clave pública y privada posee un `kid` único (Key ID). Cada JWT emitido debe incorporar el parámetro `kid` en su cabecera (*Jose Header*).
3. **Estructura Estándar JWKS (RFC 7517):** El endpoint `GET /.well-known/jwks.json` expone la clave pública conteniendo los campos obligatorios:
   * `kty`: `"RSA"`
   * `use`: `"sig"` (signature)
   * `alg`: `"RS256"`
   * `kid`: Identificador de la clave activa
   * `n`: Módulo codificado en Base64URL
   * `e`: Exponente público codificado en Base64URL (típicamente `"AQAB"`)
4. **Endpoint de Descubrimiento (RFC 8414 / OIDC Discovery):** El endpoint `GET /.well-known/openid-configuration` debe retornar los metadatos RFC con `issuer`, `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `scopes_supported`, `response_types_supported`, etc.

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: Cryptographic Keypair Management, JWKS and OpenID Discovery Endpoints

  Scenario: Retrieve OpenID Connect Discovery metadata
    When a client sends a GET request to "/.well-known/openid-configuration"
    Then the response status code should be 200 OK
    And the response body should contain "issuer" matching the service public URL
    And the response body should contain "jwks_uri" ending in "/.well-known/jwks.json"
    And the response body should indicate support for "RS256" in "id_token_signing_alg_values_supported"

  Scenario: Retrieve valid JSON Web Key Set (JWKS)
    When a client sends a GET request to "/.well-known/jwks.json"
    Then the response status code should be 200 OK
    And the response body should contain a "keys" array with at least one active key
    And each key in "keys" must contain "kty": "RSA", "alg": "RS256", "use": "sig", "n", "e", and "kid"
```

---

## 4. Cobertura de Pruebas Requerida (Pirámide de Testing)

- [x] **Unit Test 1 (Cryptographic Key Adapter & RS256 Provider):** `tests/unit/identity/infrastructure/security/test_rsa_key_adapter.ts`
  - Validar generación/carga de claves RSA 2048-bit, exportación de clave pública en formato JWK, firma/verificación de payload y redacción segura de clave privada (`[REDACTED]`).
- [x] **Unit Test 2 (Domain Value Objects):** `tests/unit/identity/domain/crypto/test_key_id.ts` & `test_json_web_key.ts`
  - Validar invariantes estrictas de `KeyId` y protección de `JsonWebKeyVO` contra fuga de parámetros privados (`d`, `p`, `q`, etc.).
- [x] **Unit Test 3 (Application Query Handlers):** `tests/unit/identity/application/oidc/test_get_jwks_handler.ts` & `test_get_openid_configuration_handler.ts`
  - Validar saneamiento de URL de emisor y tolerancia a fallos.
- [x] **Integration Test 1 (Discovery & JWKS Endpoints):** `tests/integration/identity/interfaces/test_oidc_discovery_api.ts`
  - Comprobar respuestas HTTP 200, CORS (`*`), `Cache-Control` y estructura JSON de ambos endpoints conforme a RFC 8414 y RFC 7517.
- [x] **Acceptance Test (BDD):** `tests/acceptance/features/oidc_discovery.feature` & `tests/acceptance/step_defs/test_oidc_discovery_steps.ts`
  - Escenarios BDD ejecutables con Cucumber/Jest.
- [x] **SDK Tests:** `sdks/typescript/tests/discovery.test.ts`
  - Validar consumo mediante `client.discovery.getOpenIdConfiguration()` y `client.discovery.getJwks()`.

---

## 5. Trazabilidad de Implementación

- **Dominio y Puertos:**
  - `src/contexts/identity/domain/ports/crypto/asymmetric_key_provider_port.ts`
  - `src/contexts/identity/domain/value_objects/crypto/key_id.ts`
  - `src/contexts/identity/domain/value_objects/crypto/json_web_key.ts`
- **Aplicación (Read Slices):**
  - `src/contexts/identity/application/queries/get_jwks/`
  - `src/contexts/identity/application/queries/get_openid_configuration/`
- **Infraestructura:**
  - `src/contexts/identity/infrastructure/security/rsa_key_adapter.ts`
- **Controladores e Interfaces HTTP:**
  - `interfaces/http/rest/v1/oidc/discovery_controller.ts`
  - `interfaces/http/server.ts`
- **TypeScript SDK:**
  - `sdks/typescript/src/resources/discovery_resource.ts`
  - `sdks/typescript/src/types/discovery.ts`

